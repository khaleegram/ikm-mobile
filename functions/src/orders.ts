import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineBoolean } from 'firebase-functions/params';
import cors = require('cors');
import {
    requireAuth,
    sendError,
    sendResponse,
} from './utils';
import {
    notifyBuyer,
    notifySeller,
} from './notifications';
import {
    createSystemMessage,
    createOrderTimelineEvent,
    // After FS mutation: push current FS doc to Neon (write primary). Throws on Neon failure.
    dualWriteOrderToPostgres,
} from './order-chat';
import { paystackSecret, processOrderRefund } from './refunds';
import {
    isEscrowHeld,
    isEscrowSettled,
    releaseOrderEscrow,
    type ReleaseEscrowResult,
    type ReleaseSource,
} from './escrow';

const corsHandler = cors({ origin: true });

const VALID_TRANSITIONS: Record<string, string[]> = {
  Paid: ['Accepted', 'Cancelled'],
  Processing: ['Accepted', 'Cancelled'],
  Accepted: ['Preparing', 'Cancelled'],
  Preparing: ['Sent', 'Cancelled'],
  Sent: ['Received', 'Disputed'],
  Received: ['Completed', 'Disputed'],
  Completed: [],
  Cancelled: [],
  Disputed: ['Cancelled', 'Completed'],
  // Wait-time delays can still ship early; pure cancel stays available too.
  AvailabilityCheck: ['Cancelled', 'Sent'],
};

function isValidTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) return false;
  return allowed.includes(next);
}

function buildOrderSummary(order: any): string {
  const data = order.data ? order.data() : order;
  const item = data.items?.[0]?.name || 'item';
  const total = Number(data.total || 0);
  const extra = data.items?.length > 1 ? ` +${data.items.length - 1} more` : '';
  return `${item}${extra} — NGN ${total.toLocaleString()}`;
}

/**
 * Release escrow and tell everyone about it. Every path that pays a seller goes
 * through here — buyer confirmation, the auto-release timer, and admins resolving
 * a dispute — so the ledger, the Neon mirror and the chat all agree.
 */
async function releaseEscrowAndAnnounce(params: {
  orderId: string;
  source: ReleaseSource;
  event: string;
  text: string;
  actorId?: string;
  actorRole?: 'buyer' | 'seller' | 'system' | 'admin';
  note?: string;
  notifyBuyerOnComplete?: boolean;
}): Promise<ReleaseEscrowResult> {
  const result = await releaseOrderEscrow({
    orderId: params.orderId,
    source: params.source,
    actorId: params.actorId,
    actorRole: params.actorRole,
    note: params.note,
  });

  if (result.outcome !== 'released' || !result.order) return result;

  const order = result.order;
  const dealThreadId = order.dealThreadId || order.chatThreadId || null;
  const summary = buildOrderSummary(order);

  // Throws on Neon failure — callers decide whether that is fatal.
  await dualWriteOrderToPostgres(params.orderId);

  createSystemMessage({
    orderId: params.orderId,
    event: params.event,
    dealThreadId,
  }).catch((e) => console.error('Failed to create system message:', e));

  createOrderTimelineEvent({
    orderId: params.orderId,
    event: params.event,
    status: 'Completed',
    text: params.text,
    actorId: params.actorId,
    actorRole: params.actorRole,
  }).catch((e) => console.error('Failed to create timeline event:', e));

  notifySeller({
    sellerId: String(order.sellerId || ''),
    event: 'escrow_released',
    orderId: params.orderId,
    orderSummary: summary,
    chatRoomId: dealThreadId,
  }).catch((e) => console.error('Failed to notify seller:', e));

  if (params.notifyBuyerOnComplete) {
    notifyBuyer({
      buyerId: String(order.customerId || ''),
      event: 'order_delivered',
      orderId: params.orderId,
      orderSummary: summary,
      extra: 'Delivery confirmed automatically. The seller has been paid.',
      chatRoomId: dealThreadId,
    }).catch((e) => console.error('Failed to notify buyer:', e));
  }

  return result;
}

