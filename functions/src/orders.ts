import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
    requireAuth,
    sendError,
    sendResponse,
} from './utils';

const corsHandler = cors({ origin: true });

/**
 * Update order status
 */
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

      if (order.sellerId !== auth.uid && !auth.isAdmin) return sendError(response, 'Unauthorized', 403);

      await orderRef.update({ status, updatedAt: FieldValue.serverTimestamp() });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Mark order as sent
 */
export const markOrderAsSent = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAuth(request.headers.authorization || null);
      const { orderId, shippingProvider, trackingNumber } = request.body;
      await admin.firestore().collection('orders').doc(orderId).update({
        status: 'Sent',
        shippingProvider: shippingProvider || null,
        trackingNumber: trackingNumber || null,
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Mark order as received
 */
export const markOrderAsReceived = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAuth(request.headers.authorization || null);
      const { orderId } = request.body;
      await admin.firestore().collection('orders').doc(orderId).update({
        status: 'Completed',
        escrowStatus: 'completed',
        receivedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get orders by customer
 */
export const getOrdersByCustomer = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('orders').where('customerId', '==', auth.uid).orderBy('createdAt', 'desc').get();
      return sendResponse(response, { success: true, orders: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get orders by seller
 */
export const getOrdersBySeller = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('orders').where('sellerId', '==', auth.uid).orderBy('createdAt', 'desc').get();
      return sendResponse(response, { success: true, orders: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Calculate shipping options
 */
export const calculateShippingOptions = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const { sellerId, state } = request.body;
      if (!sellerId || !state) return sendError(response, 'Seller ID and state are required');

      const firestore = admin.firestore();
      const zonesSnapshot = await firestore.collection('shipping_zones').where('sellerId', '==', sellerId).get();
      const zones = zonesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const matchingZone = zones.find((zone: any) => zone.states?.includes(state) || zone.name?.toLowerCase().includes('default'));
      const baseRate = matchingZone ? (matchingZone as any).rate : 0;
      
      return sendResponse(response, {
        success: true,
        options: [
          { id: 'standard', name: 'Standard Shipping', price: baseRate, type: 'delivery' },
          { id: 'pickup', name: 'Store Pickup', price: 0, type: 'pickup' },
        ],
      });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Mark order as not available
 */
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
        waitTimeExpiresAt: waitTimeExpiresAt ? admin.firestore.Timestamp.fromDate(waitTimeExpiresAt) : null,
        availabilityReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Respond to availability check
 */
export const respondToAvailabilityCheck = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAuth(request.headers.authorization || null);
      const { orderId, response: buyerResponse } = request.body;
      const orderRef = admin.firestore().collection('orders').doc(orderId);
      
      if (buyerResponse === 'accepted') {
        await orderRef.update({ buyerWaitResponse: 'accepted', availabilityStatus: 'waiting_restock', updatedAt: FieldValue.serverTimestamp() });
        return sendResponse(response, { success: true, action: 'accepted' });
      } else {
        await orderRef.update({ status: 'Cancelled', buyerWaitResponse: 'cancelled', availabilityStatus: 'cancelled', escrowStatus: 'refunded', updatedAt: FieldValue.serverTimestamp() });
        return sendResponse(response, { success: true, action: 'cancelled' });
      }
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});
