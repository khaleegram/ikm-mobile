/**
 * Cloud Functions for IKM Marketplace
 * 
 * This file contains all HTTP callable functions that can be used
 * from both the web app and mobile app.
 * 
 * Authentication: Functions use Firebase ID token from Authorization header
 * Format: Authorization: Bearer <firebase-id-token>
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');

// Initialize Firebase Admin
admin.initializeApp();

// CORS configuration - allow all origins for mobile/web apps
const corsHandler = cors({ origin: true });

// Define Firebase Secret for Paystack
const paystackSecret = defineSecret('PAYSTACK_SECRET_KEY');

// Import utilities
import {
    requireAdmin,
    requireAuth,
    sendError,
    sendResponse,
} from './utils';

// ============================================================================
// PAYMENT FUNCTIONS
// ============================================================================




function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}







// ============================================================================
// ORDER FUNCTIONS
// ============================================================================
// ============================================================================
// SHIPPING FUNCTIONS (PUBLIC - NO AUTH REQUIRED)
// ============================================================================
// ============================================================================
// PAYOUT FUNCTIONS
// ============================================================================
// ============================================================================
// CHAT FUNCTIONS
// ============================================================================
// ============================================================================
// USER FUNCTIONS
// ============================================================================

/**
 * Link guest orders to account
 */
