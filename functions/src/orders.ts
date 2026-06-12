import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
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
} from './order-chat';

const corsHandler = cors({ origin: true });

const VALID_TRANSITIONS: Record<string, string[]> = {
  Paid: ['Accepted', 'Cancelled'],
  Accepted: ['Preparing', 'Cancelled'],
  Preparing: ['Sent', 'Cancelled'],
  Sent: ['Received', 'Disputed'],
  Received: ['Completed', 'Disputed'],
  Completed: [],
  Cancelled: [],
  Disputed: ['Cancelled', 'Completed'],
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

export const updateOrderStatus = onRequest(async (request, response) => {
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
        case 'Completed':
          updateData.status = 'Completed';
          updateData.escrowStatus = 'released';
          updateData.fundsReleasedAt = now;
          break;
        case 'Cancelled':
          updateData.status = 'Cancelled';
          if (order.escrowStatus !== 'released') {
            updateData.escrowStatus = 'refunded';
          }
          break;
        case 'Disputed':
          updateData.status = 'Disputed';
          updateData.escrowStatus = 'held';
          break;
        default:
          updateData.status = status;
      }

      updateData.updatedAt = now;

      await orderRef.update(updateData);

      const eventMap: Record<string, string> = {
        Accepted: 'seller_accepted',
        Preparing: 'seller_preparing',
        Sent: 'order_shipped',
        Received: 'order_delivered',
        Completed: 'buyer_confirmed',
        Cancelled: 'order_cancelled',
        Disputed: 'dispute_opened',
      };

      const event = eventMap[status];
      if (event) {
        createSystemMessage({ orderId, event }).catch((e) =>
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

      if (status === 'Cancelled') {
        notifyBuyer({
          buyerId: order.customerId,
          event: 'order_cancelled',
          orderId,
          orderSummary: summary,
        }).catch((e) => console.error('Failed to notify buyer:', e));

        notifySeller({
          sellerId: order.sellerId,
          event: 'refund_requested',
          orderId,
          orderSummary: summary,
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
      return sendError(response, error.message || 'Internal server error', 500);
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

      const event = 'seller_accepted';
      const summary = buildOrderSummary(order);

      createSystemMessage({ orderId, event }).catch((e) =>
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

      const allowedStatuses = ['Accepted', 'Preparing', 'Processing'];
      if (!allowedStatuses.includes(order.status)) {
        return sendError(response, `Cannot ship order in ${order.status} status`, 400);
      }

      const now = FieldValue.serverTimestamp();
      const autoReleaseDate = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const updateData: Record<string, any> = {
        status: 'Sent',
        sentAt: now,
        autoReleaseDate: admin.firestore.Timestamp.fromDate(autoReleaseDate),
        updatedAt: now,
      };

      if (waybillParkId) updateData.waybillParkId = waybillParkId;
      if (waybillParkName) updateData.waybillParkName = waybillParkName;

      await orderRef.update(updateData);

      const event = 'order_shipped';
      const summary = buildOrderSummary(order);

      createSystemMessage({
        orderId,
        event,
        customText: 'Seller marked order as shipped.',
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

      const now = FieldValue.serverTimestamp();

      await orderRef.update({
        status: 'Completed',
        escrowStatus: 'released',
        fundsReleasedAt: now,
        receivedAt: now,
        updatedAt: now,
      });

      const event = 'buyer_confirmed';
      const summary = buildOrderSummary(order);

      createSystemMessage({ orderId, event }).catch((e) =>
        console.error('Failed to create system message:', e)
      );

      createOrderTimelineEvent({
        orderId,
        event,
        status: 'Completed',
        text: 'Buyer confirmed receipt',
        actorId: auth.uid,
        actorRole: 'buyer',
      }).catch((e) => console.error('Failed to create timeline event:', e));

      notifySeller({
        sellerId: order.sellerId,
        event: 'escrow_released',
        orderId,
        orderSummary: summary,
      }).catch((e) => console.error('Failed to notify seller:', e));

      return sendResponse(response, { success: true });
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
      await requireAuth(request.headers.authorization || null);
      const { orderId, waitTimeDays, reason } = request.body;
      const orderRef = admin.firestore().collection('orders').doc(orderId);

      let waitTimeExpiresAt = null;
      if (waitTimeDays) {
        const expiresDate = new Date();
        expiresDate.setDate(expiresDate.getDate() + waitTimeDays);
        waitTimeExpiresAt = expiresDate;
      }

      await orderRef.update({
        status: 'AvailabilityCheck',
        availabilityStatus: waitTimeDays ? 'waiting_buyer_response' : 'not_available',
        waitTimeDays: waitTimeDays || null,
        waitTimeExpiresAt: waitTimeExpiresAt
          ? admin.firestore.Timestamp.fromDate(waitTimeExpiresAt)
          : null,
        availabilityReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const respondToAvailabilityCheck = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAuth(request.headers.authorization || null);
      const { orderId, response: buyerResponse } = request.body;
      const orderRef = admin.firestore().collection('orders').doc(orderId);

      if (buyerResponse === 'accepted') {
        await orderRef.update({
          buyerWaitResponse: 'accepted',
          availabilityStatus: 'waiting_restock',
          updatedAt: FieldValue.serverTimestamp(),
        });
        return sendResponse(response, { success: true, action: 'accepted' });
      } else {
        await orderRef.update({
          status: 'Cancelled',
          buyerWaitResponse: 'cancelled',
          availabilityStatus: 'cancelled',
          escrowStatus: 'refunded',
          updatedAt: FieldValue.serverTimestamp(),
        });
        return sendResponse(response, { success: true, action: 'cancelled' });
      }
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const autoAcceptExpiredOrders = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const firestore = admin.firestore();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const staleSnap = await firestore
        .collection('orders')
        .where('status', '==', 'Paid')
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(cutoff))
        .get();

      let cancelled = 0;
      const batch = firestore.batch();

      for (const doc of staleSnap.docs) {
        const order = doc.data();
        batch.update(doc.ref, {
          status: 'Cancelled',
          escrowStatus: 'refunded',
          updatedAt: FieldValue.serverTimestamp(),
        });

        const summary = buildOrderSummary(order);
        notifyBuyer({
          buyerId: order.customerId,
          event: 'order_cancelled',
          orderId: doc.id,
          orderSummary: summary,
        }).catch(() => {});

        createSystemMessage({
          orderId: doc.id,
          event: 'order_cancelled',
          customText: 'Order auto-cancelled: Seller did not accept within 24 hours.',
        }).catch(() => {});

        cancelled++;
      }

      if (cancelled > 0) {
        await batch.commit();
      }

      return sendResponse(response, { success: true, cancelled });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});
