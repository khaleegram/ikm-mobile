import { pool, ensureUser } from './db.mjs';
import { recordAction } from './social.mjs';
import { isBlockedEither } from './social-graph.mjs';
import { getPresenceStatus, getPresenceLastSeen } from './chat-presence.mjs';
import { broadcastToThread } from './chat-ws.mjs';
import { notifyChatMessage } from './chat-notify.mjs';

const CLOSED_STATUSES = new Set(['closed', 'completed']);
const REPORT_REASONS = new Set(['spam', 'fraud', 'harassment', 'inappropriate', 'scam']);
const VOICE_MAX_BYTES = 512 * 1024;

function requirePool() {
  if (!pool) {
    const err = new Error('Chat database is not configured');
    err.statusCode = 503;
    throw err;
  }
  return pool;
}

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function asString(value) {
  return String(value ?? '').trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    asString(value)
  );
}

async function assertNotBlocked(userId, peerId) {
  // Same Neon `user_blocks` table the client writes via /v1/social/block — not Firestore.
  if (await isBlockedEither(userId, peerId)) {
    throw httpError('Messaging is blocked between these users', 403);
  }
}

async function loadPostContext(postId) {
  const { getPostById, postSnapshotFromPost } = await import('./posts-repo.mjs');
  const post = await getPostById(postId);
  if (!post) throw httpError('Post not found', 404);
  const posterId = asString(post.posterId);
  if (!posterId) throw httpError('Post has no seller', 400);
  return {
    posterId,
    postData: post,
    snapshot: postSnapshotFromPost(post),
  };
}

async function loadUserProfile(userId) {
  if (!userId) return null;
  try {
    const { getUser } = await import('./users.mjs');
    const user = await getUser(userId);
    const storeName = asString(user?.storeName);
    const displayNameRaw = asString(user?.displayName);
    const safePerson =
      displayNameRaw && !displayNameRaw.includes('@') && displayNameRaw !== 'User'
        ? displayNameRaw
        : '';
    // Store identity wins everywhere in marketplace chat.
    const label = storeName || safePerson || 'Store';
    return {
      id: userId,
      displayName: label,
      storeName: storeName || null,
      avatarUrl:
        asString(user?.storeLogoUrl) ||
        asString(user?.avatarUrl || user?.photoURL) ||
        null,
      isVerified: false,
    };
  } catch {
    return { id: userId, displayName: 'Store', storeName: null, avatarUrl: null, isVerified: false };
  }
}

function normalizeThreadStatus(status) {
  const value = asString(status);
  if (value === 'order_active') return 'in_order';
  return value || 'browsing';
}

function snapshotLooksEmpty(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return true;
  const title = asString(snapshot.title);
  const imageUrl = asString(snapshot.imageUrl);
  return !title && !imageUrl;
}

async function ensureThreadPostSnapshot(row) {
  const existing = row?.post_snapshot;
  const postId = asString(row?.post_id);
  if (!postId) return existing || {};
  try {
    const { snapshot } = await loadPostContext(postId);
    if (snapshotLooksEmpty(snapshot)) return existing || {};
    const unchanged =
      asString(existing?.title) === asString(snapshot.title) &&
      asString(existing?.imageUrl) === asString(snapshot.imageUrl) &&
      Number(existing?.price || 0) === Number(snapshot.price || 0);
    if (!unchanged && pool && row?.id) {
      void pool
        .query(`UPDATE chat_threads SET post_snapshot = $2::jsonb WHERE id = $1`, [
          row.id,
          JSON.stringify(snapshot),
        ])
        .catch(() => {});
    }
    return snapshot;
  } catch {
    return existing || {};
  }
}

