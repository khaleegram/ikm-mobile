import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
    requireAdmin,
    requireAuth,
    sendError,
    sendResponse,
} from './utils';

const corsHandler = cors({ origin: true });

/**
 * Link guest orders to account
 */
export const linkGuestOrdersToAccount = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      const auth = await requireAuth(request.headers.authorization || null);
      const { email } = request.body;
      if (!email) return sendError(response, 'Email is required');

      const firestore = admin.firestore();
      const guestId = `guest_${email.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      
      const ordersSnapshot = await firestore.collection('orders').where('customerId', '==', guestId).get();
      if (ordersSnapshot.empty) return sendResponse(response, { success: true, count: 0 });

      const batch = firestore.batch();
      ordersSnapshot.docs.forEach(doc => batch.update(doc.ref, { customerId: auth.uid, isGuest: false, updatedAt: FieldValue.serverTimestamp() }));
      await batch.commit();

      return sendResponse(response, { success: true, count: ordersSnapshot.size });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get customers (seller view)
 */
export const getCustomers = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;
      
      const ordersSnapshot = await admin.firestore().collection('orders').where('sellerId', '==', sellerId).get();
      const customerMap = new Map();

      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        const cid = order.customerId;
        if (!cid) return;
        const existing = customerMap.get(cid) || { customerId: cid, name: order.customerInfo?.name || 'Unknown', email: order.customerInfo?.email || '', totalOrders: 0, totalSpent: 0 };
        existing.totalOrders += 1;
        existing.totalSpent += order.total || 0;
        customerMap.set(cid, existing);
      });

      return sendResponse(response, { success: true, customers: Array.from(customerMap.values()) });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get all users (admin only)
 */
export const getAllUsers = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAdmin(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('users').orderBy('createdAt', 'desc').limit(100).get();
      return sendResponse(response, { success: true, users: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Grant admin role
 */
export const grantAdminRole = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAdmin(request.headers.authorization || null);
      const { userId } = request.body;
      await admin.auth().setCustomUserClaims(userId, { isAdmin: true });
      await admin.firestore().collection('users').doc(userId).update({ isAdmin: true, role: 'admin' });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Revoke admin role
 */
export const revokeAdminRole = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAdmin(request.headers.authorization || null);
      const { userId } = request.body;
      if (userId === auth.uid) return sendError(response, 'Cannot revoke your own admin role');
      await admin.auth().setCustomUserClaims(userId, { isAdmin: false });
      await admin.firestore().collection('users').doc(userId).update({ isAdmin: false, role: 'buyer' });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});
