import { pool, ensureUser } from './db.mjs';

function requirePool() {
  if (!pool) {
    const err = new Error('Database is not configured');
    err.statusCode = 503;
    throw err;
  }
  return pool;
}

function asString(value) {
  return String(value ?? '').trim();
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value?._seconds === 'number') {
    return new Date(value._seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asNumber(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractPostId(order = {}) {
  const direct = asString(order.postId || order.post_id);
  if (direct) return direct;
  const meta = order.marketMeta || order.market_meta || {};
  const fromMeta = asString(meta.postId || meta.post_id);
  if (fromMeta) return fromMeta;
  const first = Array.isArray(order.items) ? order.items[0] : null;
  const productId = asString(first?.productId || first?.product_id);
  if (productId.startsWith('market_post_')) return productId.slice('market_post_'.length);
  return null;
}

function mapOrderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    sellerId: row.seller_id,
    postId: row.post_id || undefined,
    idempotencyKey: row.idempotency_key || undefined,
    status: row.status,
    items: Array.isArray(row.items) ? row.items : [],
    total: asNumber(row.total, 0),
    shippingPrice: asNumber(row.shipping_price),
    shippingType: row.shipping_type || undefined,
    deliveryAddress: row.delivery_address || '',
    customerInfo: row.customer_info || {},
    paymentReference: row.payment_reference || undefined,
    paystackReference: row.paystack_reference || undefined,
    paymentMethod: row.payment_method || undefined,
    discountCode: row.discount_code || undefined,
    escrowStatus: row.escrow_status || undefined,
    commissionRate: asNumber(row.commission_rate),
    fundsReleasedAt: row.funds_released_at || undefined,
    autoReleaseDate: row.auto_release_date || undefined,
    sentAt: row.sent_at || undefined,
    sentPhotoUrl: row.sent_photo_url || undefined,
    receivedAt: row.received_at || undefined,
    receivedPhotoUrl: row.received_photo_url || undefined,
    waybillParkId: row.waybill_park_id || undefined,
    waybillParkName: row.waybill_park_name || undefined,
    dealThreadId: row.deal_thread_id || undefined,
    chatThreadId: row.deal_thread_id || undefined,
    availabilityStatus: row.availability_status || undefined,
    waitTimeDays: row.wait_time_days ?? undefined,
    waitTimeExpiresAt: row.wait_time_expires_at || undefined,
    availabilityReason: row.availability_reason || undefined,
    buyerWaitResponse: row.buyer_wait_response ?? undefined,
    dispute: row.dispute || undefined,
    notes: Array.isArray(row.notes) ? row.notes : [],
    refunds: Array.isArray(row.refunds) ? row.refunds : [],
    marketMeta: row.market_meta || {},
    lastMessage: row.last_message || undefined,
    sellerUnreadCount: Number(row.seller_unread_count || 0),
    buyerUnreadCount: Number(row.buyer_unread_count || 0),
    sellerAcceptedAt: row.seller_accepted_at || undefined,
    preparingAt: row.preparing_at || undefined,
    paymentVerifiedAt: row.payment_verified_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTimelineRow(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    event: row.event,
    status: row.status || undefined,
    text: row.text || '',
    actorId: row.actor_id || undefined,
    actorRole: row.actor_role || undefined,
    metadata: row.metadata || undefined,
    createdAt: row.created_at,
  };
}

async function resolvePostIdForInsert(db, order) {
  const postId = extractPostId(order);
  if (!postId) return null;
  const { rows } = await db.query(`SELECT id FROM posts WHERE id = $1 LIMIT 1`, [postId]);
  return rows[0]?.id || null;
}

async function upsertOrderWithDb(db, payload = {}) {
  const id = asString(payload.id || payload.orderId);
  if (!id) {
    const err = new Error('order id is required');
    err.statusCode = 400;
    throw err;
  }

  const customerId = asString(payload.customerId || payload.customer_id);
  const sellerId = asString(payload.sellerId || payload.seller_id);
  if (!customerId || !sellerId) {
    const err = new Error('customerId and sellerId are required');
    err.statusCode = 400;
    throw err;
  }

  await ensureUser(customerId);
  await ensureUser(sellerId);

  const postId = await resolvePostIdForInsert(db, payload);
  const dealThreadId = asString(
    payload.dealThreadId || payload.deal_thread_id || payload.chatThreadId || payload.chat_thread_id
  ) || null;
  const paystackReference = asString(
    payload.paystackReference || payload.paystack_reference || payload.paymentReference || payload.payment_reference
  ) || null;
  const idempotencyKey = asString(payload.idempotencyKey || payload.idempotency_key) || null;

  await db.query(
    `INSERT INTO orders (
       id, customer_id, seller_id, post_id, idempotency_key, status, items, total,
       shipping_price, shipping_type, delivery_address, customer_info,
       payment_reference, paystack_reference, payment_method, discount_code,
       escrow_status, commission_rate, funds_released_at, auto_release_date,
       sent_at, sent_photo_url, received_at, received_photo_url,
       waybill_park_id, waybill_park_name, deal_thread_id,
       availability_status, wait_time_days, wait_time_expires_at,
       availability_reason, buyer_wait_response, dispute, notes, refunds,
       market_meta, last_message, seller_unread_count, buyer_unread_count,
       seller_accepted_at, preparing_at, payment_verified_at, raw,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7::jsonb,$8,
       $9,$10,$11,$12::jsonb,
       $13,$14,$15,$16,
       $17,$18,$19,$20,
       $21,$22,$23,$24,
       $25,$26,$27,
       $28,$29,$30,
       $31,$32,$33::jsonb,$34::jsonb,$35::jsonb,
       $36::jsonb,$37::jsonb,$38,$39,
       $40,$41,$42,$43::jsonb,
       COALESCE($44, now()), COALESCE($45, now())
     )
     ON CONFLICT (id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id,
       seller_id = EXCLUDED.seller_id,
       post_id = COALESCE(EXCLUDED.post_id, orders.post_id),
       idempotency_key = COALESCE(EXCLUDED.idempotency_key, orders.idempotency_key),
       status = EXCLUDED.status,
       items = EXCLUDED.items,
       total = EXCLUDED.total,
       shipping_price = EXCLUDED.shipping_price,
       shipping_type = EXCLUDED.shipping_type,
       delivery_address = EXCLUDED.delivery_address,
       customer_info = EXCLUDED.customer_info,
       payment_reference = COALESCE(EXCLUDED.payment_reference, orders.payment_reference),
       paystack_reference = COALESCE(EXCLUDED.paystack_reference, orders.paystack_reference),
       payment_method = EXCLUDED.payment_method,
       discount_code = EXCLUDED.discount_code,
       escrow_status = EXCLUDED.escrow_status,
       commission_rate = EXCLUDED.commission_rate,
       funds_released_at = EXCLUDED.funds_released_at,
       auto_release_date = EXCLUDED.auto_release_date,
       sent_at = EXCLUDED.sent_at,
       sent_photo_url = EXCLUDED.sent_photo_url,
       received_at = EXCLUDED.received_at,
       received_photo_url = EXCLUDED.received_photo_url,
       waybill_park_id = EXCLUDED.waybill_park_id,
       waybill_park_name = EXCLUDED.waybill_park_name,
       deal_thread_id = COALESCE(EXCLUDED.deal_thread_id, orders.deal_thread_id),
       availability_status = EXCLUDED.availability_status,
       wait_time_days = EXCLUDED.wait_time_days,
       wait_time_expires_at = EXCLUDED.wait_time_expires_at,
       availability_reason = EXCLUDED.availability_reason,
       buyer_wait_response = EXCLUDED.buyer_wait_response,
       dispute = EXCLUDED.dispute,
       notes = EXCLUDED.notes,
       refunds = EXCLUDED.refunds,
       market_meta = EXCLUDED.market_meta,
       last_message = EXCLUDED.last_message,
       seller_unread_count = EXCLUDED.seller_unread_count,
       buyer_unread_count = EXCLUDED.buyer_unread_count,
       seller_accepted_at = EXCLUDED.seller_accepted_at,
       preparing_at = EXCLUDED.preparing_at,
       payment_verified_at = EXCLUDED.payment_verified_at,
       raw = EXCLUDED.raw,
       updated_at = COALESCE(EXCLUDED.updated_at, now())`,
    [
      id,
      customerId,
      sellerId,
      postId,
      idempotencyKey,
      asString(payload.status) || 'Processing',
      JSON.stringify(Array.isArray(payload.items) ? payload.items : []),
      asNumber(payload.total, 0),
      asNumber(payload.shippingPrice ?? payload.shipping_price),
      asString(payload.shippingType || payload.shipping_type) || null,
      asString(payload.deliveryAddress || payload.delivery_address) || null,
      JSON.stringify(payload.customerInfo || payload.customer_info || {}),
      asString(payload.paymentReference || payload.payment_reference) || paystackReference,
      paystackReference,
      asString(payload.paymentMethod || payload.payment_method) || null,
      asString(payload.discountCode || payload.discount_code) || null,
      asString(payload.escrowStatus || payload.escrow_status) || null,
      asNumber(payload.commissionRate ?? payload.commission_rate),
      asDate(payload.fundsReleasedAt || payload.funds_released_at),
      asDate(payload.autoReleaseDate || payload.auto_release_date),
      asDate(payload.sentAt || payload.sent_at),
      asString(payload.sentPhotoUrl || payload.sent_photo_url) || null,
      asDate(payload.receivedAt || payload.received_at),
      asString(payload.receivedPhotoUrl || payload.received_photo_url) || null,
      asString(payload.waybillParkId || payload.waybill_park_id) || null,
      asString(payload.waybillParkName || payload.waybill_park_name) || null,
      dealThreadId,
      asString(payload.availabilityStatus || payload.availability_status) || null,
      payload.waitTimeDays ?? payload.wait_time_days ?? null,
      asDate(payload.waitTimeExpiresAt || payload.wait_time_expires_at),
      asString(payload.availabilityReason || payload.availability_reason) || null,
      payload.buyerWaitResponse ?? payload.buyer_wait_response ?? null,
      payload.dispute ? JSON.stringify(payload.dispute) : null,
      JSON.stringify(Array.isArray(payload.notes) ? payload.notes : []),
      JSON.stringify(Array.isArray(payload.refunds) ? payload.refunds : []),
      JSON.stringify(payload.marketMeta || payload.market_meta || {}),
      payload.lastMessage || payload.last_message
        ? JSON.stringify(payload.lastMessage || payload.last_message)
        : null,
      Number(payload.sellerUnreadCount ?? payload.seller_unread_count ?? 0),
      Number(payload.buyerUnreadCount ?? payload.buyer_unread_count ?? 0),
      asDate(payload.sellerAcceptedAt || payload.seller_accepted_at),
      asDate(payload.preparingAt || payload.preparing_at),
      asDate(payload.paymentVerifiedAt || payload.payment_verified_at),
      JSON.stringify(payload.raw || payload),
      asDate(payload.createdAt || payload.created_at) || new Date(),
      asDate(payload.updatedAt || payload.updated_at) || new Date(),
    ]
  );

  // Link deal thread when present
  if (dealThreadId) {
    await db.query(
      `UPDATE chat_threads
       SET linked_order_id = $2, status = CASE
         WHEN status IN ('completed', 'closed') THEN status
         ELSE 'in_order'
       END, updated_at = now()
       WHERE id = $1::uuid`,
      [dealThreadId, id]
    ).catch(() => {});
  }

  return getOrderByIdWithDb(db, id, { includeTimeline: false });
}

export async function upsertOrderFromPayload(payload = {}) {
  return upsertOrderWithDb(requirePool(), payload);
}

async function appendTimelineEventWithDb(db, payload = {}) {
  const orderId = asString(payload.orderId || payload.order_id);
  if (!orderId) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }

  const exists = await db.query(`SELECT id FROM orders WHERE id = $1 LIMIT 1`, [orderId]);
  if (!exists.rows[0]) {
    const err = new Error('Order not found');
    err.statusCode = 404;
    throw err;
  }

  const id = asString(payload.id) || `ote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.query(
    `INSERT INTO order_timeline_events (
       id, order_id, event, status, text, actor_id, actor_role, metadata, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, COALESCE($9, now()))
     ON CONFLICT (id) DO UPDATE SET
       event = EXCLUDED.event,
       status = EXCLUDED.status,
       text = EXCLUDED.text,
       actor_id = EXCLUDED.actor_id,
       actor_role = EXCLUDED.actor_role,
       metadata = EXCLUDED.metadata`,
    [
      id,
      orderId,
      asString(payload.event) || 'status_update',
      asString(payload.status) || null,
      asString(payload.text) || '',
      asString(payload.actorId || payload.actor_id) || null,
      asString(payload.actorRole || payload.actor_role) || null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      asDate(payload.createdAt || payload.created_at),
    ]
  );

  return { id, orderId };
}

export async function appendTimelineEvent(payload = {}) {
  return appendTimelineEventWithDb(requirePool(), payload);
}

async function bumpPostPurchaseCountWithDb(db, postId, buyerId = null) {
  const id = asString(postId);
  if (!id) return { skipped: true };
  await db.query(
    `UPDATE posts
     SET purchase_count = COALESCE(purchase_count, 0) + 1,
         last_buyer_id = COALESCE($2, last_buyer_id),
         updated_at = now()
     WHERE id = $1`,
    [id, asString(buyerId) || null]
  );
  return { success: true };
}

export async function bumpPostPurchaseCount(postId, buyerId = null) {
  return bumpPostPurchaseCountWithDb(requirePool(), postId, buyerId);
}

/**
 * Neon write primary: upsert order (+ optional timeline events + purchase bump)
 * and enqueue Firestore mirror rows in a single transaction.
 */
export async function commitOrderFromPayload(body = {}) {
  const poolDb = requirePool();
  const client = await poolDb.connect();
  const payload = body.order && typeof body.order === 'object' ? { ...body.order, ...body } : body;
  const enqueueFirestoreMirror = body.enqueueFirestoreMirror !== false;
  const timelineEvents = Array.isArray(body.timeline)
    ? body.timeline
    : body.timelineEvent
      ? [body.timelineEvent]
      : [];

  try {
    await client.query('BEGIN');

    const order = await upsertOrderWithDb(client, payload);
    const orderId = order.id;
    const timelineIds = [];

    for (const event of timelineEvents) {
      const result = await appendTimelineEventWithDb(client, {
        ...event,
        orderId,
      });
      timelineIds.push(result.id);
    }

    if (body.bumpPurchaseCount) {
      const postId = extractPostId(payload) || order.postId;
      if (postId) {
        await bumpPostPurchaseCountWithDb(client, postId, order.customerId);
      }
    }

    const outboxIds = [];
    if (enqueueFirestoreMirror) {
      const mirrorPayload = {
        ...payload,
        id: orderId,
        ...order,
      };
      delete mirrorPayload.timeline;
      delete mirrorPayload.timelineEvent;
      delete mirrorPayload.bumpPurchaseCount;
      delete mirrorPayload.enqueueFirestoreMirror;

      const orderOut = await client.query(
        `INSERT INTO order_outbox (order_id, kind, payload)
         VALUES ($1, 'firestore_order', $2::jsonb)
         RETURNING id`,
        [orderId, JSON.stringify(mirrorPayload)]
      );
      outboxIds.push(Number(orderOut.rows[0].id));

      for (let i = 0; i < timelineEvents.length; i++) {
        const event = timelineEvents[i];
        const eventId = timelineIds[i];
        const timelineOut = await client.query(
          `INSERT INTO order_outbox (order_id, kind, payload)
           VALUES ($1, 'firestore_timeline', $2::jsonb)
           RETURNING id`,
          [
            orderId,
            JSON.stringify({
              id: eventId,
              orderId,
              event: asString(event.event) || 'status_update',
              status: asString(event.status) || null,
              text: asString(event.text) || '',
              actorId: event.actorId || event.actor_id || null,
              actorRole: event.actorRole || event.actor_role || null,
              metadata: event.metadata || null,
              createdAt: event.createdAt || event.created_at || new Date().toISOString(),
            }),
          ]
        );
        outboxIds.push(Number(timelineOut.rows[0].id));
      }
    }

    await client.query('COMMIT');
    return { order, outboxIds, timelineIds };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listPendingOrderOutbox({ limit = 50 } = {}) {
  const db = requirePool();
  const take = Math.min(100, Math.max(1, Number(limit) || 50));
  const { rows } = await db.query(
    `SELECT id, order_id, kind, payload, created_at, attempts, last_error
     FROM order_outbox
     WHERE processed_at IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [take]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    orderId: row.order_id,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error || null,
  }));
}

