import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
    getPlatformCommissionRate,
    requireAuth,
    sendError,
    sendResponse,
} from './utils';

const corsHandler = cors({ origin: true });

/**
 * Get sales report
 */
export const getSalesReport = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;
      
      const ordersSnapshot = await admin.firestore().collection('orders')
        .where('sellerId', '==', sellerId)
        .where('status', '==', 'Completed')
        .get();

      let totalSales = 0;
      const dailyData = new Map();

      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        totalSales += order.total || 0;
        const date = order.createdAt?.toDate?.().toISOString().split('T')[0] || new Date().toISOString().split('T')[0];
        dailyData.set(date, (dailyData.get(date) || 0) + (order.total || 0));
      });

      return sendResponse(response, { 
        success: true, 
        report: { 
            totalSales, 
            daily: Array.from(dailyData.entries()).map(([date, amount]) => ({ date, amount })) 
        } 
      });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get customer report
 */
export const getCustomerReport = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = auth.uid;
      
      const ordersSnapshot = await admin.firestore().collection('orders').where('sellerId', '==', sellerId).get();
      const customerMap = new Map();

      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        const cid = order.customerId;
        if (!cid) return;
        const existing = customerMap.get(cid) || { id: cid, name: order.customerInfo?.name || 'Unknown', totalOrders: 0, totalSpent: 0 };
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
 * Get earnings analytics
 */
export const getEarningsAnalytics = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = auth.uid;
      const commissionRate = await getPlatformCommissionRate();
      
      const ordersSnapshot = await admin.firestore().collection('orders')
        .where('sellerId', '==', sellerId)
        .where('status', '==', 'Completed')
        .get();

      let totalEarnings = 0;
      let totalCommission = 0;

      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        const orderTotal = order.total || 0;
        const commission = orderTotal * (order.commissionRate || commissionRate);
        totalEarnings += (orderTotal - commission);
        totalCommission += commission;
      });

      return sendResponse(response, { success: true, totalEarnings, totalCommission });
    });
});
