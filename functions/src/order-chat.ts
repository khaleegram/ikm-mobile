import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
  requireAuth,
  sendError,
  sendResponse,
} from './utils';
import { notifyNewMessage } from './notifications';

const corsHandler = cors({ origin: true });

const chatApiBaseUrl = defineString('CHAT_API_BASE_URL', {
  default: 'https://chatcart-production.up.railway.app/v1',
});
const chatInternalSecret = defineString('CHAT_INTERNAL_SECRET', {
  default: '',
});

const SYSTEM_MESSAGES: Record<string, string> = {
  order_paid: 'Money held safely.',
  seller_accepted: 'Seller accepted your order.',
  seller_preparing: 'Seller is preparing your order.',
  order_shipped: 'Seller sent your item.',
  order_delivered: 'Buyer confirmed they got it.',
  buyer_confirmed: 'Buyer confirmed receipt. Order completed.',
  order_cancelled: 'Order cancelled.',
  dispute_opened: 'A dispute has been opened for this order.',
  dispute_resolved: 'Dispute resolved.',
  escrow_released: 'Money released to seller.',
  refund_requested: 'Refund on the way to the original payment method.',
  refund_processed: 'Refunded.',
};

function chatInternalHeaders(): Record<string, string> | null {
  const secret = chatInternalSecret.value().trim();
  if (!secret) return null;
  return {
    'Content-Type': 'application/json',
    'x-chat-internal-secret': secret,
  };
}

function chatApiUrl(path: string): string {
  const baseUrl = chatApiBaseUrl.value().replace(/\/$/, '');
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function serializeFirestoreValue(value: any): any {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.keys(value).forEach((key) => {
      out[key] = serializeFirestoreValue(value[key]);
    });
    return out;
  }
  return value;
}

/**
 * Neon is the order write primary. Firestore is a durable secondary mirror
 * drained from `order_outbox` (and best-effort immediate mirror after commit).
 */

export type OrderTimelineInput = {
  id?: string;
  event: string;
  status?: string;
  text?: string;
  actorId?: string;
  actorRole?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type CommitOrderOptions = {
  bumpPurchaseCount?: boolean;
  timeline?: OrderTimelineInput[];
  enqueueFirestoreMirror?: boolean;
};

function stripSyncBookkeeping(data: Record<string, any>): Record<string, any> {
  const out = { ...data };
  delete out.needsNeonSync;
  delete out.neonSyncError;
  delete out.neonSyncFailedAt;
  delete out.neonSyncBumpPurchaseCount;
  delete out.timeline;
  return out;
}

function toFirestoreTimestamp(value: any): admin.firestore.Timestamp | admin.firestore.FieldValue | any {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return admin.firestore.Timestamp.fromDate(d);
  }
  return value;
}

const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'paymentVerifiedAt',
  'sellerAcceptedAt',
  'preparingAt',
  'sentAt',
  'receivedAt',
  'fundsReleasedAt',
  'autoReleaseDate',
  'waitTimeExpiresAt',
  'disputeOpenedAt',
  'disputeResolvedAt',
]);

/** Convert a JSON order payload into Firestore-friendly fields. */
export function orderPayloadForFirestore(payload: Record<string, any>): Record<string, any> {
  const data = stripSyncBookkeeping(payload);
  delete data.id;
  delete data.orderId;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (DATE_FIELDS.has(key)) {
      out[key] = toFirestoreTimestamp(value);
    } else if (key === 'lastMessage' && value && typeof value === 'object') {
      out[key] = {
        ...value,
        createdAt: toFirestoreTimestamp((value as any).createdAt) || FieldValue.serverTimestamp(),
      };
    } else {
      out[key] = value;
    }
  }
  if (!out.updatedAt) out.updatedAt = FieldValue.serverTimestamp();
  return out;
}

/**
 * Commit order (+ optional timeline) to Neon as primary.
 * Throws on failure — money paths must not continue without Neon durability.
 */
