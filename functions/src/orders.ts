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
    getPlatformCommissionRate,
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

/**
 * Update order status
 */
export const updateOrderStatus = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, newStatus, waybillParkId, waybillParkName } = request.body;

      if (!orderId || !newStatus) {
        return sendError(response, 'Order ID and status are required');
      }

      const validStatuses = ['Processing', 'Sent', 'Received', 'Completed', 'Cancelled', 'Disputed'];
      if (!validStatuses.includes(newStatus)) {
        return sendError(response, `Invalid status: ${newStatus}`);
      }

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;
      const isSeller = order.sellerId === auth.uid;
      const isCustomer = order.customerId === auth.uid;

      // Verify authorization
      if (newStatus === 'Cancelled' && isCustomer && order.status === 'Processing') {
        // Customer can cancel Processing orders
      } else if (!isSeller && !auth.isAdmin) {
        return sendError(response, 'Forbidden: Only seller or admin can update order status', 403);
      }

      // State machine validation
      const ALLOWED_TRANSITIONS: Record<string, string[]> = {
        'Processing': ['Sent', 'Cancelled'],
        'Sent': ['Received', 'Cancelled', 'Disputed'],
        'Received': ['Completed'],
        'Completed': [],
        'Cancelled': [],
        'Disputed': ['Completed', 'Cancelled'],
      };

      const currentStatus = order.status;
      const allowedTransitions = ALLOWED_TRANSITIONS[currentStatus] || [];

      if (!allowedTransitions.includes(newStatus)) {
        return sendError(
          response,
          `Invalid transition: Cannot change from "${currentStatus}" to "${newStatus}"`
        );
      }

      // Build update object - include park fields if provided
      const updateData: any = {
        status: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Only include park fields if status is 'Sent' and fields are provided
      if (newStatus === 'Sent') {
        if (waybillParkId !== undefined) {
          updateData.waybillParkId = waybillParkId || null;
        }
        if (waybillParkName !== undefined) {
          updateData.waybillParkName = waybillParkName || null;
        }
      }

      await orderRef.update(updateData);

      return sendResponse(response, {
        success: true,
        orderId,
        newStatus,
      });
    } catch (error: any) {
      console.error('Error in updateOrderStatus:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Mark order as sent
 */
export const markOrderAsSent = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, photoUrl } = request.body;

      if (!orderId) {
        return sendError(response, 'Order ID is required');
      }

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;

      if (order.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Only the seller can mark order as sent', 403);
      }

      if (order.status !== 'Processing') {
        return sendError(response, `Cannot mark order as sent. Current status: ${order.status}`);
      }

      const autoReleaseDate = new Date();
      autoReleaseDate.setDate(autoReleaseDate.getDate() + 7); // 7 days

      await orderRef.update({
        status: 'Sent',
        sentAt: FieldValue.serverTimestamp(),
        sentPhotoUrl: photoUrl || null,
        escrowStatus: 'held',
        autoReleaseDate: FieldValue.serverTimestamp(),
      });

      await firestore.collection('orders').doc(orderId).collection('chat').add({
        orderId,
        senderId: 'system',
        senderType: 'system',
        message: photoUrl ? 'Seller has sent the item with a photo.' : 'Seller has sent the item.',
        imageUrl: photoUrl || null,
        isSystemMessage: true,
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, {
        success: true,
        autoReleaseDate: autoReleaseDate.toISOString(),
      });
    } catch (error: any) {
      console.error('Error in markOrderAsSent:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Mark order as received
 */
export const markOrderAsReceived = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, photoUrl } = request.body;

      if (!orderId) {
        return sendError(response, 'Order ID is required');
      }

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;

      if (order.customerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Only the customer can mark order as received', 403);
      }

      if (order.status !== 'Sent') {
        return sendError(response, `Cannot mark order as received. Current status: ${order.status}`);
      }

      if (order.dispute?.status === 'open') {
        return sendError(response, 'Cannot mark as received while dispute is open');
      }

      const orderTotal = order.total || 0;
      const commissionRate = await getPlatformCommissionRate();
      const commission = orderTotal * commissionRate;
      const sellerEarning = orderTotal - commission;

      await orderRef.update({
        status: 'Completed',
        receivedAt: FieldValue.serverTimestamp(),
        receivedPhotoUrl: photoUrl || null,
        escrowStatus: 'released',
        fundsReleasedAt: FieldValue.serverTimestamp(),
      });

      await firestore.collection('transactions').add({
        sellerId: order.sellerId,
        orderId: orderId,
        type: 'sale',
        amount: sellerEarning,
        commission: commission,
        description: `Sale from order #${orderId.slice(0, 7)}`,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
      });

      await firestore.collection('orders').doc(orderId).collection('chat').add({
        orderId,
        senderId: 'system',
        senderType: 'system',
        message: photoUrl
          ? 'Customer has received the item with a photo. Funds have been released to the seller.'
          : 'Customer has received the item. Funds have been released to the seller.',
        imageUrl: photoUrl || null,
        isSystemMessage: true,
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in markOrderAsReceived:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get orders by customer
 */
export const getOrdersByCustomer = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const status = request.query.status as string | undefined;
      const limit = parseInt(request.query.limit as string) || 50;
      const startAfter = request.query.startAfter as string | undefined;

      let query: admin.firestore.Query = firestore
        .collection('orders')
        .where('customerId', '==', auth.uid)
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (status) {
        query = query.where('status', '==', status);
      }

      if (startAfter) {
        const startAfterDoc = await firestore.collection('orders').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.get();
      const orders = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        orders,
      });
    } catch (error: any) {
      console.error('Error in getOrdersByCustomer:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get orders by seller
 */
export const getOrdersBySeller = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const status = request.query.status as string | undefined;
      const limit = parseInt(request.query.limit as string) || 50;
      const startAfter = request.query.startAfter as string | undefined;

      let query: admin.firestore.Query = firestore
        .collection('orders')
        .where('sellerId', '==', auth.uid)
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (status) {
        query = query.where('status', '==', status);
      }

      if (startAfter) {
        const startAfterDoc = await firestore.collection('orders').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.get();
      const orders = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        orders,
      });
    } catch (error: any) {
      console.error('Error in getOrdersBySeller:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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
// ============================================================================
// ADMIN FUNCTIONS - USER MANAGEMENT
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - PLATFORM SETTINGS
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - ORDERS & DISPUTES
// ============================================================================

/**
 * Get all orders (admin only)
 */
export const getAllOrders = onRequest(
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
      const status = request.query.status as string;

      let query: admin.firestore.Query = firestore
        .collection('orders')
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (status) {
        query = query.where('status', '==', status);
      }

      if (startAfter) {
        const startAfterDoc = await firestore.collection('orders').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.get();
      const orders = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        orders,
        hasMore: snapshot.docs.length === limit,
      });
    } catch (error: any) {
      console.error('Error in getAllOrders:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Resolve dispute
 */
export const resolveDispute = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const { orderId, resolution, refundAmount } = request.body;

      if (!orderId || !resolution) {
        return sendError(response, 'Order ID and resolution are required', 400);
      }

      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;
      if (order.status !== 'Disputed') {
        return sendError(response, 'Order is not in dispute', 400);
      }

      const update: any = {
        status: resolution === 'refund' ? 'Cancelled' : 'Processing',
        disputeResolution: resolution,
        disputeResolvedAt: FieldValue.serverTimestamp(),
        disputeResolvedBy: auth.uid,
      };

      if (resolution === 'refund' && refundAmount) {
        update.refundAmount = parseFloat(refundAmount);
        update.escrowStatus = 'refunded';
      } else if (resolution === 'release') {
        update.escrowStatus = 'released';
      }

      await orderRef.update(update);

      return sendResponse(response, {
        success: true,
        message: 'Dispute resolved successfully',
      });
    } catch (error: any) {
      console.error('Error in resolveDispute:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// SHIPPING ZONE FUNCTIONS
// ============================================================================
// ============================================================================
// ORDER AVAILABILITY FUNCTIONS
// ============================================================================

/**
 * Mark order as not available
 */
export const markOrderAsNotAvailable = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, waitTimeDays, reason } = request.body;

      if (!orderId || !reason) {
        return sendError(response, 'Order ID and reason are required', 400);
      }

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;

      if (order.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Only the seller can mark order as not available', 403);
      }

      if (order.status !== 'Processing') {
        return sendError(response, `Cannot mark order as not available. Current status: ${order.status}`);
      }

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

      const chatMessage = waitTimeDays
        ? `Item not currently available. Seller offers to wait ${waitTimeDays} day${waitTimeDays > 1 ? 's' : ''} for restocking. Reason: ${reason}`
        : `Item not currently available. Reason: ${reason}`;

      await firestore.collection('orders').doc(orderId).collection('chat').add({
        orderId,
        senderId: 'system',
        senderType: 'system',
        message: chatMessage,
        isSystemMessage: true,
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in markOrderAsNotAvailable:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Respond to availability check
 */
export const respondToAvailabilityCheck = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, response: buyerResponse } = request.body;

      if (!orderId || !buyerResponse) {
        return sendError(response, 'Order ID and response are required', 400);
      }

      if (!['accepted', 'cancelled'].includes(buyerResponse)) {
        return sendError(response, 'Response must be either "accepted" or "cancelled"', 400);
      }

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;

      if (order.customerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Only the customer can respond to availability check', 403);
      }

      if (order.status !== 'AvailabilityCheck') {
        return sendError(response, `Cannot respond to availability check. Current status: ${order.status}`);
      }

      if (buyerResponse === 'accepted') {
        await orderRef.update({
          buyerWaitResponse: 'accepted',
          availabilityStatus: 'waiting_restock',
          updatedAt: FieldValue.serverTimestamp(),
        });

        await firestore.collection('orders').doc(orderId).collection('chat').add({
          orderId,
          senderId: 'system',
          senderType: 'system',
          message: 'Buyer has accepted the wait time. Order will proceed once item is restocked.',
          isSystemMessage: true,
          createdAt: FieldValue.serverTimestamp(),
        });

        return sendResponse(response, { success: true, action: 'accepted' });
      } else {
        // Buyer cancels - process automatic refund
        const orderTotal = order.total || 0;
        const paymentReference = order.paymentReference;

        if (!paymentReference) {
          return sendError(response, 'Payment reference not found. Cannot process refund.', 400);
        }

        await orderRef.update({
          status: 'Cancelled',
          buyerWaitResponse: 'cancelled',
          availabilityStatus: 'cancelled',
          escrowStatus: 'refunded',
          refundedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Create refund record (actual Paystack refund would be processed separately)
        await firestore.collection('refunds').add({
          orderId,
          paymentReference,
          amount: orderTotal,
          reason: 'Item not available - buyer cancelled',
          refundMethod: 'original_payment',
          status: 'pending',
          processedBy: 'system',
          createdAt: FieldValue.serverTimestamp(),
        });

        await firestore.collection('transactions').add({
          orderId,
          customerId: order.customerId,
          type: 'refund',
          amount: orderTotal,
          description: `Refund for order #${orderId.slice(0, 7)} (item not available)`,
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
        });

        await firestore.collection('orders').doc(orderId).collection('chat').add({
          orderId,
          senderId: 'system',
          senderType: 'system',
          message: `Buyer has cancelled the order. Refund of ₦${orderTotal.toLocaleString()} will be processed within 24-48 hours.`,
          isSystemMessage: true,
          createdAt: FieldValue.serverTimestamp(),
        });

        return sendResponse(response, { success: true, action: 'cancelled', refundAmount: orderTotal });
      }
    } catch (error: any) {
      console.error('Error in respondToAvailabilityCheck:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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