function mapThreadRow(row, postSnapshotOverride) {
  return {
    id: row.id,
    postId: row.post_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    status: normalizeThreadStatus(row.status),
    postSnapshot: postSnapshotOverride || row.post_snapshot || {},
    linkedOrderId: row.linked_order_id || null,
    lastMessage: row.last_message || null,
    lastAt: row.last_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOfferRow(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amount: Number(row.amount),
    currency: row.currency,
    note: row.note || null,
    status: row.status,
    parentOfferId: row.parent_offer_id || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttachmentRow(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    type: row.type,
    url: row.url,
    mimeType: row.mime_type || null,
    sizeBytes: row.size_bytes ?? null,
    durationSec: row.duration_sec ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    createdAt: row.created_at,
  };
}

function mapMessageRow(row) {
  const offer = row.offer_id
    ? {
        id: row.offer_id,
        amount: Number(row.offer_amount),
        currency: row.offer_currency,
        note: row.offer_note || null,
        status: row.offer_status,
        parentOfferId: row.offer_parent_id || null,
        createdAt: row.offer_created_at,
      }
    : null;
  const attachment = row.attachment_id
    ? {
        id: row.attachment_id,
        type: row.attachment_type,
        url: row.attachment_url,
        mimeType: row.attachment_mime || null,
        durationSec: row.attachment_duration ?? null,
        sizeBytes: row.attachment_size ?? null,
        createdAt: row.attachment_created_at,
      }
    : null;

  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id || null,
    type: row.type,
    body: row.body || null,
    payload: row.payload || {},
    clientMsgId: row.client_msg_id || null,
    offer,
    attachment,
    createdAt: row.created_at,
  };
}

const MESSAGE_SELECT = `
  SELECT
    m.id, m.thread_id, m.sender_id, m.type, m.body, m.payload, m.client_msg_id, m.created_at,
    o.id AS offer_id, o.amount AS offer_amount, o.currency AS offer_currency,
    o.note AS offer_note, o.status AS offer_status, o.parent_offer_id AS offer_parent_id,
    o.created_at AS offer_created_at,
    a.id AS attachment_id, a.type AS attachment_type, a.url AS attachment_url,
    a.mime_type AS attachment_mime, a.duration_sec AS attachment_duration,
    a.size_bytes AS attachment_size, a.created_at AS attachment_created_at
  FROM chat_messages m
  LEFT JOIN chat_offers o ON o.id = NULLIF(m.payload->>'offer_id', '')::uuid
  LEFT JOIN chat_attachments a ON a.id = NULLIF(m.payload->>'attachment_id', '')::uuid
`;

async function getThreadRow(threadId) {
  const db = requirePool();
  const { rows } = await db.query(`SELECT * FROM chat_threads WHERE id = $1`, [threadId]);
  return rows[0] || null;
}

async function assertParticipant(userId, threadRow) {
  if (!threadRow) throw httpError('Thread not found', 404);
  if (threadRow.buyer_id !== userId && threadRow.seller_id !== userId) {
    throw httpError('Forbidden', 403);
  }
  return threadRow;
}

async function upsertInbox(client, { userId, threadId, peerId, preview, bumpUnread = false }) {
  await ensureUser(userId);
  await client.query(
    `INSERT INTO chat_inbox (user_id, thread_id, peer_id, unread_count, last_preview, last_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id, thread_id) DO UPDATE SET
       peer_id = EXCLUDED.peer_id,
       last_preview = EXCLUDED.last_preview,
       last_at = now(),
       unread_count = CASE
         WHEN $6 THEN chat_inbox.unread_count + 1
         ELSE chat_inbox.unread_count
       END`,
    [userId, threadId, peerId, bumpUnread ? 1 : 0, preview, bumpUnread]
  );
}

async function touchThread(client, threadId, preview) {
  await client.query(
    `UPDATE chat_threads
     SET last_message = $2, last_at = now(), updated_at = now()
     WHERE id = $1`,
    [threadId, preview]
  );
}

function statusBadgeFor(status, lastPreview) {
  // Normalize legacy server typo `order_active` → treat as in_order for badges.
  if (status === 'in_order' || status === 'order_active') return 'order_active';
  if (status === 'accepted') return 'accepted';
  if (status === 'offer_sent' || status === 'negotiating') return 'offer_sent';
  if (status === 'completed') return 'completed';
  if (String(lastPreview || '').toLowerCase().includes('offer')) return 'offer_sent';
  return null;
}

function threadStatusForSystemEvent(event, hasOrderId) {
  const clean = asString(event);
  if (clean === 'buyer_confirmed' || clean === 'escrow_released') return 'completed';
  if (clean === 'order_cancelled' || clean === 'refund_processed') return 'closed';
  if (hasOrderId || clean.startsWith('order_') || clean.startsWith('seller_') || clean === 'dispute_opened') {
    return 'in_order';
  }
  return null;
}

/**
 * Internal helper: resolve or create a deal thread for a paid order.
 * Prefer an explicit threadId when it matches buyer+post; otherwise get-or-create.
 */
export async function ensureDealThreadForOrder({
  buyerId,
  postId,
  sellerId,
  threadId,
}) {
  const cleanBuyer = asString(buyerId);
  const cleanPost = asString(postId);
  if (!cleanBuyer || !cleanPost) throw httpError('buyerId and postId are required');

  const preferredId = asString(threadId);
  if (preferredId && isUuid(preferredId)) {
    try {
      const row = await getThreadRow(preferredId);
      if (row.buyer_id === cleanBuyer && row.post_id === cleanPost) {
        return { thread: mapThreadRow(row), isNew: false };
      }
    } catch {
      // Fall through to get-or-create.
    }
  }

  return getOrCreateThread(cleanBuyer, { postId: cleanPost, sellerId });
}

export async function getInbox(userId) {
  const db = requirePool();
  await ensureUser(userId);
  const { rows } = await db.query(
    `SELECT
       i.thread_id, i.peer_id, i.unread_count, i.last_preview, i.last_at,
       t.post_id, t.status, t.post_snapshot, t.buyer_id, t.seller_id
     FROM chat_inbox i
     JOIN chat_threads t ON t.id = i.thread_id
     WHERE i.user_id = $1
     ORDER BY i.last_at DESC NULLS LAST
     LIMIT 200`,
    [userId]
  );

  const threads = await Promise.all(
    rows.map(async (row) => {
      const peer = await loadUserProfile(row.peer_id);
      const presence = await getPresenceStatus(row.peer_id);
      const lastSeenAt =
        presence === 'last_seen' ? await getPresenceLastSeen(row.peer_id) : null;
      const postSnapshot = await ensureThreadPostSnapshot({
        id: row.thread_id,
        post_id: row.post_id,
        post_snapshot: row.post_snapshot,
      });
      return {
        threadId: row.thread_id,
        peerId: row.peer_id,
        peerName: peer?.displayName || 'Store',
        peerAvatar: peer?.avatarUrl || null,
        peerPresence: presence,
        peerLastSeenAt: lastSeenAt,
        postId: row.post_id,
        postSnapshot,
        status: normalizeThreadStatus(row.status),
        statusBadge: statusBadgeFor(normalizeThreadStatus(row.status), row.last_preview),
        lastPreview: row.last_preview || '',
        unreadCount: Number(row.unread_count || 0),
        lastAt: row.last_at,
      };
    })
  );

  return { threads };
}

export async function getOrCreateThread(userId, { postId, sellerId }) {
  const db = requirePool();
  const cleanPostId = asString(postId);
  if (!cleanPostId) throw httpError('postId is required');

  const { posterId, snapshot } = await loadPostContext(cleanPostId);
  const cleanSellerId = asString(sellerId) || posterId;
  if (cleanSellerId !== posterId) throw httpError('sellerId does not match post owner', 400);
  if (userId === cleanSellerId) throw httpError('Cannot message yourself', 400);

  await assertNotBlocked(userId, cleanSellerId);

  const buyerId = userId;
  const seller_id = cleanSellerId;

  const existing = await db.query(
    `SELECT * FROM chat_threads
     WHERE post_id = $1 AND buyer_id = $2
     ORDER BY COALESCE(last_at, updated_at, created_at) DESC
     LIMIT 1`,
    [cleanPostId, buyerId]
  );

  if (existing.rows[0]) {
    let row = existing.rows[0];
    // Reuse the same product room forever — reopen if previously closed
    if (row.status === 'closed' || row.status === 'completed') {
      const reopened = await db.query(
        `UPDATE chat_threads
         SET status = 'browsing', updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [row.id]
      );
      row = reopened.rows[0] || { ...row, status: 'browsing' };
    }
    // Refresh cover/title from the live post so inbox/direct opens match feed opens.
    const postSnapshot = await ensureThreadPostSnapshot(row);
    const merged = snapshotLooksEmpty(postSnapshot) ? snapshot : postSnapshot;
    return { thread: mapThreadRow(row, merged), isNew: false };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO chat_threads (post_id, buyer_id, seller_id, status, post_snapshot)
       VALUES ($1, $2, $3, 'browsing', $4::jsonb)
       RETURNING *`,
      [cleanPostId, buyerId, seller_id, JSON.stringify(snapshot)]
    );
    const thread = inserted.rows[0];
    await upsertInbox(client, {
      userId: buyerId,
      threadId: thread.id,
      peerId: seller_id,
      preview: 'New conversation',
      bumpUnread: false,
    });
    await upsertInbox(client, {
      userId: seller_id,
      threadId: thread.id,
      peerId: buyerId,
      preview: 'New conversation',
      bumpUnread: false,
    });
    await client.query('COMMIT');
    return { thread: mapThreadRow(thread), isNew: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getThread(userId, threadId) {
  if (!isUuid(threadId)) throw httpError('Invalid thread id');
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);
  const peerId = row.buyer_id === userId ? row.seller_id : row.buyer_id;
  const peer = await loadUserProfile(peerId);
  const presence = await getPresenceStatus(peerId);
  const lastSeenAt = presence === 'last_seen' ? await getPresenceLastSeen(peerId) : null;
  const postSnapshot = await ensureThreadPostSnapshot(row);
  return {
    thread: mapThreadRow(row, postSnapshot),
    peer: {
      ...peer,
      presence,
      lastSeenAt,
    },
  };
}

export async function getMessages(userId, threadId, { before, limit = 50 } = {}) {
  if (!isUuid(threadId)) throw httpError('Invalid thread id');
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);

  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const params = [threadId];
  let cursorClause = '';
  if (before) {
    if (!isUuid(before)) throw httpError('Invalid cursor');
    params.push(before);
    cursorClause = `AND m.created_at < (SELECT created_at FROM chat_messages WHERE id = $2)`;
  }
  params.push(pageSize + 1);

  const { rows } = await requirePool().query(
    `${MESSAGE_SELECT}
     WHERE m.thread_id = $1 ${cursorClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > pageSize;
  const slice = hasMore ? rows.slice(0, pageSize) : rows;
  const messages = slice.map(mapMessageRow).reverse();
  const nextCursor = hasMore ? slice[slice.length - 1]?.id : null;

  return { messages, nextCursor, hasMore };
}

async function insertMessage(client, {
  threadId,
  senderId,
  type,
  body,
  payload,
  clientMsgId,
}) {
  if (clientMsgId) {
    const existing = await client.query(
      `SELECT * FROM chat_messages WHERE client_msg_id = $1`,
      [clientMsgId]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO chat_messages (thread_id, sender_id, type, body, payload, client_msg_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING *`,
    [
      threadId,
      senderId || null,
      type,
      body || null,
      JSON.stringify(payload || {}),
      clientMsgId || null,
    ]
  );
  return inserted.rows[0];
}

export async function sendMessage(userId, threadId, payload = {}) {
  if (!isUuid(threadId)) throw httpError('Invalid thread id');
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);

  const peerId = row.buyer_id === userId ? row.seller_id : row.buyer_id;
  await assertNotBlocked(userId, peerId);

  const type = asString(payload.type) || 'text';
  const body = asString(payload.body);
  const clientMsgId = asString(payload.clientMsgId) || null;

  if (type === 'text' && !body) throw httpError('Message body is required');
  if (type === 'quote' && !payload.quote) throw httpError('quote payload is required');

  let messagePayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
  let preview = body;

  const db = requirePool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    let messageRow;

    if (type === 'image' || type === 'voice') {
      const attachment = payload.attachment || {};
      const url = asString(attachment.url);
      if (!url) throw httpError('attachment.url is required');

      if (type === 'voice') {
        const sizeBytes = Number(attachment.sizeBytes || 0);
        if (sizeBytes > VOICE_MAX_BYTES) throw httpError('Voice note too large', 400);
      }

      messageRow = await insertMessage(client, {
        threadId,
        senderId: userId,
        type,
        body: body || null,
        payload: {},
        clientMsgId,
      });

      const att = await client.query(
        `INSERT INTO chat_attachments
           (message_id, type, url, mime_type, size_bytes, duration_sec, width, height)
         VALUES (
           $1, $2, $3, $4,
           CASE WHEN $5::text IS NULL OR $5::text = '' THEN NULL ELSE ROUND($5::numeric)::int END,
           CASE WHEN $6::text IS NULL OR $6::text = '' THEN NULL ELSE ROUND($6::numeric)::int END,
           CASE WHEN $7::text IS NULL OR $7::text = '' THEN NULL ELSE ROUND($7::numeric)::int END,
           CASE WHEN $8::text IS NULL OR $8::text = '' THEN NULL ELSE ROUND($8::numeric)::int END
         )
         RETURNING *`,
        [
          messageRow.id,
          type,
          url,
          asString(attachment.mimeType) || null,
          attachment.sizeBytes == null || attachment.sizeBytes === ''
            ? null
            : Number(attachment.sizeBytes),
          attachment.durationSec == null || attachment.durationSec === ''
            ? null
            : Number(attachment.durationSec),
          attachment.width == null || attachment.width === '' ? null : Number(attachment.width),
          attachment.height == null || attachment.height === '' ? null : Number(attachment.height),
        ]
      );

      messagePayload = { attachment_id: att.rows[0].id };
      await client.query(
        `UPDATE chat_messages SET payload = $2::jsonb WHERE id = $1`,
        [messageRow.id, JSON.stringify(messagePayload)]
      );
      messageRow.payload = messagePayload;
      preview = type === 'voice' ? 'Voice message' : 'Photo';
    } else if (type === 'quote') {
      const quote = payload.quote || {};
      messagePayload = {
        postId: asString(quote.postId) || row.post_id,
        previewText: asString(quote.previewText),
        previewImage: asString(quote.previewImage) || null,
      };
      const quoteBody = body || asString(quote.previewText) || 'Shared a listing';
      preview = quoteBody;
      messageRow = await insertMessage(client, {
        threadId,
        senderId: userId,
        type: 'quote',
        body: quoteBody,
        payload: messagePayload,
        clientMsgId,
      });
    } else {
      messageRow = await insertMessage(client, {
        threadId,
        senderId: userId,
        type: 'text',
        body,
        payload: messagePayload,
        clientMsgId,
      });
    }

    await touchThread(client, threadId, preview);
    await upsertInbox(client, {
      userId,
      threadId,
      peerId,
      preview,
      bumpUnread: false,
    });
    await upsertInbox(client, {
      userId: peerId,
      threadId,
      peerId: userId,
      preview,
      bumpUnread: true,
    });

    await client.query('COMMIT');

    const full = mapMessageRow({
      ...messageRow,
      offer_id: null,
      attachment_id: messagePayload.attachment_id || null,
      attachment_type: type === 'voice' ? 'voice' : type === 'image' ? 'image' : null,
      attachment_url: payload.attachment?.url || null,
      attachment_mime: payload.attachment?.mimeType || null,
      attachment_duration: payload.attachment?.durationSec ?? null,
      attachment_size: payload.attachment?.sizeBytes ?? null,
    });

    if (messagePayload.attachment_id) {
      const attRes = await db.query(`SELECT * FROM chat_attachments WHERE id = $1`, [
        messagePayload.attachment_id,
      ]);
      full.attachment = mapAttachmentRow(attRes.rows[0]);
    }

    broadcastToThread(threadId, { event: 'message', message: full });
    recordAction(userId, row.post_id, 'chat').catch(() => {});
    notifyChatMessage({
      recipientId: peerId,
      senderId: userId,
      threadId,
      peerId: userId,
      preview,
    }).catch(() => {});

    return { message: full };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function assertThreadParticipant(userId, threadId) {
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);
  return row;
}

export async function createOffer(userId, threadId, payload = {}) {
  if (!isUuid(threadId)) throw httpError('Invalid thread id');
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);
  // Either party can propose a price; the other responds / counters.
  if (userId !== row.seller_id && userId !== row.buyer_id) {
    throw httpError('Only deal participants can send an offer', 403);
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError('Valid amount is required');

  const peerId = row.buyer_id === userId ? row.seller_id : row.buyer_id;
  await assertNotBlocked(userId, peerId);

  const currency = asString(payload.currency) || 'NGN';
  const note = asString(payload.note) || null;
  const clientMsgId = asString(payload.clientMsgId) || null;
  const listPrice = Number(row.post_snapshot?.price);
  const lowball =
    Number.isFinite(listPrice) && listPrice > 0 && amount < listPrice * 0.5;
  const preview =
    userId === row.buyer_id
      ? `Buying offer: ${currency} ${amount.toLocaleString()}`
      : `Offer: ${currency} ${amount.toLocaleString()}`;

  const db = requirePool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const offerRes = await client.query(
      `INSERT INTO chat_offers (thread_id, buyer_id, seller_id, amount, currency, note, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [threadId, row.buyer_id, row.seller_id, amount, currency, note]
    );
    const offer = offerRes.rows[0];

    const messageRow = await insertMessage(client, {
      threadId,
      senderId: userId,
      type: 'offer',
      body: note,
      payload: { offer_id: offer.id },
      clientMsgId,
    });

    await client.query(
      `UPDATE chat_threads SET status = 'offer_sent', updated_at = now() WHERE id = $1`,
      [threadId]
    );
    await touchThread(client, threadId, preview);
    await upsertInbox(client, { userId, threadId, peerId, preview, bumpUnread: false });
    await upsertInbox(client, { userId: peerId, threadId, peerId: userId, preview, bumpUnread: true });

    await client.query('COMMIT');

    const message = mapMessageRow({
      ...messageRow,
      offer_id: offer.id,
      offer_amount: offer.amount,
      offer_currency: offer.currency,
      offer_note: offer.note,
      offer_status: offer.status,
      offer_parent_id: null,
      offer_created_at: offer.created_at,
    });

    broadcastToThread(threadId, {
      event: 'offer_updated',
      offerId: offer.id,
      status: 'pending',
      message,
    });
    recordAction(userId, row.post_id, 'chat').catch(() => {});
    notifyChatMessage({
      recipientId: peerId,
      senderId: userId,
      threadId,
      peerId: userId,
      preview,
    }).catch(() => {});

    return { offer: { ...mapOfferRow(offer), lowball }, message, lowball };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SYSTEM_EVENT_TEXT = {
  order_paid: 'Order confirmed. Payment received.',
  seller_accepted: 'Seller accepted the order.',
  seller_preparing: 'Seller is preparing your order.',
  order_shipped: 'Order marked as shipped.',
  order_delivered: 'Order delivered.',
  buyer_confirmed: 'Buyer confirmed receipt. Order completed.',
  order_cancelled: 'Order cancelled.',
  dispute_opened: 'A dispute has been opened.',
  dispute_resolved: 'Dispute resolved.',
  escrow_released: 'Payment released to seller.',
  refund_requested: 'Refund is processing to the original payment method.',
  refund_processed: 'Refund processed.',
};

export async function appendSystemEvent({ threadId, orderId, event, text, photoUrl }) {
  if (!isUuid(threadId)) throw httpError('Invalid thread id');
  const row = await getThreadRow(threadId);
  const cleanEvent = asString(event) || 'system';
  const preview =
    asString(text) ||
    SYSTEM_EVENT_TEXT[cleanEvent] ||
    `Order update: ${cleanEvent}`;
  const cleanPhoto = asString(photoUrl) || null;

  const db = requirePool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const nextStatus = threadStatusForSystemEvent(cleanEvent, Boolean(asString(orderId)));
    if (orderId || nextStatus) {
      await client.query(
        `UPDATE chat_threads
         SET linked_order_id = COALESCE($2, linked_order_id),
             status = COALESCE($3, status),
             updated_at = now()
         WHERE id = $1`,
        [threadId, asString(orderId) || null, nextStatus]
      );
    }

    const messageRow = await insertMessage(client, {
      threadId,
      senderId: null,
      type: 'system',
      body: preview,
      payload: {
        orderId: asString(orderId) || null,
        event: cleanEvent,
        ...(cleanPhoto
          ? { photoUrl: cleanPhoto, sentPhotoUrl: cleanPhoto, imageUrl: cleanPhoto }
          : {}),
      },
    });

    await touchThread(client, threadId, preview);
    await upsertInbox(client, {
      userId: row.buyer_id,
      threadId,
      peerId: row.seller_id,
      preview,
      bumpUnread: true,
    });
    await upsertInbox(client, {
      userId: row.seller_id,
      threadId,
      peerId: row.buyer_id,
      preview,
      bumpUnread: true,
    });

    await client.query('COMMIT');

    const message = mapMessageRow({
      ...messageRow,
      offer_id: null,
      attachment_id: null,
    });

    const resolvedStatus = nextStatus || row.status;
    broadcastToThread(threadId, { event: 'message', message });
    broadcastToThread(threadId, {
      event: 'thread_status',
      status: resolvedStatus,
    });

    return { message, status: resolvedStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function respondToOffer(userId, threadId, offerId, action, payload = {}) {
  if (!isUuid(threadId) || !isUuid(offerId)) throw httpError('Invalid id');
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);

  const normalizedAction = asString(action).toLowerCase();
  if (!['accept', 'counter', 'decline'].includes(normalizedAction)) {
    throw httpError('action must be accept, counter, or decline');
  }

  const db = requirePool();
  const offerRes = await db.query(
    `SELECT * FROM chat_offers WHERE id = $1 AND thread_id = $2`,
    [offerId, threadId]
  );
  const offer = offerRes.rows[0];
  if (!offer) throw httpError('Offer not found', 404);
  if (offer.status !== 'pending') throw httpError('Offer is no longer pending', 409);

  const peerId = row.buyer_id === userId ? row.seller_id : row.buyer_id;
  await assertNotBlocked(userId, peerId);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let newOffer = null;
    let messageType = normalizedAction;
    let preview = '';
    let threadStatus = row.status;

    if (normalizedAction === 'accept') {
      await client.query(
        `UPDATE chat_offers SET status = 'accepted', updated_at = now() WHERE id = $1`,
        [offerId]
      );
      preview = `Offer accepted: ${offer.currency} ${Number(offer.amount).toLocaleString()}`;
      threadStatus = 'accepted';
    } else if (normalizedAction === 'decline') {
      await client.query(
        `UPDATE chat_offers SET status = 'declined', updated_at = now() WHERE id = $1`,
        [offerId]
      );
      preview = 'Offer declined';
      threadStatus = 'negotiating';
      messageType = 'decline';
    } else {
      const counterAmount = Number(payload.amount);
      if (!Number.isFinite(counterAmount) || counterAmount <= 0) {
        throw httpError('Valid counter amount is required');
      }
      await client.query(
        `UPDATE chat_offers SET status = 'countered', updated_at = now() WHERE id = $1`,
        [offerId]
      );
      const counterRes = await client.query(
        `INSERT INTO chat_offers
           (thread_id, buyer_id, seller_id, amount, currency, note, status, parent_offer_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         RETURNING *`,
        [
          threadId,
          row.buyer_id,
          row.seller_id,
          counterAmount,
          offer.currency,
          asString(payload.note) || null,
          offerId,
        ]
      );
      newOffer = counterRes.rows[0];
      preview = `Counter: ${offer.currency} ${counterAmount.toLocaleString()}`;
      threadStatus = 'negotiating';
      messageType = 'counter';
    }

    const messagePayload = newOffer
      ? { offer_id: newOffer.id }
      : { offer_id: offerId };

    const messageRow = await insertMessage(client, {
      threadId,
      senderId: userId,
      type: messageType,
      body: asString(payload.note) || null,
      payload: messagePayload,
      clientMsgId: asString(payload.clientMsgId) || null,
    });

    await client.query(
      `UPDATE chat_threads SET status = $2, updated_at = now() WHERE id = $1`,
      [threadId, threadStatus]
    );
    await touchThread(client, threadId, preview);
    await upsertInbox(client, { userId, threadId, peerId, preview, bumpUnread: false });
    await upsertInbox(client, { userId: peerId, threadId, peerId: userId, preview, bumpUnread: true });

    await client.query('COMMIT');

    const resolvedOfferId = newOffer?.id || offerId;
    const resolvedOffer = newOffer || { ...offer, status: normalizedAction === 'accept' ? 'accepted' : 'declined' };

    const message = mapMessageRow({
      ...messageRow,
      offer_id: resolvedOfferId,
      offer_amount: resolvedOffer.amount,
      offer_currency: resolvedOffer.currency,
      offer_note: resolvedOffer.note,
      offer_status: resolvedOffer.status,
      offer_parent_id: resolvedOffer.parent_offer_id || null,
      offer_created_at: resolvedOffer.created_at,
    });

    broadcastToThread(threadId, {
      event: 'offer_updated',
      offerId: resolvedOfferId,
      status: resolvedOffer.status,
      message,
    });
    notifyChatMessage({
      recipientId: peerId,
      senderId: userId,
      threadId,
      peerId: userId,
      preview,
    }).catch(() => {});

    return {
      offer: mapOfferRow(
        newOffer ||
          (await db.query(`SELECT * FROM chat_offers WHERE id = $1`, [offerId])).rows[0]
      ),
      message,
      threadStatus,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function markThreadRead(userId, threadId) {
  if (!isUuid(threadId)) throw httpError('Invalid thread id');
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);

  await requirePool().query(
    `UPDATE chat_inbox SET unread_count = 0 WHERE user_id = $1 AND thread_id = $2`,
    [userId, threadId]
  );

  const peerId = row.buyer_id === userId ? row.seller_id : row.buyer_id;
  broadcastToThread(threadId, {
    event: 'read',
    userId,
    readAt: new Date().toISOString(),
  });

  return { success: true };
}

export async function reportMessage(userId, threadId, messageId, reason) {
  if (!isUuid(threadId) || !isUuid(messageId)) throw httpError('Invalid id');
  const row = await getThreadRow(threadId);
  await assertParticipant(userId, row);

  const cleanReason = asString(reason).toLowerCase();
  if (!REPORT_REASONS.has(cleanReason)) throw httpError('Invalid report reason');

  const msgRes = await requirePool().query(
    `SELECT sender_id FROM chat_messages WHERE id = $1 AND thread_id = $2`,
    [messageId, threadId]
  );
  const msg = msgRes.rows[0];
  if (!msg) throw httpError('Message not found', 404);
  if (!msg.sender_id || msg.sender_id === userId) {
    throw httpError('Cannot report this message', 400);
  }

  await requirePool().query(
    `INSERT INTO chat_reports (reporter_id, reported_id, thread_id, message_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, msg.sender_id, threadId, messageId, cleanReason]
  );

  return { success: true };
}

export async function searchMessages(userId, { q, threadId, limit = 20 } = {}) {
  const query = asString(q);
  if (!query) throw httpError('q is required');

  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const db = requirePool();

  if (threadId) {
    if (!isUuid(threadId)) throw httpError('Invalid thread id');
    const row = await getThreadRow(threadId);
    await assertParticipant(userId, row);
    const { rows } = await db.query(
      `${MESSAGE_SELECT}
       WHERE m.thread_id = $1
         AND m.search_vector @@ plainto_tsquery('english', $2)
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [threadId, query, pageSize]
    );
    return { messages: rows.map(mapMessageRow) };
  }

  const { rows } = await db.query(
    `${MESSAGE_SELECT}
     JOIN chat_threads t ON t.id = m.thread_id
     WHERE (t.buyer_id = $1 OR t.seller_id = $1)
       AND m.search_vector @@ plainto_tsquery('english', $2)
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [userId, query, pageSize]
  );
  return { messages: rows.map(mapMessageRow) };
}