export async function ackOrderOutbox(ids = []) {
  const db = requirePool();
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!list.length) return { acked: 0 };
  const { rowCount } = await db.query(
    `UPDATE order_outbox
     SET processed_at = now(), last_error = NULL
     WHERE id = ANY($1::bigint[]) AND processed_at IS NULL`,
    [list]
  );
  return { acked: rowCount || 0 };
}

export async function failOrderOutbox(ids = [], errorMessage = '') {
  const db = requirePool();
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!list.length) return { failed: 0 };
  const { rowCount } = await db.query(
    `UPDATE order_outbox
     SET attempts = attempts + 1,
         last_error = $2
     WHERE id = ANY($1::bigint[]) AND processed_at IS NULL`,
    [list, asString(errorMessage).slice(0, 500) || 'mirror failed']
  );
  return { failed: rowCount || 0 };
}

export async function getOrderByPaystackReference(reference) {
  const db = requirePool();
  const ref = asString(reference);
  if (!ref) return null;
  const { rows } = await db.query(
    `SELECT * FROM orders WHERE paystack_reference = $1 OR payment_reference = $1 OR idempotency_key = $1 LIMIT 1`,
    [ref]
  );
  return mapOrderRow(rows[0]);
}

export async function listOrdersForUser(userId, { role = 'all', limit = 40, cursor = null } = {}) {
  const db = requirePool();
  const uid = asString(userId);
  const take = Math.min(100, Math.max(1, Number(limit) || 40));
  const params = [uid];
  let where = '';

  if (role === 'buyer') {
    where = 'customer_id = $1';
  } else if (role === 'seller') {
    where = 'seller_id = $1';
  } else {
    where = '(customer_id = $1 OR seller_id = $1)';
  }

  if (cursor) {
    params.push(asDate(cursor) || new Date(0));
    where += ` AND created_at < $${params.length}`;
  }

  params.push(take + 1);
  const { rows } = await db.query(
    `SELECT * FROM orders
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > take;
  const slice = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? slice[slice.length - 1]?.created_at : null;
  return {
    orders: slice.map(mapOrderRow),
    next_cursor: nextCursor,
    has_more: hasMore,
  };
}

async function getOrderByIdWithDb(db, orderId, { includeTimeline = true } = {}) {
  const id = asString(orderId);
  if (!id) return null;
  const { rows } = await db.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [id]);
  const order = mapOrderRow(rows[0]);
  if (!order) return null;
  if (!includeTimeline) return order;

  const timeline = await db.query(
    `SELECT * FROM order_timeline_events
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [id]
  );
  return {
    ...order,
    timeline: timeline.rows.map(mapTimelineRow),
  };
}

export async function getOrderById(orderId, { includeTimeline = true } = {}) {
  return getOrderByIdWithDb(requirePool(), orderId, { includeTimeline });
}

/** Resolve the active order for a deal room when the client only has the chat thread id. */
export async function getOrderByDealThreadId(threadId, { includeTimeline = true } = {}) {
  const db = requirePool();
  const tid = asString(threadId);
  if (!tid) return null;
  const { rows } = await db.query(
    `SELECT * FROM orders
     WHERE deal_thread_id::text = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tid]
  );
  const order = mapOrderRow(rows[0]);
  if (!order) return null;
  if (!includeTimeline) return order;
  const timeline = await db.query(
    `SELECT * FROM order_timeline_events
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [order.id]
  );
  return {
    ...order,
    timeline: timeline.rows.map(mapTimelineRow),
  };
}

export async function assertOrderAccess(order, userId) {
  const uid = asString(userId);
  if (!order || !uid) {
    const err = new Error('Order not found');
    err.statusCode = 404;
    throw err;
  }
  if (order.customerId !== uid && order.sellerId !== uid) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
  return true;
}
