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
 * Get store settings
 */
export const getStoreSettings = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;
      
      const doc = await admin.firestore().collection('stores').doc(sellerId).get();
      if (!doc.exists) return sendError(response, 'Store not found', 404);
      return sendResponse(response, { success: true, store: { id: doc.id, ...doc.data() } });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Update store settings
 */
export const updateStoreSettings = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const { sellerId, updateData } = request.body;
      if (sellerId !== auth.uid && !auth.isAdmin) return sendError(response, 'Unauthorized', 403);
      
      await admin.firestore().collection('stores').doc(sellerId).set({
        ...updateData,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get platform settings
 */
export const getPlatformSettings = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAdmin(request.headers.authorization || null);
      const doc = await admin.firestore().collection('platform_settings').doc('platform_settings').get();
      return sendResponse(response, { success: true, settings: doc.data() || { platformCommissionRate: 0.05, minimumPayoutAmount: 5000 } });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Update platform settings
 */
export const updatePlatformSettings = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAdmin(request.headers.authorization || null);
      const { settings } = request.body;
      await admin.firestore().collection('platform_settings').doc('platform_settings').set({
        ...settings,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      }, { merge: true });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Shipping settings
 */
export const getShippingSettings = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId;
      const storeDoc = await admin.firestore().collection('stores').doc(sellerId).get();
      return sendResponse(response, { success: true, settings: storeDoc.data()?.shippingSettings || {} });
    });
});

export const updateShippingSettings = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAuth(request.headers.authorization || null);
      const { sellerId, defaultPackagingType, packagingCost } = request.body;
      await admin.firestore().collection('stores').doc(sellerId).update({
        shippingSettings: { defaultPackagingType, packagingCost: parseFloat(packagingCost) },
        updatedAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true });
    });
});

/**
 * Discount codes
 */
export const createDiscountCode = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAuth(request.headers.authorization || null);
      const { sellerId, code, discount, type, ...rest } = request.body;
      const ref = await admin.firestore().collection('discount_codes').add({
        sellerId, code: code.toUpperCase(), discount: parseFloat(discount), type, ...rest,
        status: 'active', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true, discountCodeId: ref.id });
    });
});

export const getDiscountCodes = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = auth.uid;
      const snapshot = await admin.firestore().collection('discount_codes').where('sellerId', '==', sellerId).get();
      return sendResponse(response, { success: true, discountCodes: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    });
});

export const updateDiscountCode = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAuth(request.headers.authorization || null);
      const { discountCodeId, ...updateData } = request.body;
      await admin.firestore().collection('discount_codes').doc(discountCodeId).update({ ...updateData, updatedAt: FieldValue.serverTimestamp() });
      return sendResponse(response, { success: true });
    });
});

export const deleteDiscountCode = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAuth(request.headers.authorization || null);
      const { discountCodeId } = request.body;
      await admin.firestore().collection('discount_codes').doc(discountCodeId).delete();
      return sendResponse(response, { success: true });
    });
});
