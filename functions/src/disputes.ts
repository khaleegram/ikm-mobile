/**
 * Marketplace dispute case — freeze escrow until admin refunds or releases.
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import { requireAdmin, requireAuth, sendError, sendResponse } from './utils';
import { createOrderTimelineEvent, createSystemMessage, dualWriteOrderToPostgres } from './order-chat';
import { notifySeller } from './notifications';

const corsHandler = cors({ origin: true });

const DISPUTE_CATEGORIES = [
  'not_received',
  'wrong_item',
  'damaged',
  'fake_or_not_as_described',
  'other',
] as const;

type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

function asCategory(value: unknown): DisputeCategory | null {
  const raw = String(value || '').trim();
  return (DISPUTE_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as DisputeCategory)
    : null;
}

const OPEN_FROM_STATUSES = new Set([
  'Paid',
  'Processing',
  'Accepted',
  'Preparing',
  'Sent',
  'AvailabilityCheck',
]);

function buildOrderSummary(order: Record<string, any>): string {
  const name = String(order.items?.[0]?.name || 'item');
  return `${name} — NGN ${Number(order.total || 0).toLocaleString()}`;
}

export const openOrderDispute = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, category, reason, evidenceUrls } = request.body || {};
      const id = String(orderId || '').trim();
      const cat = asCategory(category);
      const text = String(reason || '').trim().slice(0, 1200);
      const photos = Array.isArray(evidenceUrls)
        ? evidenceUrls.map((u: unknown) => String(u || '').trim()).filter(Boolean).slice(0, 6)
        : [];

      if (!id) return sendError(response, 'Order ID is required', 400);
      if (!cat) return sendError(response, 'Pick what went wrong.', 400);
      if (text.length < 12) {
        return sendError(response, 'Describe the problem in at least a short sentence.', 400);
      }

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(id);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return sendError(response, 'Order not found', 404);
      const order = orderSnap.data() || {};

      if (order.customerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Only the buyer can open a dispute', 403);
      }

      const status = String(order.status || '');
      if (status === 'Disputed') {
        return sendError(response, 'A dispute is already open for this order', 400);
      }
      if (status === 'Cancelled') {
        return sendError(response, 'This order is already cancelled', 400);
      }
      if (status === 'Completed' || order.escrowStatus === 'released' || order.escrowStatus === 'refunded') {
        return sendError(
          response,
          'Escrow already moved. Contact support — this case needs an admin.',
          400
        );
      }
      if (!OPEN_FROM_STATUSES.has(status)) {
        return sendError(response, `Cannot open a dispute while the order is ${status}`, 400);
      }

      const now = FieldValue.serverTimestamp();
      const casePayload = {
        orderId: id,
        buyerId: order.customerId,
        sellerId: order.sellerId,
        category: cat,
        reason: text,
        evidenceUrls: photos,
        status: 'open',
        openedAt: now,
        openedBy: auth.uid,
        updatedAt: now,
      };

      await firestore.collection('disputes').doc(id).set(casePayload, { merge: true });

      await orderRef.update({
        status: 'Disputed',
        escrowStatus: 'held',
        autoReleaseDate: FieldValue.delete(),
        disputeOpenedAt: now,
        disputeOpenedBy: auth.uid,
        disputeCategory: cat,
        disputeReason: text,
        disputeEvidenceUrls: photos,
        disputeStatus: 'open',
        updatedAt: now,
      });
      await dualWriteOrderToPostgres(id);

      const summary = buildOrderSummary(order);
      createSystemMessage({
        orderId: id,
        event: 'dispute_opened',
        dealThreadId: order.dealThreadId || order.chatThreadId || null,
        customText: `Buyer opened a dispute (${cat.replace(/_/g, ' ')}). Funds stay held until support decides.`,
      }).catch((e) => console.error('Failed to create dispute system message:', e));

      createOrderTimelineEvent({
        orderId: id,
        event: 'dispute_opened',
        status: 'Disputed',
        text: text.slice(0, 180),
        actorId: auth.uid,
        actorRole: 'buyer',
      }).catch((e) => console.error('Failed to create dispute timeline:', e));

      notifySeller({
        sellerId: String(order.sellerId || ''),
        event: 'dispute_opened',
        orderId: id,
        orderSummary: summary,
        extra: 'Money stays held. Reply in the deal room; support will decide.',
      }).catch((e) => console.error('Failed to notify seller of dispute:', e));

      return sendResponse(response, { success: true, disputeId: id });
    } catch (error: any) {
      console.error('openOrderDispute', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const getOpenDisputes = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      await requireAdmin(request.headers.authorization || null);

      const firestore = admin.firestore();
      const snap = await firestore
        .collection('orders')
        .where('status', '==', 'Disputed')
        .limit(80)
        .get();

      const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return sendResponse(response, { success: true, orders });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});
