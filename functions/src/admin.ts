import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import crypto from 'crypto';
import {
    requireAdmin,
    sendError,
    sendResponse,
} from './utils';

const corsHandler = cors({ origin: true });

/**
 * Get all orders (admin only)
 */
export const getAllOrders = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAdmin(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('orders').orderBy('createdAt', 'desc').limit(50).get();
      return sendResponse(response, { success: true, orders: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Resolve dispute
 */
export const resolveDispute = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAdmin(request.headers.authorization || null);
      const { orderId, resolution, refundAmount } = request.body;
      await admin.firestore().collection('orders').doc(orderId).update({
        status: resolution === 'refund' ? 'Cancelled' : 'Processing',
        disputeResolution: resolution,
        refundAmount: refundAmount || 0,
        disputeResolvedAt: FieldValue.serverTimestamp(),
        disputeResolvedBy: auth.uid,
        escrowStatus: resolution === 'refund' ? 'refunded' : 'released',
      });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Logs & Security
 */
export const getAccessLogs = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAdmin(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('access_logs').orderBy('timestamp', 'desc').limit(100).get();
      return sendResponse(response, { success: true, logs: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    });
});

export const getApiKeys = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAdmin(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('api_keys').orderBy('createdAt', 'desc').get();
      return sendResponse(response, { success: true, keys: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    });
});

export const createApiKey = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      const auth = await requireAdmin(request.headers.authorization || null);
      const { name, scopes } = request.body;
      const apiKey = `ikm_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const ref = await admin.firestore().collection('api_keys').add({
        name, keyHash, keyPrefix: apiKey.substring(0, 8), scopes, isActive: true, 
        createdBy: auth.uid, createdAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true, id: ref.id, apiKey });
    });
});

/**
 * Parks Management
 */
export const getAllParks = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      const snapshot = await admin.firestore().collection('parks').where('isActive', '==', true).orderBy('state', 'asc').get();
      return sendResponse(response, { success: true, parks: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    });
});

export const getParksByState = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      const state = request.query.state || request.body?.state;
      const snapshot = await admin.firestore().collection('parks').where('state', '==', state).orderBy('city', 'asc').get();
      return sendResponse(response, { success: true, parks: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    });
});

export const createPark = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAdmin(request.headers.authorization || null);
      const { name, city, state } = request.body;
      const ref = await admin.firestore().collection('parks').add({
        name, city, state, isActive: true, createdAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true, parkId: ref.id });
    });
});

export const updatePark = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAdmin(request.headers.authorization || null);
      const { parkId, ...updateData } = request.body;
      await admin.firestore().collection('parks').doc(parkId).update({ ...updateData, updatedAt: FieldValue.serverTimestamp() });
      return sendResponse(response, { success: true });
    });
});

export const deletePark = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAdmin(request.headers.authorization || null);
      const { parkId } = request.body;
      await admin.firestore().collection('parks').doc(parkId).delete();
      return sendResponse(response, { success: true });
    });
});

export const initializeParks = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();
      const NORTHERN_PARKS = [
        { name: 'Kano Central Park', city: 'Kano', state: 'Kano', isActive: true },
        { name: 'Kaduna Main Park', city: 'Kaduna', state: 'Kaduna', isActive: true },
        { name: 'Jos Central Park', city: 'Jos', state: 'Plateau', isActive: true },
      ];
      const batch = firestore.batch();
      NORTHERN_PARKS.forEach(park => batch.set(firestore.collection('parks').doc(), { ...park, createdAt: FieldValue.serverTimestamp() }));
      await batch.commit();
      return sendResponse(response, { success: true, count: NORTHERN_PARKS.length });
    });
});