export async function commitOrderPrimary(
  payload: Record<string, any>,
  options: CommitOrderOptions = {}
): Promise<{ order: Record<string, any>; outboxIds: number[]; timelineIds: string[] }> {
  const headers = chatInternalHeaders();
  if (!headers) {
    throw new Error('CHAT_INTERNAL_SECRET missing — cannot commit order to Neon');
  }

  const orderId = String(payload.id || payload.orderId || '').trim();
  if (!orderId) throw new Error('order id is required for Neon commit');

  const body = {
    ...stripSyncBookkeeping(payload),
    id: orderId,
    bumpPurchaseCount: Boolean(options.bumpPurchaseCount),
    enqueueFirestoreMirror: options.enqueueFirestoreMirror !== false,
    timeline: options.timeline || [],
    postId: payload.postId || payload.marketMeta?.postId,
  };

  const response = await fetch(chatApiUrl('/orders/internal/commit'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || `Neon order commit failed (HTTP ${response.status})`);
  }
  return {
    order: result.order || { id: orderId },
    outboxIds: Array.isArray(result.outboxIds) ? result.outboxIds.map(Number) : [],
    timelineIds: Array.isArray(result.timelineIds) ? result.timelineIds.map(String) : [],
  };
}

export async function ackOrderOutbox(ids: number[]): Promise<void> {
  const headers = chatInternalHeaders();
  if (!headers || !ids.length) return;
  try {
    await fetch(chatApiUrl('/orders/internal/outbox/ack'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids }),
    });
  } catch (error) {
    console.warn('ackOrderOutbox failed', error);
  }
}

export async function failOrderOutbox(ids: number[], errorMessage: string): Promise<void> {
  const headers = chatInternalHeaders();
  if (!headers || !ids.length) return;
  try {
    await fetch(chatApiUrl('/orders/internal/outbox/fail'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids, error: errorMessage }),
    });
  } catch (error) {
    console.warn('failOrderOutbox failed', error);
  }
}

/** Best-effort Firestore mirror for seller/admin shells. */
export async function mirrorOrderToFirestore(payload: Record<string, any>): Promise<void> {
  const orderId = String(payload.id || payload.orderId || '').trim();
  if (!orderId) throw new Error('order id required for Firestore mirror');
  const firestore = admin.firestore();
  await firestore.collection('orders').doc(orderId).set(orderPayloadForFirestore(payload), { merge: true });
}

