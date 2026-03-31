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
 * Search products
 */
export const searchProducts = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const query = request.query.q as string || request.body?.q || '';
      const limit = parseInt(request.query.limit as string) || request.body?.limit || 20;
      const firestore = admin.firestore();

      let productsQuery = firestore.collection('products').where('status', '==', 'active');
      const snapshot = await productsQuery.get();
      let products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (query) {
        const searchTerm = query.toLowerCase();
        products = products.filter((p: any) => 
          p.name?.toLowerCase().includes(searchTerm) || 
          p.description?.toLowerCase().includes(searchTerm) ||
          p.category?.toLowerCase().includes(searchTerm)
        );
      }

      return sendResponse(response, { success: true, products: products.slice(0, limit) });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get seller products
 */
export const getSellerProducts = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;
      
      const snapshot = await admin.firestore().collection('products').where('sellerId', '==', sellerId).get();
      return sendResponse(response, { success: true, products: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get product
 */
export const getProduct = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const productId = request.query.id as string || request.body?.id;
      const doc = await admin.firestore().collection('products').doc(productId).get();
      if (!doc.exists) return sendError(response, 'Product not found', 404);
      return sendResponse(response, { success: true, product: { id: doc.id, ...doc.data() } });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Create product
 */
export const createProduct = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const productData = request.body;
      const ref = await admin.firestore().collection('products').add({
        ...productData,
        sellerId: auth.uid,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true, productId: ref.id });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Update product
 */
export const updateProduct = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAuth(request.headers.authorization || null);
      const { id, ...updateData } = request.body;
      await admin.firestore().collection('products').doc(id).update({
        ...updateData,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Delete product
 */
export const deleteProduct = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAuth(request.headers.authorization || null);
      const { id } = request.body;
      await admin.firestore().collection('products').doc(id).delete();
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Shipping Zones
 */
export const getPublicShippingZones = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    const sellerId = request.query.sellerId as string || request.body?.sellerId;
    const snapshot = await admin.firestore().collection('shipping_zones').where('sellerId', '==', sellerId).get();
    return sendResponse(response, { success: true, zones: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  });
});

export const createShippingZone = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    await requireAuth(request.headers.authorization || null);
    const { sellerId, name, rate, states, freeThreshold } = request.body;
    const ref = await admin.firestore().collection('shipping_zones').add({
      sellerId, name, rate: parseFloat(rate), states: states || [], 
      freeThreshold: freeThreshold ? parseFloat(freeThreshold) : undefined,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return sendResponse(response, { success: true, zoneId: ref.id });
  });
});

export const updateShippingZone = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAuth(request.headers.authorization || null);
      const { zoneId, ...updateData } = request.body;
      if (updateData.rate !== undefined) updateData.rate = parseFloat(updateData.rate);
      if (updateData.freeThreshold !== undefined) updateData.freeThreshold = parseFloat(updateData.freeThreshold);
      await admin.firestore().collection('shipping_zones').doc(zoneId).update({ ...updateData, updatedAt: FieldValue.serverTimestamp() });
      return sendResponse(response, { success: true });
    });
});

export const deleteShippingZone = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      await requireAuth(request.headers.authorization || null);
      const { zoneId } = request.body;
      await admin.firestore().collection('shipping_zones').doc(zoneId).delete();
      return sendResponse(response, { success: true });
    });
});