export const linkGuestOrdersToAccount = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      // Get user email
      const userDoc = await firestore.collection('users').doc(auth.uid).get();
      const userData = userDoc.data();
      const userEmail = auth.email || userData?.email;

      if (!userEmail) {
        return sendError(response, 'User email is required to link guest orders');
      }

      // Find guest orders by email
      const allOrdersQuery = await firestore
        .collection('orders')
        .where('customerInfo.email', '==', userEmail.toLowerCase())
        .get();

      const batch = firestore.batch();
      let linkedCount = 0;

      allOrdersQuery.forEach((doc) => {
        const order = doc.data();
        if (order.customerId && order.customerId.startsWith('guest_')) {
          batch.update(doc.ref, {
            customerId: auth.uid,
            linkedFromGuest: true,
            linkedAt: FieldValue.serverTimestamp(),
          });
          linkedCount++;
        }
      });

      if (linkedCount > 0) {
        await batch.commit();
      }

      return sendResponse(response, {
        success: true,
        linkedCount,
      });
    } catch (error: any) {
      console.error('Error in linkGuestOrdersToAccount:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// SEARCH FUNCTIONS (PUBLIC)
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - PRODUCT MANAGEMENT
// ============================================================================
// ============================================================================
// NORTHERN PRODUCT FUNCTIONS (Category-Specific Products)
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - DASHBOARD & ANALYTICS
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - REPORTS
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - MARKETING (DISCOUNT CODES)
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - STORE MANAGEMENT
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - CUSTOMERS
// ============================================================================

/**
 * Get customers
 */
export const getCustomers = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const ordersSnapshot = await firestore
        .collection('orders')
        .where('sellerId', '==', sellerId)
        .get();

      const orders = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const customerMap = new Map<string, {
        customerId: string;
        name: string;
        email: string;
        phone: string;
        totalOrders: number;
        totalSpent: number;
        firstOrderDate: Date;
        lastOrderDate: Date;
      }>();

      orders.forEach((order: any) => {
        const customerId = order.customerId;
        if (!customerId) return;

        const existing = customerMap.get(customerId);
        const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt || Date.now());

        if (existing) {
          existing.totalOrders += 1;
          existing.totalSpent += order.total || 0;
          if (orderDate > existing.lastOrderDate) {
            existing.lastOrderDate = orderDate;
          }
          if (orderDate < existing.firstOrderDate) {
            existing.firstOrderDate = orderDate;
          }
        } else {
          customerMap.set(customerId, {
            customerId,
            name: order.customerInfo?.name || 'Unknown',
            email: order.customerInfo?.email || '',
            phone: order.customerInfo?.phone || '',
            totalOrders: 1,
            totalSpent: order.total || 0,
            firstOrderDate: orderDate,
            lastOrderDate: orderDate,
          });
        }
      });

      const customers = Array.from(customerMap.values())
        .sort((a, b) => b.totalSpent - a.totalSpent);

      // Segment customers
      const now = new Date();
      const vipCustomers = customers.filter(c => c.totalSpent >= 50000);
      const regularCustomers = customers.filter(c => c.totalSpent >= 10000 && c.totalSpent < 50000);
      const newCustomers = customers.filter(c => {
        const daysSinceFirst = (now.getTime() - c.firstOrderDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceFirst <= 30;
      });

      return sendResponse(response, {
        success: true,
        customers: customers.map(c => ({
          ...c,
          firstOrderDate: c.firstOrderDate.toISOString(),
          lastOrderDate: c.lastOrderDate.toISOString(),
        })),
        segments: {
          vip: vipCustomers.length,
          regular: regularCustomers.length,
          new: newCustomers.length,
        },
      });
    } catch (error: any) {
      console.error('Error in getCustomers:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// ADMIN FUNCTIONS - USER MANAGEMENT
// ============================================================================

/**
 * Get all users (admin only)
 */
export const getAllUsers = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const limit = parseInt(request.query.limit as string) || 50;
      const startAfter = request.query.startAfter as string;
      const role = request.query.role as string;

      let query: admin.firestore.Query = firestore
        .collection('users')
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (role) {
        query = query.where('role', '==', role);
      }

      if (startAfter) {
        const startAfterDoc = await firestore.collection('users').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.get();
      const users = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        users,
        hasMore: snapshot.docs.length === limit,
      });
    } catch (error: any) {
      console.error('Error in getAllUsers:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Grant admin role
 */
export const grantAdminRole = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const userId = request.body?.userId;
      if (!userId) {
        return sendError(response, 'User ID is required', 400);
      }

      // Set custom claims
      await admin.auth().setCustomUserClaims(userId, { isAdmin: true });
      await admin.auth().revokeRefreshTokens(userId);

      // Update Firestore
      await firestore.collection('users').doc(userId).update({
        isAdmin: true,
        role: 'admin',
      });

      return sendResponse(response, {
        success: true,
        message: 'Admin role granted successfully',
      });
    } catch (error: any) {
      console.error('Error in grantAdminRole:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Revoke admin role
 */
export const revokeAdminRole = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const userId = request.body?.userId;
      if (!userId) {
        return sendError(response, 'User ID is required', 400);
      }

      if (userId === auth.uid) {
        return sendError(response, 'Cannot revoke your own admin role', 400);
      }

      // Set custom claims
      await admin.auth().setCustomUserClaims(userId, { isAdmin: false });
      await admin.auth().revokeRefreshTokens(userId);

      // Update Firestore - determine new role
      const userDoc = await firestore.collection('users').doc(userId).get();
      const userData = userDoc.data();
      const newRole = userData?.storeName ? 'seller' : 'buyer';

      await firestore.collection('users').doc(userId).update({
        isAdmin: false,
        role: newRole,
      });

      return sendResponse(response, {
        success: true,
        message: 'Admin role revoked successfully',
      });
    } catch (error: any) {
      console.error('Error in revokeAdminRole:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// ADMIN FUNCTIONS - PLATFORM SETTINGS
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - ORDERS & DISPUTES
// ============================================================================
// ============================================================================
// SHIPPING ZONE FUNCTIONS
// ============================================================================
// ============================================================================
// ORDER AVAILABILITY FUNCTIONS
// ============================================================================
// ============================================================================
// PARKS MANAGEMENT FUNCTIONS (ADMIN)
// ============================================================================
// ============================================================================
// EARNINGS FUNCTIONS
// ============================================================================
// ============================================================================
// PAYOUT REQUEST FUNCTIONS
// ============================================================================
// ============================================================================
// SECURITY & ADMIN FUNCTIONS
// ============================================================================
// ============================================================================
// MARKET STREET FUNCTIONS
// ============================================================================


function parseBase64Image(imageDataUrl: string): {
  buffer: Buffer;
  extension: string;
  contentType: string;
} {
  const match = imageDataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new Error('Invalid image format. Expected base64 data URL.');
  }

  const mimeSubtype = match[1].toLowerCase();
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer.length) {
    throw new Error('Invalid image payload.');
  }

  const extensionBase = mimeSubtype.split('+')[0] || 'jpeg';
  const extension = extensionBase === 'jpeg' ? 'jpg' : extensionBase;

  return {
    buffer,
    extension,
    contentType: `image/${mimeSubtype}`,
  };
}




// ============================================================================
// KEEP HELLO WORLD FOR TESTING
// ============================================================================
// Force redeploy to pick up config changes