export const updateOrderStatus = onRequest(
  { secrets: [paystackSecret], invoker: 'public' },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, status } = request.body;
      if (!orderId || !status) return sendError(response, 'Order ID and status are required');

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);
      const order = orderDoc.data()!;
      const currentStatus = order.status || 'Paid';

      if (!isValidTransition(currentStatus, status)) {
        return sendError(
          response,
          `Cannot transition from ${currentStatus} to ${status}`,
          400
        );
      }

      const isBuyer = order.customerId === auth.uid;
      const isSeller = order.sellerId === auth.uid;

      const buyerOnly = ['Received', 'Completed', 'Disputed'];
      const sellerOnly = ['Accepted', 'Preparing', 'Sent'];

      if (buyerOnly.includes(status) && !isBuyer && !auth.isAdmin) {
        return sendError(response, 'Only the buyer can perform this action', 403);
      }

      if (sellerOnly.includes(status) && !isSeller && !auth.isAdmin) {
        return sendError(response, 'Only the seller can perform this action', 403);
      }

      // Completing an order is what moves money to the seller, so it goes through
      // the escrow module instead of the generic status write below.
      if (status === 'Completed') {
        const release = await releaseEscrowAndAnnounce({
          orderId,
          source: auth.isAdmin ? 'admin' : 'buyer',
          actorId: auth.uid,
          actorRole: isBuyer ? 'buyer' : isSeller ? 'seller' : 'system',
          event: 'buyer_confirmed',
          text: 'Buyer confirmed receipt',
        });
        if (release.outcome !== 'released' && release.outcome !== 'already_released') {
          return sendError(response, `Cannot complete order: ${release.outcome}`, 400);
        }
        return sendResponse(response, { success: true, escrow: release.outcome });
      }

      // Cancel → real Paystack refund when escrow still held
      if (status === 'Cancelled') {
        if (order.escrowStatus === 'released') {
          return sendError(
            response,
            'Cannot cancel for refund: escrow already released to the seller.',
            400
          );
        }

        const refundResult = await processOrderRefund(
          {
            orderId,
            reason: isBuyer ? 'Buyer cancelled order' : isSeller ? 'Seller cancelled order' : 'Order cancelled',
            actorId: auth.uid,
            actorRole: isBuyer ? 'buyer' : isSeller ? 'seller' : 'admin',
            cancelOrder: true,
          },
          { secretKey: paystackSecret.value() }
        );

        const summary = buildOrderSummary(order);
        notifyBuyer({
          buyerId: order.customerId,
          event: 'order_cancelled',
          orderId,
          orderSummary: summary,
          extra: 'Refund to your payment method is processing.',
          chatRoomId: order.dealThreadId || order.chatThreadId || null,
        }).catch((e) => console.error('Failed to notify buyer:', e));

        notifySeller({
          sellerId: order.sellerId,
          event: 'refund_requested',
          orderId,
          orderSummary: summary,
          chatRoomId: order.dealThreadId || order.chatThreadId || null,
        }).catch((e) => console.error('Failed to notify seller:', e));

        createOrderTimelineEvent({
          orderId,
          event: 'order_cancelled',
          status: 'Cancelled',
          text: 'Order cancelled',
          actorId: auth.uid,
          actorRole: isBuyer ? 'buyer' : isSeller ? 'seller' : 'system',
        }).catch((e) => console.error('Failed to create timeline event:', e));

        await dualWriteOrderToPostgres(orderId);

        return sendResponse(response, { success: true, refund: refundResult });
      }

      const updateData: Record<string, any> = {};
      const now = FieldValue.serverTimestamp();

      switch (status) {
        case 'Accepted':
          updateData.status = 'Accepted';
          updateData.sellerAcceptedAt = now;
          break;
        case 'Preparing':
          updateData.status = 'Preparing';
          updateData.preparingAt = now;
          break;
        case 'Sent':
          updateData.status = 'Sent';
          updateData.sentAt = now;
          break;
        case 'Received':
          updateData.status = 'Received';
          updateData.receivedAt = now;
          break;
        // 'Completed' is handled above: it releases escrow through ./escrow.
        case 'Disputed':
          updateData.status = 'Disputed';
          updateData.escrowStatus = 'held';
          updateData.autoReleaseDate = FieldValue.delete();
          updateData.disputeOpenedAt = now;
          updateData.disputeStatus = 'open';
          break;
        default:
          updateData.status = status;
      }

      updateData.updatedAt = now;

      await orderRef.update(updateData);
      await dualWriteOrderToPostgres(orderId);

      const eventMap: Record<string, string> = {
        Accepted: 'seller_accepted',
        Preparing: 'seller_preparing',
        Sent: 'order_shipped',
        Received: 'order_delivered',
        Completed: 'buyer_confirmed',
        Disputed: 'dispute_opened',
      };

      const event = eventMap[status];
      if (event) {
        createSystemMessage({
          orderId,
          event,
          dealThreadId: order.dealThreadId || order.chatThreadId || null,
        }).catch((e) =>
          console.error('Failed to create system message:', e)
        );

        createOrderTimelineEvent({
          orderId,
          event,
          status,
          text: event.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          actorId: auth.uid,
          actorRole: isBuyer ? 'buyer' : isSeller ? 'seller' : 'system',
        }).catch((e) => console.error('Failed to create timeline event:', e));
      }

      const summary = buildOrderSummary(order);

      if (status === 'Accepted' || status === 'Preparing' || status === 'Sent') {
        notifyBuyer({
          buyerId: order.customerId,
          event: status === 'Sent' ? 'order_shipped' : 'payment_success',
          orderId,
          orderSummary: summary,
          extra: status === 'Sent' ? 'In transit' : undefined,
        }).catch((e) => console.error('Failed to notify buyer:', e));
      }

      if (status === 'Received') {
        notifyBuyer({
          buyerId: order.customerId,
          event: 'order_delivered',
          orderId,
          orderSummary: summary,
        }).catch((e) => console.error('Failed to notify buyer:', e));
      }

      if (status === 'Completed') {
        notifyBuyer({
          buyerId: order.customerId,
          event: 'payment_success',
          orderId,
          orderSummary: summary,
        }).catch((e) => console.error('Failed to notify buyer:', e));

        notifySeller({
          sellerId: order.sellerId,
          event: 'escrow_released',
          orderId,
          orderSummary: `NGN ${Number(order.total || 0).toLocaleString()}`,
        }).catch((e) => console.error('Failed to notify seller:', e));
      }

      if (status === 'Disputed') {
        notifySeller({
          sellerId: order.sellerId,
          event: 'dispute_opened',
          orderId,
          orderSummary: summary,
        }).catch((e) => console.error('Failed to notify seller:', e));
      }

      return sendResponse(response, { success: true });
    } catch (error: any) {
      const statusCode = error?.code === 'ESCROW_RELEASED' ? 400 : 500;
      return sendError(response, error.message || 'Internal server error', statusCode);
    }
  });
});

