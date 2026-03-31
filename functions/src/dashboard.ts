import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
    requireAuth,
    sendError,
    sendResponse,
} from './utils';

const corsHandler = cors({ origin: true });

/**
 * Get dashboard statistics for seller
 */
export const getDashboardStats = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;
      
      const firestore = admin.firestore();
      
      const ordersSnapshot = await firestore.collection('orders').where('sellerId', '==', sellerId).get();
      const productsSnapshot = await firestore.collection('products').where('sellerId', '==', sellerId).get();

      let totalSales = 0;
      let completedOrders = 0;
      let pendingOrders = 0;
      let totalProducts = productsSnapshot.size;

      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        if (order.status === 'Completed') {
            totalSales += order.total || 0;
            completedOrders++;
        } else if (order.status === 'Processing' || order.status === 'Sent') {
            pendingOrders++;
        }
      });

      return sendResponse(response, { 
        success: true, 
        stats: { 
            totalSales, 
            completedOrders, 
            pendingOrders, 
            totalProducts 
        } 
      });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get buyer dashboard statistics
 */
export const getBuyerDashboardStats = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      const auth = await requireAuth(request.headers.authorization || null);
      const ordersSnapshot = await admin.firestore().collection('orders').where('customerId', '==', auth.uid).get();
      let totalSpent = 0;
      ordersSnapshot.forEach(doc => totalSpent += doc.data().total || 0);
      return sendResponse(response, { success: true, stats: { totalOrders: ordersSnapshot.size, totalSpent } });
    });
});
