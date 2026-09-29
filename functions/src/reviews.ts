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

export const submitReview = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, rating, text } = request.body;

      if (!orderId) return sendError(response, 'Order ID is required', 400);
      if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        return sendError(response, 'Rating must be between 1 and 5', 400);
      }

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);

      const order = orderDoc.data()!;

      if (order.customerId !== auth.uid) {
        return sendError(response, 'Only the buyer can leave a review', 403);
      }

      if (order.status !== 'Completed' && order.status !== 'Received') {
        return sendError(response, 'Leave a review after you confirm delivery', 400);
      }

      const existingReviewSnap = await firestore
        .collection('reviews')
        .where('orderId', '==', orderId)
        .where('reviewerId', '==', auth.uid)
        .limit(1)
        .get();

      if (!existingReviewSnap.empty) {
        return sendError(response, 'You have already reviewed this order', 400);
      }

      const reviewRef = firestore.collection('reviews').doc();
      await reviewRef.set({
        orderId,
        reviewerId: auth.uid,
        sellerId: order.sellerId,
        rating,
        text: String(text || '').trim().slice(0, 500) || null,
        createdAt: FieldValue.serverTimestamp(),
      });

      const allReviewsSnap = await firestore
        .collection('reviews')
        .where('sellerId', '==', order.sellerId)
        .get();

      let totalRating = rating;
      let count = 1;
      allReviewsSnap.docs.forEach((doc) => {
        if (doc.id !== reviewRef.id && doc.data().rating) {
          totalRating += Number(doc.data().rating);
          count++;
        }
      });

      const averageRating = Math.round((totalRating / count) * 10) / 10;

      await firestore.collection('users').doc(order.sellerId).update({
        sellerRating: averageRating,
        sellerReviewCount: count,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, {
        success: true,
        reviewId: reviewRef.id,
        averageRating,
        reviewCount: count,
      });
    } catch (error: any) {
      console.error('Error submitting review:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const getSellerReviews = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAuth(request.headers.authorization || null);
      const { sellerId, limit: reqLimit, startAfter } = request.body;

      if (!sellerId) return sendError(response, 'Seller ID is required', 400);

      const pageLimit = Math.min(Math.max(Number(reqLimit) || 10, 1), 50);
      const firestore = admin.firestore();

      let query = firestore
        .collection('reviews')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .limit(pageLimit);

      if (startAfter) {
        const startDoc = await firestore.collection('reviews').doc(startAfter).get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      const snapshot = await query.get();
      const reviews = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, { reviews, hasMore: snapshot.docs.length === pageLimit });
    } catch (error: any) {
      console.error('Error fetching reviews:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const getReviewForOrder = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId } = request.body;

      if (!orderId) return sendError(response, 'Order ID is required', 400);

      const firestore = admin.firestore();
      const snapshot = await firestore
        .collection('reviews')
        .where('orderId', '==', orderId)
        .where('reviewerId', '==', auth.uid)
        .limit(1)
        .get();

      const review = snapshot.empty
        ? null
        : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };

      return sendResponse(response, { review });
    } catch (error: any) {
      console.error('Error fetching review for order:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});