export const sellerAcceptOrder = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId } = request.body;
      if (!orderId) return sendError(response, 'Order ID is required', 400);

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);
      const order = orderDoc.data()!;

      if (order.sellerId !== auth.uid) return sendError(response, 'Only the seller can accept this order', 403);
      if (order.status !== 'Paid' && order.status !== 'Processing') {
        return sendError(response, `Cannot accept order in ${order.status} status`, 400);
      }

      const now = FieldValue.serverTimestamp();

      await orderRef.update({
        status: 'Accepted',
        sellerAcceptedAt: now,
        updatedAt: now,
      });
      await dualWriteOrderToPostgres(orderId);

      const event = 'seller_accepted';
      const summary = buildOrderSummary(order);

      createSystemMessage({
        orderId,
        event,
        dealThreadId: order.dealThreadId || order.chatThreadId || null,
      }).catch((e) =>
        console.error('Failed to create system message:', e)
      );

      createOrderTimelineEvent({
        orderId,
        event,
        status: 'Accepted',
        text: 'Seller accepted the order',
        actorId: auth.uid,
        actorRole: 'seller',
      }).catch((e) => console.error('Failed to create timeline event:', e));

      notifyBuyer({
        buyerId: order.customerId,
        event: 'payment_success',
        orderId,
        orderSummary: summary,
      }).catch((e) => console.error('Failed to notify buyer:', e));

      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const markOrderAsSent = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, photoUrl, waybillParkId, waybillParkName } = request.body;
      if (!orderId) return sendError(response, 'Order ID is required', 400);

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);
      const order = orderDoc.data()!;

      if (order.sellerId !== auth.uid) return sendError(response, 'Only the seller can mark as shipped', 403);

      const status = String(order.status || '');
      const availabilityStatus = String(order.availabilityStatus || '');
      const waitDays = Number(order.waitTimeDays);
      // "Need more time" parks the order in AvailabilityCheck — seller must still be
      // able to ship early once the item is ready. Pure "not available" cannot ship.
      const canShipAvailabilityWait =
        status === 'AvailabilityCheck' &&
        availabilityStatus !== 'not_available' &&
        (availabilityStatus === 'waiting_buyer_response' ||
          availabilityStatus === 'waiting_restock' ||
          (Number.isFinite(waitDays) && waitDays > 0));
      const allowedStatuses = ['Accepted', 'Preparing', 'Processing', 'Paid'];
      if (!allowedStatuses.includes(status) && !canShipAvailabilityWait) {
        return sendError(response, `Cannot ship order in ${status} status`, 400);
      }

      const now = FieldValue.serverTimestamp();
      const autoReleaseDate = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const updateData: Record<string, any> = {
        status: 'Sent',
        sentAt: now,
        autoReleaseDate: admin.firestore.Timestamp.fromDate(autoReleaseDate),
        updatedAt: now,
        // Clear wait/unavailable gate once the parcel is actually on the way.
        availabilityStatus: 'available',
        availabilityReason: null,
        waitTimeDays: null,
        waitTimeExpiresAt: null,
      };

      if (photoUrl) updateData.sentPhotoUrl = photoUrl;
      if (waybillParkId) updateData.waybillParkId = waybillParkId;
      if (waybillParkName) updateData.waybillParkName = waybillParkName;

      await orderRef.update(updateData);
      await dualWriteOrderToPostgres(orderId);

      const event = 'order_shipped';
      const summary = buildOrderSummary(order);

      createSystemMessage({
        orderId,
        event,
        dealThreadId: order.dealThreadId || order.chatThreadId || null,
        customText: 'Seller sent your item.',
        photoUrl: photoUrl || null,
      }).catch((e) => console.error('Failed to create system message:', e));

      if (photoUrl) {
        const firestore2 = admin.firestore();
        firestore2
          .collection('orders')
          .doc(orderId)
          .collection('messages')
          .add({
            orderId,
            senderId: auth.uid,
            senderRole: 'seller',
            type: 'proof',
            mediaUrl: photoUrl,
            proofCategory: 'dispatch',
            text: 'Dispatch proof attached',
            read: false,
            createdAt: now,
          }).catch((e) => console.error('Failed to create proof message:', e));
      }

      createOrderTimelineEvent({
        orderId,
        event,
        status: 'Sent',
        text: 'Order shipped',
        actorId: auth.uid,
        actorRole: 'seller',
        metadata: { photoUrl, waybillParkId, waybillParkName },
      }).catch((e) => console.error('Failed to create timeline event:', e));

      notifyBuyer({
        buyerId: order.customerId,
        event: 'order_shipped',
        orderId,
        orderSummary: summary,
        extra: waybillParkName || 'In transit',
      }).catch((e) => console.error('Failed to notify buyer:', e));

      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const markOrderAsReceived = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId } = request.body;
      if (!orderId) return sendError(response, 'Order ID is required', 400);

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);
      const order = orderDoc.data()!;

      if (order.customerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Only the buyer can confirm receipt', 403);
      }

      if (order.status !== 'Sent') {
        return sendError(response, `Cannot confirm receipt in ${order.status} status`, 400);
      }

      const release = await releaseEscrowAndAnnounce({
        orderId,
        source: auth.isAdmin ? 'admin' : 'buyer',
        actorId: auth.uid,
        actorRole: auth.isAdmin ? 'admin' : 'buyer',
        event: 'buyer_confirmed',
        text: 'Buyer confirmed receipt',
      });

      if (release.outcome !== 'released' && release.outcome !== 'already_released') {
        return sendError(response, `Cannot confirm receipt: ${release.outcome}`, 400);
      }

      return sendResponse(response, { success: true, escrow: release.outcome });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const getOrdersByCustomer = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();
      const snapshot = await firestore
        .collection('orders')
        .where('customerId', '==', auth.uid)
        .orderBy('createdAt', 'desc')
        .get();
      return sendResponse(response, {
        success: true,
        orders: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const getOrdersBySeller = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();
      const snapshot = await firestore
        .collection('orders')
        .where('sellerId', '==', auth.uid)
        .orderBy('createdAt', 'desc')
        .get();
      return sendResponse(response, {
        success: true,
        orders: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const calculateShippingOptions = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const { sellerId, state } = request.body;
      if (!sellerId || !state) return sendError(response, 'Seller ID and state are required');

      const firestore = admin.firestore();
      const zonesSnapshot = await firestore
        .collection('shipping_zones')
        .where('sellerId', '==', sellerId)
        .get();
      const zones = zonesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const matchingZone = zones.find(
        (zone: any) =>
          zone.states?.includes(state) ||
          zone.name?.toLowerCase().includes('default')
      );
      const baseRate = matchingZone ? (matchingZone as any).rate : 0;

      return sendResponse(response, {
        success: true,
        options: [
          { id: 'standard', name: 'Standard Shipping', price: baseRate, type: 'delivery' },
          { id: 'pickup', name: 'Store Pickup', price: 0, type: 'pickup' },
        ],
      });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const markOrderAsNotAvailable = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, waitTimeDays, reason } = request.body;
      if (!orderId) {
        return sendError(response, 'orderId is required', 400);
      }

      const orderRef = admin.firestore().collection('orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderSnap.data() || {};
      if (String(order.sellerId || '') !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Only the seller can update availability', 403);
      }

      const currentStatus = String(order.status || '');
      if (!['Paid', 'Processing', 'Accepted', 'Preparing'].includes(currentStatus)) {
        return sendError(response, `Cannot update availability from status ${currentStatus}`, 400);
      }

      const days = Number(waitTimeDays);
      const hasWait = Number.isFinite(days) && days > 0;
      let waitTimeExpiresAt: Date | null = null;
      if (hasWait) {
        waitTimeExpiresAt = new Date();
        waitTimeExpiresAt.setDate(waitTimeExpiresAt.getDate() + Math.min(14, Math.floor(days)));
      }

      await orderRef.update({
        status: 'AvailabilityCheck',
        availabilityStatus: hasWait ? 'waiting_buyer_response' : 'not_available',
        waitTimeDays: hasWait ? Math.floor(days) : null,
        waitTimeExpiresAt: waitTimeExpiresAt
          ? admin.firestore.Timestamp.fromDate(waitTimeExpiresAt)
          : null,
        availabilityReason: String(reason || '').trim() || null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const dealThreadId = order.dealThreadId || order.chatThreadId || null;
      const summary = buildOrderSummary(order);
      const customText = hasWait
        ? `Seller needs about ${Math.floor(days)} day(s) before sending it${reason ? `: ${reason}` : ''}. Reply in chat or respond on the order.`
        : `Seller can't supply this item${reason ? `: ${reason}` : ''}. You can cancel for a refund or chat to sort it out.`;

      await createSystemMessage({
        orderId,
        event: hasWait ? 'seller_needs_time' : 'item_unavailable',
        dealThreadId,
        customText,
      });

      await createOrderTimelineEvent({
        orderId,
        event: hasWait ? 'seller_needs_time' : 'item_unavailable',
        status: 'AvailabilityCheck',
        text: customText,
        actorId: auth.uid,
        actorRole: 'seller',
      });

      await notifyBuyer({
        buyerId: String(order.customerId || ''),
        event: 'availability_update',
        orderId,
        orderSummary: summary,
        extra: customText,
        chatRoomId: dealThreadId,
      });

      return sendResponse(response, { success: true, status: 'AvailabilityCheck' });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const respondToAvailabilityCheck = onRequest(
  // Firebase ID tokens are not Google IAM; Cloud Run must allow unauthenticated invoke.
  { secrets: [paystackSecret], invoker: 'public' },
  async (request, response) => {
    return corsHandler(request, response, async () => {
      try {
        const auth = await requireAuth(request.headers.authorization || null);
        const { orderId, response: buyerResponseRaw } = request.body;
        if (!orderId) {
          return sendError(response, 'orderId is required', 400);
        }

        const buyerResponse = String(buyerResponseRaw || '').toLowerCase();
        const accepted = buyerResponse === 'accepted' || buyerResponse === 'wait';
        const cancelled = buyerResponse === 'cancelled' || buyerResponse === 'cancel';
        if (!accepted && !cancelled) {
          return sendError(response, 'response must be accepted/wait or cancelled/cancel', 400);
        }

        const orderRef = admin.firestore().collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) {
          return sendError(response, 'Order not found', 404);
        }
        const order = orderSnap.data() || {};
        if (String(order.customerId || '') !== auth.uid && !auth.isAdmin) {
          return sendError(response, 'Only the buyer can respond', 403);
        }
        if (String(order.status || '') !== 'AvailabilityCheck') {
          return sendError(response, 'Order is not awaiting availability response', 400);
        }

        const dealThreadId = order.dealThreadId || order.chatThreadId || null;

        if (accepted) {
          await orderRef.update({
            buyerWaitResponse: 'accepted',
            availabilityStatus: 'waiting_restock',
            status: 'Processing',
            updatedAt: FieldValue.serverTimestamp(),
          });
          await dualWriteOrderToPostgres(orderId);
          await createSystemMessage({
            orderId,
            event: 'buyer_accepted_wait',
            dealThreadId,
            customText: 'Buyer agreed to wait. Send it when ready.',
          });
          await notifySeller({
            sellerId: String(order.sellerId || ''),
            event: 'new_message',
            orderId,
            orderSummary: buildOrderSummary(order),
            extra: 'Buyer agreed to wait — ship when ready.',
            chatRoomId: dealThreadId,
          });
          return sendResponse(response, { success: true, action: 'accepted' });
        }

        const refundResult = await processOrderRefund(
          {
            orderId,
            reason: 'Buyer cancelled after availability update',
            actorId: auth.uid,
            actorRole: 'buyer',
            cancelOrder: true,
          },
          { secretKey: paystackSecret.value() }
        );

        await orderRef.update({
          buyerWaitResponse: 'cancelled',
          availabilityStatus: 'cancelled',
          updatedAt: FieldValue.serverTimestamp(),
        });

        await dualWriteOrderToPostgres(orderId);

        await notifyBuyer({
          buyerId: String(order.customerId || ''),
          event: 'order_cancelled',
          orderId,
          orderSummary: buildOrderSummary(order),
          extra: 'Refund to your payment method is processing.',
          chatRoomId: dealThreadId,
        });
        await notifySeller({
          sellerId: String(order.sellerId || ''),
          event: 'refund_requested',
          orderId,
          orderSummary: buildOrderSummary(order),
          chatRoomId: dealThreadId,
        });
        return sendResponse(response, { success: true, action: 'cancelled', refund: refundResult });
      } catch (error: any) {
        const statusCode = error?.code === 'ESCROW_RELEASED' ? 400 : 500;
        return sendError(response, error.message || 'Internal server error', statusCode);
      }
    });
  }
);

/**
 * Reminds sellers every ~5 hours for paid orders that still need shipping.
 * Runs on a 5-hour schedule; each order is reminded at most once every 5 hours.
 */
export const remindUnshippedOrders = onSchedule(
  {
    schedule: 'every 5 hours',
    timeZone: 'Africa/Lagos',
  },
  async () => {
    const firestore = admin.firestore();
    const nowMs = Date.now();
    const minAgeMs = 5 * 60 * 60 * 1000;
    const reminderCooldownMs = 5 * 60 * 60 * 1000;
    const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - minAgeMs);

    const statuses = ['Processing', 'Accepted', 'Preparing', 'Paid'];
    let reminded = 0;

    for (const status of statuses) {
      const snap = await firestore
        .collection('orders')
        .where('status', '==', status)
        .where('createdAt', '<=', cutoff)
        .limit(200)
        .get();

      for (const doc of snap.docs) {
        const order = doc.data() || {};
        const lastReminder = order.lastShipmentReminderAt?.toMillis?.()
          ? Number(order.lastShipmentReminderAt.toMillis())
          : 0;
        if (lastReminder && nowMs - lastReminder < reminderCooldownMs) continue;

        const sellerId = String(order.sellerId || '').trim();
        if (!sellerId) continue;

        const dealThreadId = order.dealThreadId || order.chatThreadId || null;
        const summary = buildOrderSummary(order);
        const hoursWaiting = Math.max(
          5,
          Math.floor((nowMs - (order.createdAt?.toMillis?.() || nowMs - minAgeMs)) / (60 * 60 * 1000))
        );

        try {
          await notifySeller({
            sellerId,
            event: 'shipment_reminder',
            orderId: doc.id,
            orderSummary: summary,
            extra: `${summary} still hasn't been sent (~${hoursWaiting}h since purchase). Mark it as sent, tell the buyer you need time, or say you can't supply it.`,
            chatRoomId: dealThreadId,
          });

          await createSystemMessage({
            orderId: doc.id,
            event: 'shipment_reminder',
            dealThreadId,
            customText: `Reminder: this order hasn't been sent yet (${hoursWaiting}h). Seller — update the buyer in chat.`,
          });

          await doc.ref.update({
            lastShipmentReminderAt: FieldValue.serverTimestamp(),
            shipmentReminderCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          });
          reminded += 1;
        } catch (err) {
          console.warn('Shipment reminder failed for', doc.id, err);
        }
      }
    }

    console.log(`remindUnshippedOrders sent ${reminded} reminders`);
  }
);

/**
 * Automatic money movement runs behind explicit switches, because both directions
 * are irreversible.
 *
 * Release and refund are deliberately separate. They are not equally safe:
 *   - Release only ever pays a seller for an order they actually shipped, after the
 *     buyer's hold window has passed. Enabling it is the intended product behaviour.
 *   - Refund sends the buyer's money back and cancels a paid order. That is
 *     destructive and should be triggered deliberately, not silently in a batch.
 *
 * Values live in functions/.env and are deployed by the Firebase CLI.
 */
const escrowAutoRelease = defineBoolean('ESCROW_AUTO_RELEASE_ENABLED', {
  default: true,
  description: 'Release escrow automatically once the hold window after shipping has passed.',
});
const escrowAutoRefund = defineBoolean('ESCROW_AUTO_REFUND_ENABLED', {
  default: false,
  description: 'Refund and cancel paid orders the seller never accepted or shipped.',
});

const AUTO_MAX_PER_PASS = 25;

/**
 * Release escrow for orders whose auto-release clock has run out.
 *
 * `markOrderAsSent` has always stamped `autoReleaseDate` (48h). Nothing ever read
 * it, so an order whose buyer simply stopped opening the app held the seller's
 * money indefinitely. This is that missing timer.
 *
 * Queried on the single `autoReleaseDate` field so no composite index is required;
 * status and escrow state are checked in code.
 */
async function releaseDueEscrow(
  limit: number,
  dryRun: boolean
): Promise<{ released: number; skipped: number }> {
  const firestore = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  let released = 0;
  let skipped = 0;

  const snap = await firestore
    .collection('orders')
    .where('autoReleaseDate', '<=', nowTs)
    .limit(limit * 4)
    .get();

  for (const doc of snap.docs) {
    if (released + skipped >= limit) break;
    const order = doc.data() || {};
    const status = String(order.status || '');

    if (!['Sent', 'Received'].includes(status)) continue;
    if (!isEscrowHeld(order.escrowStatus)) continue;
    if (String(order.disputeStatus || '') === 'open') {
      skipped++;
      continue;
    }
    if (dryRun) {
      released++;
      continue;
    }

    try {
      const result = await releaseEscrowAndAnnounce({
        orderId: doc.id,
        source: 'auto',
        actorRole: 'system',
        event: 'escrow_auto_released',
        text: 'Buyer did not confirm receipt within the hold window. Escrow released to the seller.',
        note: 'auto-release window elapsed',
        notifyBuyerOnComplete: true,
      });
      if (result.outcome === 'released') released++;
      else skipped++;
    } catch (err) {
      skipped++;
      console.warn('releaseDueEscrow failed for', doc.id, err);
    }
  }

  return { released, skipped };
}

/**
 * Refund orders the seller ignored, and orders whose agreed wait window lapsed.
 *
 * Safety rail: an order is only auto-cancelled when there is NO evidence the goods
 * were dispatched. A seller who posts the parcel and forgets to tap "Accepted"
 * must not have a delivered order refunded out from under them — that loss would
 * land on the seller, not the platform.
 */
async function cancelIgnoredOrders(
  limit: number,
  dryRun: boolean
): Promise<{ cancelled: number; skipped: number }> {
  const firestore = admin.firestore();
  let cancelled = 0;
  let skipped = 0;

  const nowMs = Date.now();
  const acceptCutoff = admin.firestore.Timestamp.fromMillis(nowMs - 24 * 60 * 60 * 1000);

  const [paidSnap, processingSnap] = await Promise.all([
    firestore
      .collection('orders')
      .where('status', '==', 'Paid')
      .where('createdAt', '<=', acceptCutoff)
      .limit(limit * 2)
      .get(),
    firestore
      .collection('orders')
      .where('status', '==', 'Processing')
      .where('createdAt', '<=', acceptCutoff)
      .limit(limit * 2)
      .get(),
  ]);

  // Orders whose agreed wait window has passed without shipment.
  const waitSnap = await firestore
    .collection('orders')
    .where('waitTimeExpiresAt', '<=', admin.firestore.Timestamp.now())
    .limit(limit * 2)
    .get();

  const candidates = [...paidSnap.docs, ...processingSnap.docs, ...waitSnap.docs];
  const seen = new Set<string>();

  for (const doc of candidates) {
    if (cancelled + skipped >= limit) break;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);

    const order = doc.data() || {};
    // Never touch money that already moved.
    if (isEscrowSettled(order.escrowStatus)) continue;
    // Shipment evidence means this order is not "ignored" — leave it alone.
    if (order.sentAt || order.shippedAt) continue;
    if (String(order.disputeStatus || '') === 'open') continue;

    const status = String(order.status || '');
    const waiting = String(order.availabilityStatus || '') === 'waiting_restock';
    const expiredWait =
      waiting &&
      order.waitTimeExpiresAt?.toMillis?.() &&
      Number(order.waitTimeExpiresAt.toMillis()) <= nowMs;

    const ignored = ['Paid', 'Processing'].includes(status) && !order.sellerAcceptedAt;
    if (!ignored && !expiredWait) continue;

    const reason = expiredWait
      ? 'Auto-cancelled: seller did not ship within the agreed wait window'
      : 'Auto-cancelled: seller did not accept within 24 hours';

    if (dryRun) {
      cancelled++;
      continue;
    }

    try {
      await processOrderRefund(
        { orderId: doc.id, reason, actorId: 'system', actorRole: 'system', cancelOrder: true },
        { secretKey: paystackSecret.value() }
      );

      const summary = buildOrderSummary(order);
      notifyBuyer({
        buyerId: order.customerId,
        event: 'order_cancelled',
        orderId: doc.id,
        orderSummary: summary,
        extra: 'Refund to your payment method is processing.',
        chatRoomId: order.dealThreadId || order.chatThreadId || null,
      }).catch(() => {});

      notifySeller({
        sellerId: order.sellerId,
        event: 'refund_requested',
        orderId: doc.id,
        orderSummary: summary,
        chatRoomId: order.dealThreadId || order.chatThreadId || null,
      }).catch(() => {});

      await dualWriteOrderToPostgres(doc.id);
      cancelled++;
    } catch (err) {
      skipped++;
      console.warn('cancelIgnoredOrders refund failed for', doc.id, err);
    }
  }

  return { cancelled, skipped };
}

/**
 * Escrow upkeep. Runs every 15 minutes.
 *
 * Release and refund are gated independently:
 *   ESCROW_AUTO_RELEASE_ENABLED (default true)  — pays sellers for shipped orders.
 *   ESCROW_AUTO_REFUND_ENABLED  (default false) — refunds orders the seller ignored.
 */
export const escrowMaintenance = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Africa/Lagos' },
  async () => {
    const releaseLive = escrowAutoRelease.value();
    const refundLive = escrowAutoRefund.value();

    const released = await releaseDueEscrow(AUTO_MAX_PER_PASS, !releaseLive);
    const cancelled = await cancelIgnoredOrders(AUTO_MAX_PER_PASS, !refundLive);

    console.log(
      `escrowMaintenance: ` +
        `release=${releaseLive ? 'LIVE' : 'dry-run'}(${released.released} released, ${released.skipped} skipped) ` +
        `refund=${refundLive ? 'LIVE' : 'dry-run'}(${cancelled.cancelled} refunded, ${cancelled.skipped} skipped)`
    );
  }
);

/**
 * Admin-triggered refund sweep for orders the seller ignored.
 *
 * Previously callable by anyone: it was `invoker: 'public'` with no auth check, so
 * a stranger who found the URL could fire real Paystack refunds across every stale
 * order. It now requires an admin, and an explicit `dryRun` body flag for preview.
 */
export const autoAcceptExpiredOrders = onRequest(
  { secrets: [paystackSecret], invoker: 'public' },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      if (!auth.isAdmin) {
        return sendError(response, 'Admin only', 403);
      }

      const dryRun = request.body?.dryRun === true;
      const limit = Math.min(AUTO_MAX_PER_PASS, Number(request.body?.limit) || AUTO_MAX_PER_PASS);
      const result = await cancelIgnoredOrders(limit, dryRun);

      return sendResponse(response, {
        success: true,
        dryRun,
        cancelled: result.cancelled,
        skipped: result.skipped,
      });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});