export async function mirrorTimelineToFirestore(payload: {
  id?: string;
  orderId: string;
  event: string;
  status?: string;
  text?: string;
  actorId?: string | null;
  actorRole?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}): Promise<void> {
  const firestore = admin.firestore();
  const eventId =
    String(payload.id || '').trim() ||
    firestore.collection('orders').doc(payload.orderId).collection('timeline').doc().id;
  await firestore
    .collection('orders')
    .doc(payload.orderId)
    .collection('timeline')
    .doc(eventId)
    .set(
      {
        orderId: payload.orderId,
        event: payload.event,
        status: payload.status || null,
        text: payload.text || '',
        actorId: payload.actorId || null,
        actorRole: payload.actorRole || null,
        metadata: payload.metadata || null,
        createdAt: toFirestoreTimestamp(payload.createdAt) || FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * Neon commit then immediate Firestore mirror + outbox ack.
 * If FS mirror fails, outbox rows stay pending for drainOrderOutboxToFirestore.
 */
export async function commitAndMirrorOrder(
  payload: Record<string, any>,
  options: CommitOrderOptions = {}
): Promise<{ order: Record<string, any>; outboxIds: number[] }> {
  const result = await commitOrderPrimary(payload, options);
  const orderId = String(payload.id || result.order?.id || '').trim();
  const mirrorPayload = { ...payload, ...result.order, id: orderId };

  try {
    await mirrorOrderToFirestore(mirrorPayload);
    for (let i = 0; i < (options.timeline || []).length; i++) {
      const event = options.timeline![i];
      const eventId = result.timelineIds[i];
      await mirrorTimelineToFirestore({
        id: eventId || event.id,
        orderId,
        event: event.event,
        status: event.status,
        text: event.text,
        actorId: event.actorId,
        actorRole: event.actorRole,
        metadata: event.metadata,
        createdAt: event.createdAt,
      });
    }
    if (result.outboxIds.length) await ackOrderOutbox(result.outboxIds);
  } catch (error: any) {
    console.warn('Firestore mirror after Neon commit failed; outbox will drain', orderId, error);
    if (result.outboxIds.length) {
      await failOrderOutbox(result.outboxIds, String(error?.message || error));
    }
  }
  return { order: result.order, outboxIds: result.outboxIds };
}

export async function fetchNeonOrderById(orderId: string): Promise<Record<string, any> | null> {
  const headers = chatInternalHeaders();
  const id = String(orderId || '').trim();
  if (!headers || !id) return null;
  try {
    const response = await fetch(chatApiUrl(`/orders/internal/${encodeURIComponent(id)}`), {
      method: 'GET',
      headers,
    });
    if (!response.ok) return null;
    const payload: any = await response.json().catch(() => null);
    return payload?.order && typeof payload.order === 'object' ? payload.order : null;
  } catch {
    return null;
  }
}

export async function fetchNeonOrdersByReference(
  reference: string
): Promise<{
  order: Record<string, any> | null;
  orders: Record<string, any>[];
  orderIds: string[];
  checkout: Record<string, any> | null;
}> {
  const empty = { order: null, orders: [], orderIds: [], checkout: null };
  const headers = chatInternalHeaders();
  const ref = String(reference || '').trim();
  if (!headers || !ref) return empty;
  try {
    const response = await fetch(
      chatApiUrl(`/orders/internal/by-reference/${encodeURIComponent(ref)}`),
      { method: 'GET', headers }
    );
    if (!response.ok) return empty;
    const payload: any = await response.json().catch(() => null);
    const orders = Array.isArray(payload?.orders)
      ? payload.orders.filter((o: any) => o && typeof o === 'object')
      : payload?.order
        ? [payload.order]
        : [];
    return {
      order: orders[0] || null,
      orders,
      orderIds: orders.map((o: any) => String(o.id || '')).filter(Boolean),
      checkout: payload?.checkout && typeof payload.checkout === 'object' ? payload.checkout : null,
    };
  } catch {
    return empty;
  }
}

export async function fetchNeonOrderByReference(reference: string): Promise<Record<string, any> | null> {
  const result = await fetchNeonOrdersByReference(reference);
  return result.order;
}

export async function upsertNeonCheckoutPayment(payload: {
  id?: string;
  buyerId: string;
  paystackReference: string;
  amount: number;
  currency?: string;
  status?: string;
  cartSessionId?: string | null;
  lineItems?: unknown[];
}): Promise<Record<string, any> | null> {
  const headers = chatInternalHeaders();
  if (!headers) return null;
  try {
    const response = await fetch(chatApiUrl('/checkout-payments/internal/upsert'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn('upsertNeonCheckoutPayment failed', response.status, errText);
      return null;
    }
    const body: any = await response.json().catch(() => null);
    return body?.checkout && typeof body.checkout === 'object' ? body.checkout : null;
  } catch (error) {
    console.warn('upsertNeonCheckoutPayment error', error);
    return null;
  }
}

/**
 * After a Firestore mutation (legacy call sites): push the FS doc to Neon as primary
 * commit. FS is already current so we skip enqueueing a mirror (enqueueFirestoreMirror:false)
 * unless options force it. Prefer commitAndMirrorOrder for new Neon-first paths.
 */
export async function dualWriteOrderToPostgres(
  orderId: string,
  options: { bumpPurchaseCount?: boolean } = {}
): Promise<void> {
  const firestore = admin.firestore();
  const orderRef = firestore.collection('orders').doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) {
    throw new Error(`Order ${orderId} missing for Neon primary commit`);
  }
  const raw = serializeFirestoreValue(snap.data() || {}) as Record<string, any>;
  const bumpPurchaseCount = Boolean(options.bumpPurchaseCount || raw.neonSyncBumpPurchaseCount);
  const data = stripSyncBookkeeping(raw);

  try {
    await commitOrderPrimary(
      {
        id: orderId,
        ...data,
        postId: data.postId || data.marketMeta?.postId,
      },
      {
        bumpPurchaseCount,
        // FS already has the doc — do not create a redundant outbox row.
        enqueueFirestoreMirror: false,
      }
    );
  } catch (error: any) {
    // The Firestore mutation already happened before this call, so a Neon failure
    // leaves the two stores diverged: Firestore is ahead of the write primary.
    // Record the marker the reverse drain looks for, then rethrow so the caller
    // still fails loudly. Without this, divergence is invisible and never repaired.
    const marker: Record<string, any> = {
      needsNeonSync: true,
      neonSyncError: String(error?.message || error),
      neonSyncFailedAt: FieldValue.serverTimestamp(),
    };
    if (bumpPurchaseCount) marker.neonSyncBumpPurchaseCount = true;

    await orderRef
      .set(marker, { merge: true })
      .catch((markerError) =>
        console.error('Failed to record Neon sync marker for', orderId, markerError)
      );

    throw error;
  }

  // Clear any legacy reverse-sync markers.
  if (raw.needsNeonSync || raw.neonSyncBumpPurchaseCount) {
    await orderRef.set(
      {
        needsNeonSync: FieldValue.delete(),
        neonSyncError: FieldValue.delete(),
        neonSyncFailedAt: FieldValue.delete(),
        neonSyncBumpPurchaseCount: FieldValue.delete(),
      },
      { merge: true }
    );
  }
}

/**
 * Drain Neon→Firestore outbox. Also one-shot drains legacy needsNeonSync markers.
 */
export const drainOrderOutboxToFirestore = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const secret = String(request.headers['x-chat-internal-secret'] || '').trim();
      const expected = chatInternalSecret.value().trim();
      if (!expected || secret !== expected) {
        return sendError(response, 'Forbidden', 403);
      }

      const headers = chatInternalHeaders();
      if (!headers) return sendError(response, 'CHAT_INTERNAL_SECRET missing', 500);

      const pendingRes = await fetch(chatApiUrl('/orders/internal/outbox/pending?limit=100'), {
        method: 'GET',
        headers,
      });
      const pendingPayload: any = await pendingRes.json().catch(() => ({}));
      const items: any[] = Array.isArray(pendingPayload?.items) ? pendingPayload.items : [];

      let mirrored = 0;
      let failed = 0;
      for (const item of items) {
        const id = Number(item.id);
        try {
          if (item.kind === 'firestore_timeline') {
            await mirrorTimelineToFirestore({
              ...(item.payload || {}),
              orderId: item.orderId || item.payload?.orderId,
            });
          } else {
            await mirrorOrderToFirestore({
              ...(item.payload || {}),
              id: item.orderId || item.payload?.id,
            });
          }
          await ackOrderOutbox([id]);
          mirrored++;
        } catch (error: any) {
          failed++;
          await failOrderOutbox([id], String(error?.message || error));
        }
      }

      // Legacy reverse drain: FS docs that never made it to Neon before cutover.
      const firestore = admin.firestore();
      const legacy = await firestore
        .collection('orders')
        .where('needsNeonSync', '==', true)
        .limit(50)
        .get();
      let legacySynced = 0;
      let legacyFailed = 0;
      for (const doc of legacy.docs) {
        try {
          await dualWriteOrderToPostgres(doc.id);
          legacySynced++;
        } catch {
          legacyFailed++;
        }
      }

      return sendResponse(response, {
        success: true,
        outbox: { pending: items.length, mirrored, failed },
        legacyNeedsNeonSync: { pending: legacy.size, synced: legacySynced, failed: legacyFailed },
      });
    } catch (error: any) {
      console.error('Error in drainOrderOutboxToFirestore:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/** @deprecated Use drainOrderOutboxToFirestore — kept as alias for existing schedulers. */
export const resyncOrdersToPostgres = drainOrderOutboxToFirestore;

async function notifyPostgresDealThread(input: {
  threadId?: string | null;
  orderId: string;
  event: string;
  text: string;
  photoUrl?: string | null;
}): Promise<void> {
  const headers = chatInternalHeaders();
  const threadId = String(input.threadId || '').trim();
  if (!headers || !threadId) return;

  try {
    const response = await fetch(chatApiUrl('/chat/internal/system-event'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        threadId,
        orderId: input.orderId,
        event: input.event,
        text: input.text,
        photoUrl: input.photoUrl || undefined,
      }),
    });
    if (!response.ok) {
      console.warn('Postgres deal-thread system event failed', await response.text());
    }
  } catch (error) {
    console.warn('Postgres deal-thread system event error', error);
  }
}

/**
 * Read a user profile from Neon (chatcart-api) — the market source of truth for
 * buyer phone/location/display name. Returns null on any failure so callers can
 * fall back to the legacy Firestore users doc.
 */
export async function fetchNeonUserProfile(userId: string): Promise<Record<string, any> | null> {
  const headers = chatInternalHeaders();
  const uid = String(userId || '').trim();
  if (!headers || !uid) return null;

  try {
    const response = await fetch(chatApiUrl(`/users/internal/${encodeURIComponent(uid)}`), {
      method: 'GET',
      headers,
    });
    if (!response.ok) return null;
    const payload: any = await response.json().catch(() => null);
    return payload?.user && typeof payload.user === 'object' ? payload.user : null;
  } catch (error) {
    console.warn('fetchNeonUserProfile failed', error);
    return null;
  }
}

/** Resolve or create a Postgres deal thread for marketplace escrow orders. */
export async function ensureDealThreadForOrder(input: {
  buyerId: string;
  postId: string;
  sellerId?: string | null;
  threadId?: string | null;
}): Promise<string | null> {
  const headers = chatInternalHeaders();
  if (!headers) {
    console.warn('CHAT_INTERNAL_SECRET missing; cannot ensure deal thread');
    return String(input.threadId || '').trim() || null;
  }

  try {
    const response = await fetch(chatApiUrl('/chat/internal/ensure-deal-thread'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        buyerId: input.buyerId,
        postId: input.postId,
        sellerId: input.sellerId || undefined,
        threadId: input.threadId || undefined,
      }),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('ensure-deal-thread failed', payload?.error || response.status);
      return String(input.threadId || '').trim() || null;
    }
    return String(payload?.threadId || payload?.thread?.id || input.threadId || '').trim() || null;
  } catch (error) {
    console.warn('ensure-deal-thread error', error);
    return String(input.threadId || '').trim() || null;
  }
}

export async function createSystemMessage(input: {
  orderId: string;
  event: string;
  customText?: string;
  dealThreadId?: string | null;
  photoUrl?: string | null;
}): Promise<void> {
  const firestore = admin.firestore();
  const text = input.customText || SYSTEM_MESSAGES[input.event] || `Order status: ${input.event}`;

  const messageRef = firestore
    .collection('orders')
    .doc(input.orderId)
    .collection('messages')
    .doc();

  await messageRef.set({
    orderId: input.orderId,
    senderId: 'system',
    senderRole: 'system',
    type: 'system',
    text,
    systemEvent: input.event,
    ...(input.photoUrl ? { mediaUrl: input.photoUrl } : {}),
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  await firestore.collection('orders').doc(input.orderId).update({
    lastMessage: {
      text,
      senderRole: 'system',
      createdAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  const orderSnap = await firestore.collection('orders').doc(input.orderId).get();
  const dealThreadId =
    input.dealThreadId ||
    orderSnap.data()?.dealThreadId ||
    orderSnap.data()?.chatThreadId ||
    null;

  await notifyPostgresDealThread({
    threadId: dealThreadId,
    orderId: input.orderId,
    event: input.event,
    text,
    photoUrl: input.photoUrl || null,
  });
}

async function incrementUnread(orderId: string, role: 'buyer' | 'seller'): Promise<void> {
  const firestore = admin.firestore();
  const field = role === 'buyer' ? 'buyerUnreadCount' : 'sellerUnreadCount';
  await firestore.collection('orders').doc(orderId).update({
    [field]: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function resetUnread(orderId: string, role: 'buyer' | 'seller'): Promise<void> {
  const firestore = admin.firestore();
  const field = role === 'buyer' ? 'buyerUnreadCount' : 'sellerUnreadCount';
  await firestore.collection('orders').doc(orderId).update({
    [field]: 0,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export const sendOrderChatMessage = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, text, type, mediaUrl, mediaType, proofCategory } = request.body;

      if (!orderId) return sendError(response, 'Order ID is required', 400);
      if (!text && !mediaUrl) return sendError(response, 'Message text or media is required', 400);

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);

      const order = orderDoc.data()!;
      const isBuyer = order.customerId === auth.uid;
      const isSeller = order.sellerId === auth.uid;

      if (!isBuyer && !isSeller) {
        return sendError(response, 'Unauthorized: You are not a participant in this order', 403);
      }

      const senderRole = isBuyer ? 'buyer' : 'seller';
      const recipientId = isBuyer ? order.sellerId : order.customerId;

      const messageRef = firestore
        .collection('orders')
        .doc(orderId)
        .collection('messages')
        .doc();

      const messageData: Record<string, any> = {
        orderId,
        senderId: auth.uid,
        senderRole,
        type: type || 'text',
        text: text || null,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        proofCategory: proofCategory || null,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      };

      await messageRef.set(messageData);

      const preview = text
        ? text.slice(0, 80)
        : mediaUrl
          ? '📎 Attachment'
          : 'New message';

      await orderRef.update({
        lastMessage: {
          text: preview,
          senderRole,
          createdAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      await incrementUnread(orderId, isBuyer ? 'seller' : 'buyer');

      const orderSummary = (order.items?.[0]?.name || 'item') + (order.items?.length > 1 ? ` +${order.items.length - 1}` : '');

      notifyNewMessage({
        recipientId,
        senderName: senderRole === 'buyer' ? 'Buyer' : 'Seller',
        orderId,
        orderSummary,
        messagePreview: preview,
      }).catch((err) => console.error('Failed to send message notification:', err));

      return sendResponse(response, {
        success: true,
        messageId: messageRef.id,
      });
    } catch (error: any) {
      console.error('Error sending order message:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const markOrderMessagesRead = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId } = request.body;

      if (!orderId) return sendError(response, 'Order ID is required', 400);

      const firestore = admin.firestore();
      const orderDoc = await firestore.collection('orders').doc(orderId).get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);

      const order = orderDoc.data()!;
      const isBuyer = order.customerId === auth.uid;
      const isSeller = order.sellerId === auth.uid;

      if (!isBuyer && !isSeller && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const unreadSnap = await firestore
        .collection('orders')
        .doc(orderId)
        .collection('messages')
        .where('senderId', '!=', auth.uid)
        .where('read', '==', false)
        .get();

      if (unreadSnap.empty) {
        return sendResponse(response, { success: true, marked: 0 });
      }

      const batch = firestore.batch();
      unreadSnap.docs.forEach((doc) => {
        batch.update(doc.ref, {
          read: true,
          readAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();

      await resetUnread(orderId, isBuyer ? 'buyer' : 'seller');

      return sendResponse(response, { success: true, marked: unreadSnap.size });
    } catch (error: any) {
      console.error('Error marking order messages read:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const createOrderTimelineEvent = async (input: {
  orderId: string;
  event: string;
  status: string;
  text: string;
  actorId?: string;
  actorRole?: 'buyer' | 'seller' | 'system' | 'admin';
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  const firestore = admin.firestore();
  const orderSnap = await firestore.collection('orders').doc(input.orderId).get();
  const existing = orderSnap.exists
    ? (serializeFirestoreValue(orderSnap.data() || {}) as Record<string, any>)
    : (await fetchNeonOrderById(input.orderId)) || {};

  const timelineEvent: OrderTimelineInput = {
    event: input.event,
    status: input.status,
    text: input.text,
    actorId: input.actorId,
    actorRole: input.actorRole,
    metadata: input.metadata,
    createdAt: new Date().toISOString(),
  };

  // Neon primary (+ outbox for FS timeline). If order missing on FS, still commit when Neon has it.
  if (existing && (existing.customerId || existing.sellerId)) {
    await commitAndMirrorOrder(
      {
        id: input.orderId,
        ...existing,
      },
      { timeline: [timelineEvent], enqueueFirestoreMirror: true }
    );
    return;
  }

  // Fallback: FS-only timeline write if order cannot be loaded (should be rare).
  const eventRef = firestore.collection('orders').doc(input.orderId).collection('timeline').doc();
  await eventRef.set({
    orderId: input.orderId,
    event: input.event,
    status: input.status,
    text: input.text,
    actorId: input.actorId || null,
    actorRole: input.actorRole || null,
    metadata: input.metadata || null,
    createdAt: FieldValue.serverTimestamp(),
  });
};
