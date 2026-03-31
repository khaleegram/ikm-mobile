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

/**
 * Calculate shipping options (public)
 */
export const calculateShippingOptions = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const { sellerId, state, cartItems } = request.body;

      if (!sellerId || !state) {
        return sendError(response, 'Seller ID and state are required');
      }

      const firestore = admin.firestore();

      // Get seller's shipping zones
      const zonesQuery = await firestore
        .collection('shipping_zones')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .get();

      interface Zone {
        id: string;
        name: string;
        rate: number;
        freeThreshold?: number;
        states?: string[];
      }

      const zones: Zone[] = zonesQuery.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Zone[];

      // Check if products allow shipping
      let allProductsAllowShipping = true;
      if (cartItems && cartItems.length > 0) {
        const productIds = cartItems.map((item: any) => item.id || item.productId);
        const productDocs = await Promise.all(
          productIds.map((id: string) => firestore.collection('products').doc(id).get())
        );
        allProductsAllowShipping = productDocs.every((doc) => {
          const data = doc.data();
          return data?.allowShipping !== false;
        });
      }

      // Get store info
      const storeDoc = await firestore.collection('stores').doc(sellerId).get();
      const storeData = storeDoc.data();
      const sellerPhone = storeData?.phone || '';
      const sellerPickupAddress = storeData?.pickupAddress || storeData?.storeLocation?.address || '';

      // Find matching zone
      const matchingZone = zones.find((zone) => {
        if (zone.states && zone.states.length > 0) {
          return zone.states.some((s: string) => s.toLowerCase() === state.toLowerCase());
        }
        return (
          zone.name.toLowerCase().includes(state.toLowerCase()) ||
          state.toLowerCase().includes(zone.name.toLowerCase())
        );
      });

      const options: any[] = [];

      if (allProductsAllowShipping && matchingZone) {
        options.push({
          type: 'delivery',
          price: matchingZone.rate,
          name: `Delivery to ${state}`,
          description: matchingZone.freeThreshold
            ? `Standard delivery. Free shipping for orders over ₦${matchingZone.freeThreshold.toLocaleString()}`
            : `Standard delivery to ${state}`,
          estimatedDays: 3,
        });
      }

      if (sellerPickupAddress) {
        options.push({
          type: 'pickup',
          price: 0,
          name: 'Pickup from Store',
          description: 'Pick up your order from our store location',
          pickupAddress: sellerPickupAddress,
        });
      }

      let message: string | undefined;
      if (!allProductsAllowShipping) {
        message = 'Some products in your cart do not allow shipping. Please choose pickup.';
      } else if (!matchingZone) {
        message = `We don't currently ship to ${state}. Please choose pickup or contact us.`;
      }

      return sendResponse(response, {
        success: true,
        options,
        message,
        sellerPhone,
        sellerPickupAddress,
      });
    } catch (error: any) {
      console.error('Error in calculateShippingOptions:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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

/**
 * Get dashboard stats
 */
export const getDashboardStats = onRequest(
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

      // Get products count
      const productsSnapshot = await firestore
        .collection('products')
        .where('sellerId', '==', sellerId)
        .get();
      const totalProducts = productsSnapshot.size;

      // Get orders
      const ordersSnapshot = await firestore
        .collection('orders')
        .where('sellerId', '==', sellerId)
        .get();

      const orders = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const totalOrders = orders.length;
      const totalRevenue = orders.reduce((sum, order: any) => sum + (order.total || 0), 0);
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Get unique customers
      const customerIds = new Set(orders.map((order: any) => order.customerId).filter(Boolean));
      const totalCustomers = customerIds.size;

      // Recent orders (last 5)
      const recentOrders = orders
        .sort((a: any, b: any) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        })
        .slice(0, 5);

      // Low stock products
      const lowStockProducts = productsSnapshot.docs
        .map(doc => doc.data())
        .filter((p: any) => p.stock <= 5 && p.stock > 0)
        .length;

      return sendResponse(response, {
        success: true,
        stats: {
          totalRevenue,
          totalOrders,
          totalProducts,
          totalCustomers,
          averageOrderValue,
          lowStockProducts,
          recentOrders: recentOrders.map((order: any) => ({
            id: order.id,
            total: order.total,
            status: order.status,
            customerName: order.customerInfo?.name || 'Unknown',
            createdAt: order.createdAt,
          })),
        },
      });
    } catch (error: any) {
      console.error('Error in getDashboardStats:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get analytics data
 */
export const getSellerAnalytics = onRequest(
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
      const days = parseInt(request.query.days as string) || parseInt(request.body?.days) || 30;
      
      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get orders
      const ordersSnapshot = await firestore
        .collection('orders')
        .where('sellerId', '==', sellerId)
        .get();

      const orders = ordersSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((order: any) => {
          if (!order.createdAt) return false;
          const orderDate = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
          return orderDate >= startDate && orderDate <= endDate;
        });

      // Daily breakdown
      const dailyData: Record<string, { revenue: number; orders: number }> = {};
      orders.forEach((order: any) => {
        if (!order.createdAt) return;
        const orderDate = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
        const dateKey = orderDate.toISOString().split('T')[0];
        if (!dailyData[dateKey]) {
          dailyData[dateKey] = { revenue: 0, orders: 0 };
        }
        dailyData[dateKey].revenue += order.total || 0;
        dailyData[dateKey].orders += 1;
      });

      // Product performance
      const productSales: Record<string, { name: string; sales: number; revenue: number }> = {};
      orders.forEach((order: any) => {
        order.items?.forEach((item: any) => {
          const productId = item.productId;
          if (!productSales[productId]) {
            productSales[productId] = {
              name: item.name || 'Unknown',
              sales: 0,
              revenue: 0,
            };
          }
          productSales[productId].sales += item.quantity || 0;
          productSales[productId].revenue += (item.price || 0) * (item.quantity || 0);
        });
      });

      return sendResponse(response, {
        success: true,
        analytics: {
          dailyData: Object.entries(dailyData).map(([date, data]) => ({ date, ...data })),
          productPerformance: Object.entries(productSales)
            .map(([productId, data]) => ({ productId, ...data }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10),
          totalRevenue: orders.reduce((sum: number, order: any) => sum + (order.total || 0), 0),
          totalOrders: orders.length,
        },
      });
    } catch (error: any) {
      console.error('Error in getSellerAnalytics:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// SELLER FUNCTIONS - REPORTS
// ============================================================================

/**
 * Generate sales report
 */
export const generateSalesReport = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const sellerId = request.body?.sellerId || auth.uid;
      const days = parseInt(request.body?.days) || 30;

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const ordersSnapshot = await firestore
        .collection('orders')
        .where('sellerId', '==', sellerId)
        .get();

      const orders = ordersSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((order: any) => {
          if (!order.createdAt) return false;
          const orderDate = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
          return orderDate >= startDate && orderDate <= endDate;
        });

      const totalRevenue = orders.reduce((sum: number, order: any) => sum + (order.total || 0), 0);
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      const statusBreakdown: Record<string, number> = {};
      orders.forEach((order: any) => {
        const status = order.status || 'Unknown';
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      });

      const dailyBreakdown: Record<string, { revenue: number; orders: number }> = {};
      orders.forEach((order: any) => {
        if (!order.createdAt) return;
        const orderDate = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
        const dateKey = orderDate.toISOString().split('T')[0];
        if (!dailyBreakdown[dateKey]) {
          dailyBreakdown[dateKey] = { revenue: 0, orders: 0 };
        }
        dailyBreakdown[dateKey].revenue += order.total || 0;
        dailyBreakdown[dateKey].orders += 1;
      });

      return sendResponse(response, {
        success: true,
        report: {
          type: 'sales',
          dateRange: days,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          summary: {
            totalRevenue,
            totalOrders,
            averageOrderValue,
            statusBreakdown,
          },
          dailyBreakdown: Object.entries(dailyBreakdown).map(([date, data]) => ({ date, ...data })),
        },
      });
    } catch (error: any) {
      console.error('Error in generateSalesReport:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Generate customer report
 */
export const generateCustomerReport = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const sellerId = request.body?.sellerId || auth.uid;
      const days = parseInt(request.body?.days) || 30;

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const ordersSnapshot = await firestore
        .collection('orders')
        .where('sellerId', '==', sellerId)
        .get();

      const orders = ordersSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((order: any) => {
          if (!order.createdAt) return false;
          const orderDate = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
          return orderDate >= startDate && orderDate <= endDate;
        });

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
        report: {
          type: 'customers',
          dateRange: days,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          totalCustomers: customers.length,
          segments: {
            vip: vipCustomers.length,
            regular: regularCustomers.length,
            new: newCustomers.length,
          },
          customers: customers.map(c => ({
            ...c,
            firstOrderDate: c.firstOrderDate.toISOString(),
            lastOrderDate: c.lastOrderDate.toISOString(),
          })),
        },
      });
    } catch (error: any) {
      console.error('Error in generateCustomerReport:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// SELLER FUNCTIONS - MARKETING (DISCOUNT CODES)
// ============================================================================

/**
 * Create discount code
 */
export const createDiscountCode = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const {
        code,
        type,
        value,
        maxUses,
        minOrderAmount,
        validFrom,
        validUntil,
        sellerId,
      } = request.body;

      if (!code || !type || !value || !sellerId) {
        return sendError(response, 'Code, type, value, and sellerId are required', 400);
      }

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only create discount codes for your own store', 403);
      }

      // Check if code already exists
      const existingCodeQuery = await firestore
        .collection('discount_codes')
        .where('code', '==', code.toUpperCase())
        .where('sellerId', '==', sellerId)
        .limit(1)
        .get();

      if (!existingCodeQuery.empty) {
        return sendError(response, 'Discount code already exists', 400);
      }

      const discountCodeData: any = {
        code: code.toUpperCase(),
        type,
        value: parseFloat(value),
        sellerId,
        uses: 0,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (maxUses) discountCodeData.maxUses = parseInt(maxUses);
      if (minOrderAmount) discountCodeData.minOrderAmount = parseFloat(minOrderAmount);
      if (validFrom) discountCodeData.validFrom = admin.firestore.Timestamp.fromDate(new Date(validFrom));
      if (validUntil) discountCodeData.validUntil = admin.firestore.Timestamp.fromDate(new Date(validUntil));

      const discountRef = await firestore.collection('discount_codes').add(discountCodeData);

      return sendResponse(response, {
        success: true,
        discountCodeId: discountRef.id,
        message: 'Discount code created successfully',
      });
    } catch (error: any) {
      console.error('Error in createDiscountCode:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get discount codes
 */
export const getDiscountCodes = onRequest(
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

      const snapshot = await firestore
        .collection('discount_codes')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .get();

      const discountCodes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        discountCodes,
      });
    } catch (error: any) {
      console.error('Error in getDiscountCodes:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update discount code
 */
export const updateDiscountCode = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const { discountCodeId, ...updateData } = request.body;

      if (!discountCodeId) {
        return sendError(response, 'Discount code ID is required', 400);
      }

      const discountRef = firestore.collection('discount_codes').doc(discountCodeId);
      const discountDoc = await discountRef.get();

      if (!discountDoc.exists) {
        return sendError(response, 'Discount code not found', 404);
      }

      const discount = discountDoc.data()!;
      if (discount.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const update: any = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (updateData.status !== undefined) update.status = updateData.status;
      if (updateData.maxUses !== undefined) update.maxUses = parseInt(updateData.maxUses);
      if (updateData.validFrom !== undefined) update.validFrom = admin.firestore.Timestamp.fromDate(new Date(updateData.validFrom));
      if (updateData.validUntil !== undefined) update.validUntil = admin.firestore.Timestamp.fromDate(new Date(updateData.validUntil));

      await discountRef.update(update);

      return sendResponse(response, {
        success: true,
        message: 'Discount code updated successfully',
      });
    } catch (error: any) {
      console.error('Error in updateDiscountCode:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Delete discount code
 */
export const deleteDiscountCode = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const discountCodeId = request.body?.discountCodeId;

      if (!discountCodeId) {
        return sendError(response, 'Discount code ID is required', 400);
      }

      const discountRef = firestore.collection('discount_codes').doc(discountCodeId);
      const discountDoc = await discountRef.get();

      if (!discountDoc.exists) {
        return sendError(response, 'Discount code not found', 404);
      }

      const discount = discountDoc.data()!;
      if (discount.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      await discountRef.delete();

      return sendResponse(response, {
        success: true,
        message: 'Discount code deleted successfully',
      });
    } catch (error: any) {
      console.error('Error in deleteDiscountCode:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// SELLER FUNCTIONS - STORE MANAGEMENT
// ============================================================================

/**
 * Get store settings
 */
export const getStoreSettings = onRequest(
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

      const storeDoc = await firestore.collection('stores').doc(sellerId).get();

      if (!storeDoc.exists) {
        return sendError(response, 'Store not found', 404);
      }

      return sendResponse(response, {
        success: true,
        store: { id: storeDoc.id, ...storeDoc.data() },
      });
    } catch (error: any) {
      console.error('Error in getStoreSettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update store settings
 */
export const updateStoreSettings = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();
      const storage = admin.storage();

      const sellerId = request.body?.sellerId || auth.uid;
      const updateData = request.body?.updateData || {};

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const storeRef = firestore.collection('stores').doc(sellerId);

      // Handle logo upload if provided
      if (updateData.logoBase64) {
        try {
          const base64Data = updateData.logoBase64.includes(',') 
            ? updateData.logoBase64.split(',')[1] 
            : updateData.logoBase64;
          const buffer = Buffer.from(base64Data, 'base64');
          const matches = updateData.logoBase64.match(/data:image\/(\w+);base64/);
          const extension = matches ? matches[1] : 'jpg';
          
          const fileName = `store_logos/${sellerId}/${Date.now()}.${extension}`;
          const bucket = storage.bucket();
          const file = bucket.file(fileName);
          
          await file.save(buffer, {
            metadata: { contentType: `image/${extension}` },
          });
          await file.makePublic();
          
          updateData.storeLogo = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
          delete updateData.logoBase64;
        } catch (error) {
          console.error('Logo upload error:', error);
          return sendError(response, 'Failed to upload logo', 500);
        }
      }

      // Handle banner upload if provided
      if (updateData.bannerBase64) {
        try {
          const base64Data = updateData.bannerBase64.includes(',') 
            ? updateData.bannerBase64.split(',')[1] 
            : updateData.bannerBase64;
          const buffer = Buffer.from(base64Data, 'base64');
          const matches = updateData.bannerBase64.match(/data:image\/(\w+);base64/);
          const extension = matches ? matches[1] : 'jpg';
          
          const fileName = `store_banners/${sellerId}/${Date.now()}.${extension}`;
          const bucket = storage.bucket();
          const file = bucket.file(fileName);
          
          await file.save(buffer, {
            metadata: { contentType: `image/${extension}` },
          });
          await file.makePublic();
          
          updateData.storeBanner = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
          delete updateData.bannerBase64;
        } catch (error) {
          console.error('Banner upload error:', error);
          return sendError(response, 'Failed to upload banner', 500);
        }
      }

      updateData.updatedAt = FieldValue.serverTimestamp();

      await storeRef.set(updateData, { merge: true });

      return sendResponse(response, {
        success: true,
        message: 'Store settings updated successfully',
      });
    } catch (error: any) {
      console.error('Error in updateStoreSettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// SELLER FUNCTIONS - CUSTOMERS
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - USER MANAGEMENT
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - PLATFORM SETTINGS
// ============================================================================

/**
 * Get platform settings
 */
export const getPlatformSettings = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const settingsDoc = await firestore.collection('platform_settings').doc('platform_settings').get();

      if (!settingsDoc.exists) {
        // Return defaults
        return sendResponse(response, {
          success: true,
          settings: {
            platformCommissionRate: 0.05,
            minimumPayoutAmount: 5000,
            platformFee: 0,
            currency: 'NGN',
          },
        });
      }

      return sendResponse(response, {
        success: true,
        settings: settingsDoc.data(),
      });
    } catch (error: any) {
      console.error('Error in getPlatformSettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update platform settings
 */
export const updatePlatformSettings = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const updateData = request.body?.settings || {};

      const settingsRef = firestore.collection('platform_settings').doc('platform_settings');
      
      const update: any = {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      };

      if (updateData.platformCommissionRate !== undefined) {
        update.platformCommissionRate = parseFloat(updateData.platformCommissionRate);
      }
      if (updateData.minimumPayoutAmount !== undefined) {
        update.minimumPayoutAmount = parseFloat(updateData.minimumPayoutAmount);
      }
      if (updateData.platformFee !== undefined) {
        update.platformFee = parseFloat(updateData.platformFee);
      }
      if (updateData.currency !== undefined) {
        update.currency = updateData.currency;
      }

      await settingsRef.set(update, { merge: true });

      return sendResponse(response, {
        success: true,
        message: 'Platform settings updated successfully',
      });
    } catch (error: any) {
      console.error('Error in updatePlatformSettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// ADMIN FUNCTIONS - ORDERS & DISPUTES
// ============================================================================
// ============================================================================
// SHIPPING ZONE FUNCTIONS
// ============================================================================

/**
 * Get shipping zones (public - for checkout)
 */
export const getPublicShippingZones = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const sellerId = request.query.sellerId as string || request.body?.sellerId;
      if (!sellerId) {
        return sendError(response, 'Seller ID is required', 400);
      }

      const firestore = admin.firestore();
      const zonesQuery = await firestore
        .collection('shipping_zones')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .get();

      const zones = zonesQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        zones,
      });
    } catch (error: any) {
      console.error('Error in getPublicShippingZones:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get shipping zones for seller (authenticated)
 */
export const getShippingZones = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const firestore = admin.firestore();
      const zonesQuery = await firestore
        .collection('shipping_zones')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .get();

      const zones = zonesQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        zones,
      });
    } catch (error: any) {
      console.error('Error in getShippingZones:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create shipping zone
 */
export const createShippingZone = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { sellerId, name, rate, states, freeThreshold } = request.body;

      if (!sellerId || !name || rate === undefined) {
        return sendError(response, 'Seller ID, name, and rate are required', 400);
      }

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only create shipping zones for your own store', 403);
      }

      const firestore = admin.firestore();
      const zoneRef = firestore.collection('shipping_zones').doc();

      await zoneRef.set({
        sellerId,
        name,
        rate: parseFloat(rate),
        states: states || [],
        freeThreshold: freeThreshold ? parseFloat(freeThreshold) : undefined,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, {
        success: true,
        zoneId: zoneRef.id,
      });
    } catch (error: any) {
      console.error('Error in createShippingZone:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update shipping zone
 */
export const updateShippingZone = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { sellerId, zoneId, name, rate, states, freeThreshold } = request.body;

      if (!sellerId || !zoneId) {
        return sendError(response, 'Seller ID and zone ID are required', 400);
      }

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const firestore = admin.firestore();
      const zoneRef = firestore.collection('shipping_zones').doc(zoneId);
      const zoneDoc = await zoneRef.get();

      if (!zoneDoc.exists) {
        return sendError(response, 'Shipping zone not found', 404);
      }

      const zoneData = zoneDoc.data()!;
      if (zoneData.sellerId !== sellerId && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Zone does not belong to your store', 403);
      }

      const updateData: any = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (name !== undefined) updateData.name = name;
      if (rate !== undefined) updateData.rate = parseFloat(rate);
      if (states !== undefined) updateData.states = states;
      if (freeThreshold !== undefined) updateData.freeThreshold = freeThreshold ? parseFloat(freeThreshold) : undefined;

      await zoneRef.update(updateData);

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in updateShippingZone:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Delete shipping zone
 */
export const deleteShippingZone = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { sellerId, zoneId } = request.body;

      if (!sellerId || !zoneId) {
        return sendError(response, 'Seller ID and zone ID are required', 400);
      }

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const firestore = admin.firestore();
      const zoneRef = firestore.collection('shipping_zones').doc(zoneId);
      const zoneDoc = await zoneRef.get();

      if (!zoneDoc.exists) {
        return sendError(response, 'Shipping zone not found', 404);
      }

      const zoneData = zoneDoc.data()!;
      if (zoneData.sellerId !== sellerId && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Zone does not belong to your store', 403);
      }

      await zoneRef.delete();

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in deleteShippingZone:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get shipping settings
 */
export const getShippingSettings = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const firestore = admin.firestore();
      const storeDoc = await firestore.collection('stores').doc(sellerId).get();

      if (!storeDoc.exists) {
        return sendResponse(response, {
          success: true,
          settings: {},
        });
      }

      const storeData = storeDoc.data()!;
      const settings = {
        defaultPackagingType: storeData?.shippingSettings?.defaultPackagingType,
        packagingCost: storeData?.shippingSettings?.packagingCost,
      };

      return sendResponse(response, {
        success: true,
        settings,
      });
    } catch (error: any) {
      console.error('Error in getShippingSettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update shipping settings
 */
export const updateShippingSettings = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { sellerId, defaultPackagingType, packagingCost } = request.body;

      if (!sellerId) {
        return sendError(response, 'Seller ID is required', 400);
      }

      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const firestore = admin.firestore();
      const storeRef = firestore.collection('stores').doc(sellerId);
      const storeDoc = await storeRef.get();

      if (!storeDoc.exists) {
        return sendError(response, 'Store not found', 404);
      }

      const updateData: any = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      const shippingSettings: any = {
        ...(storeDoc.data()?.shippingSettings || {}),
      };

      if (defaultPackagingType !== undefined) {
        shippingSettings.defaultPackagingType = defaultPackagingType;
      }
      if (packagingCost !== undefined) {
        shippingSettings.packagingCost = parseFloat(packagingCost);
      }

      updateData.shippingSettings = shippingSettings;

      await storeRef.update(updateData);

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in updateShippingSettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// ORDER AVAILABILITY FUNCTIONS
// ============================================================================
// ============================================================================
// PARKS MANAGEMENT FUNCTIONS (ADMIN)
// ============================================================================

/**
 * Get all parks (public - no auth required)
 */
export const getAllParks = onRequest(
  { 
    secrets: [paystackSecret],
    invoker: 'public'  // Make it publicly accessible
  },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const firestore = admin.firestore();
      const parksQuery = await firestore
        .collection('parks')
        .where('isActive', '==', true)  // Filter to only active parks
        .orderBy('state', 'asc')
        .orderBy('city', 'asc')
        .orderBy('name', 'asc')
        .get();

      const parks = parksQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        parks,
      });
    } catch (error: any) {
      console.error('Error in getAllParks:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get parks by state (public)
 */
export const getParksByState = onRequest(
  { 
    secrets: [paystackSecret],
    invoker: 'public'  // Make it publicly accessible
  },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const state = request.query.state as string || request.body?.state;
      if (!state) {
        return sendError(response, 'State is required', 400);
      }

      const firestore = admin.firestore();
      const parksQuery = await firestore
        .collection('parks')
        .where('state', '==', state.trim())  // Trim to handle whitespace
        .where('isActive', '==', true)
        .orderBy('city', 'asc')
        .orderBy('name', 'asc')
        .get();

      const parks = parksQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        parks,
      });
    } catch (error: any) {
      console.error('Error in getParksByState:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create park (admin only)
 */
export const createPark = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const { name, city, state, isActive } = request.body;

      if (!name || !city || !state) {
        return sendError(response, 'Name, city, and state are required', 400);
      }

      const firestore = admin.firestore();
      const parkRef = firestore.collection('parks').doc();

      await parkRef.set({
        name,
        city,
        state,
        isActive: isActive !== undefined ? isActive : true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, {
        success: true,
        parkId: parkRef.id,
      });
    } catch (error: any) {
      console.error('Error in createPark:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update park (admin only)
 */
export const updatePark = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const { parkId, name, city, state, isActive } = request.body;

      if (!parkId) {
        return sendError(response, 'Park ID is required', 400);
      }

      const firestore = admin.firestore();
      const parkRef = firestore.collection('parks').doc(parkId);
      const parkDoc = await parkRef.get();

      if (!parkDoc.exists) {
        return sendError(response, 'Park not found', 404);
      }

      const updateData: any = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (name !== undefined) updateData.name = name;
      if (city !== undefined) updateData.city = city;
      if (state !== undefined) updateData.state = state;
      if (isActive !== undefined) updateData.isActive = isActive;

      await parkRef.update(updateData);

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in updatePark:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Delete park (admin only)
 */
export const deletePark = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const { parkId } = request.body;

      if (!parkId) {
        return sendError(response, 'Park ID is required', 400);
      }

      const firestore = admin.firestore();
      const parkRef = firestore.collection('parks').doc(parkId);
      const parkDoc = await parkRef.get();

      if (!parkDoc.exists) {
        return sendError(response, 'Park not found', 404);
      }

      await parkRef.delete();

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in deletePark:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Initialize parks (admin only - one-time setup)
 */
export const initializeParks = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      // Check if parks already exist
      const existingParks = await firestore.collection('parks').limit(1).get();
      if (!existingParks.empty) {
        return sendError(response, 'Parks already initialized. Delete existing parks first if you want to reinitialize.', 400);
      }

      // Default Northern parks data (simplified - in production, import from data file)
      const NORTHERN_PARKS = [
        { name: 'Kano Central Park', city: 'Kano', state: 'Kano', isActive: true },
        { name: 'Kaduna Main Park', city: 'Kaduna', state: 'Kaduna', isActive: true },
        { name: 'Sokoto Transport Park', city: 'Sokoto', state: 'Sokoto', isActive: true },
        { name: 'Katsina Central Park', city: 'Katsina', state: 'Katsina', isActive: true },
        { name: 'Zaria Main Park', city: 'Zaria', state: 'Kaduna', isActive: true },
        { name: 'Maiduguri Central Park', city: 'Maiduguri', state: 'Borno', isActive: true },
        { name: 'Gombe Main Park', city: 'Gombe', state: 'Gombe', isActive: true },
        { name: 'Bauchi Central Park', city: 'Bauchi', state: 'Bauchi', isActive: true },
        { name: 'Yola Main Park', city: 'Yola', state: 'Adamawa', isActive: true },
        { name: 'Jos Central Park', city: 'Jos', state: 'Plateau', isActive: true },
      ];

      // Add all parks
      const batch = firestore.batch();
      NORTHERN_PARKS.forEach((park) => {
        const parkRef = firestore.collection('parks').doc();
        batch.set(parkRef, {
          name: park.name,
          city: park.city,
          state: park.state,
          isActive: park.isActive,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();

      return sendResponse(response, {
        success: true,
        count: NORTHERN_PARKS.length,
        message: `Successfully initialized ${NORTHERN_PARKS.length} parks`,
      });
    } catch (error: any) {
      console.error('Error in initializeParks:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// EARNINGS FUNCTIONS
// ============================================================================
// ============================================================================
// PAYOUT REQUEST FUNCTIONS
// ============================================================================
// ============================================================================
// SECURITY & ADMIN FUNCTIONS
// ============================================================================

/**
 * Get access logs (admin only)
 */
export const getAccessLogs = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const limit = parseInt(request.query.limit as string) || 100;
      const startAfter = request.query.startAfter as string;

      let query: admin.firestore.Query = firestore.collection('access_logs')
        .orderBy('timestamp', 'desc')
        .limit(limit);

      if (startAfter) {
        const startAfterDoc = await firestore.collection('access_logs').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.get();
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
      }));

      return sendResponse(response, { success: true, logs });
    } catch (error: any) {
      console.error('Error in getAccessLogs:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get failed login attempts (admin only)
 */
export const getFailedLogins = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const limit = parseInt(request.query.limit as string) || 50;

      const snapshot = await firestore.collection('access_logs')
        .where('action', '==', 'failed_login')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
      }));

      return sendResponse(response, { success: true, logs });
    } catch (error: any) {
      console.error('Error in getFailedLogins:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get API keys (admin only)
 */
export const getApiKeys = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const snapshot = await firestore.collection('api_keys')
        .orderBy('createdAt', 'desc')
        .get();

      const keys = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt,
        lastUsedAt: doc.data().lastUsedAt?.toDate?.() || doc.data().lastUsedAt,
        expiresAt: doc.data().expiresAt?.toDate?.() || doc.data().expiresAt,
      }));

      return sendResponse(response, { success: true, keys });
    } catch (error: any) {
      console.error('Error in getApiKeys:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create API key (admin only)
 */
export const createApiKey = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAdmin(request.headers.authorization || null);
      const { name, scopes, rateLimit, expiresInDays } = request.body;

      if (!name || !scopes || !Array.isArray(scopes) || scopes.length === 0) {
        return sendError(response, 'Name and at least one scope are required', 400);
      }

      const firestore = admin.firestore();
      const crypto = require('crypto');
      
      // Generate API key
      const apiKey = `ikm_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : undefined;

      const docRef = firestore.collection('api_keys').doc();
      await docRef.set({
        name,
        keyHash,
        keyPrefix: apiKey.substring(0, 8),
        scopes,
        rateLimit: rateLimit || null,
        expiresAt,
        isActive: true,
        createdBy: auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, {
        success: true,
        id: docRef.id,
        apiKey, // Return full key only once
      });
    } catch (error: any) {
      console.error('Error in createApiKey:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Revoke API key (admin only)
 */
export const revokeApiKey = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const { apiKeyId } = request.body;

      if (!apiKeyId) {
        return sendError(response, 'API key ID is required', 400);
      }

      const firestore = admin.firestore();
      await firestore.collection('api_keys').doc(apiKeyId).update({
        isActive: false,
        revokedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in revokeApiKey:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get security settings (admin only)
 */
export const getSecuritySettings = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const doc = await firestore.collection('security_settings').doc('settings').get();

      if (doc.exists) {
        return sendResponse(response, { success: true, settings: doc.data() });
      }

      // Return defaults
      const defaults = {
        passwordMinLength: 8,
        passwordRequireUppercase: true,
        passwordRequireLowercase: true,
        passwordRequireNumbers: true,
        passwordRequireSpecialChars: false,
        twoFactorEnabled: false,
        sessionTimeoutMinutes: 60,
        maxLoginAttempts: 5,
        lockoutDurationMinutes: 30,
        ipWhitelist: [],
        ipBlacklist: [],
        emailVerificationRequired: false,
        accountLockoutEnabled: true,
      };

      return sendResponse(response, { success: true, settings: defaults });
    } catch (error: any) {
      console.error('Error in getSecuritySettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update security settings (admin only)
 */
export const updateSecuritySettings = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const settings = request.body;

      if (!settings) {
        return sendError(response, 'Settings are required', 400);
      }

      const firestore = admin.firestore();
      await firestore.collection('security_settings').doc('settings').set({
        ...settings,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in updateSecuritySettings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get audit trail (admin only)
 */
export const getAuditTrail = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const limit = parseInt(request.query.limit as string) || 100;
      const startAfter = request.query.startAfter as string;
      const resourceType = request.query.resourceType as string;
      const userId = request.query.userId as string;

      let query: admin.firestore.Query = firestore.collection('audit_trail')
        .orderBy('timestamp', 'desc')
        .limit(limit);

      if (resourceType && resourceType !== 'all') {
        query = query.where('resourceType', '==', resourceType) as any;
      }

      if (userId) {
        query = query.where('userId', '==', userId) as any;
      }

      if (startAfter) {
        const startAfterDoc = await firestore.collection('audit_trail').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.get();
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
      }));

      return sendResponse(response, { success: true, logs });
    } catch (error: any) {
      console.error('Error in getAuditTrail:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get Firestore rules (admin only)
 */
export const getFirestoreRules = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);

      // Note: In production, use Firebase Management API to fetch actual rules
      // For now, return a placeholder
      return sendResponse(response, {
        success: true,
        rules: '// Firestore rules would be fetched from Firebase Management API\n// Use Firebase Console or CLI to view/update rules',
        version: '1',
        lastDeployed: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Error in getFirestoreRules:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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

export const helloWorld = functions.https.onRequest((request, response) => {
  response.json({ message: 'Hello from Cloud Functions! 🎉' });
});

// Force redeploy to pick up config changes
