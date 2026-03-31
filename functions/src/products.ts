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
// ============================================================================
// SEARCH FUNCTIONS (PUBLIC)
// ============================================================================

/**
 * Search products (public)
 */
export const searchProducts = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const { query, category, minPrice, maxPrice, limit } = request.body;

      if (!query || query.trim().length === 0) {
        return sendError(response, 'Search query is required');
      }

      const firestore = admin.firestore();
      let productsQuery: admin.firestore.Query = firestore
        .collection('products')
        .where('status', '==', 'active')
        .limit(limit || 20);

      // Note: Firestore doesn't support full-text search natively
      // This is a simple prefix match - for production, consider Algolia or similar
      const searchTerm = query.toLowerCase().trim();

      const snapshot = await productsQuery.get();
      let products = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        .filter((product: any) => {
          // Simple text search in name and description
          const matchesQuery =
            product.name?.toLowerCase().includes(searchTerm) ||
            product.description?.toLowerCase().includes(searchTerm);

          const matchesCategory = !category || product.category === category;
          const matchesMinPrice = !minPrice || (product.price >= minPrice);
          const matchesMaxPrice = !maxPrice || (product.price <= maxPrice);

          return matchesQuery && matchesCategory && matchesMinPrice && matchesMaxPrice;
        });

      return sendResponse(response, {
        success: true,
        products,
        total: products.length,
      });
    } catch (error: any) {
      console.error('Error in searchProducts:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// SELLER FUNCTIONS - PRODUCT MANAGEMENT
// ============================================================================

/**
 * Get seller's products (paginated)
 */
export const getSellerProducts = onRequest(
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
      
      // Verify seller owns this request or is admin
      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only view your own products', 403);
      }

      const limit = parseInt(request.query.limit as string) || 50;
      const startAfter = request.query.startAfter as string;
      const status = request.query.status as string;

      let query: admin.firestore.Query = firestore
        .collection('products')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (status) {
        query = query.where('status', '==', status);
      }

      if (startAfter) {
        const startAfterDoc = await firestore.collection('products').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.get();
      const products = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, {
        success: true,
        products,
        hasMore: snapshot.docs.length === limit,
      });
    } catch (error: any) {
      console.error('Error in getSellerProducts:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get single product
 */
export const getProduct = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const productId = request.query.productId as string || request.body?.productId;
      if (!productId) {
        return sendError(response, 'Product ID is required', 400);
      }

      const firestore = admin.firestore();
      const productDoc = await firestore.collection('products').doc(productId).get();

      if (!productDoc.exists) {
        return sendError(response, 'Product not found', 404);
      }

      return sendResponse(response, {
        success: true,
        product: { id: productDoc.id, ...productDoc.data() },
      });
    } catch (error: any) {
      console.error('Error in getProduct:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create product (with base64 image upload)
 */
export const createProduct = onRequest(
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

      const {
        name,
        description,
        price,
        compareAtPrice,
        stock,
        sku,
        category,
        status,
        allowShipping,
        imageBase64,
        variants,
      } = request.body;

      // Validation
      if (!name || !price) {
        return sendError(response, 'Name and price are required', 400);
      }

      let imageUrl: string | undefined;
      
      // Handle base64 image upload
      if (imageBase64) {
        try {
          const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
          const buffer = Buffer.from(base64Data, 'base64');
          const matches = imageBase64.match(/data:image\/(\w+);base64/);
          const extension = matches ? matches[1] : 'jpg';
          
          const fileName = `product_images/${auth.uid}/${Date.now()}.${extension}`;
          const bucket = storage.bucket();
          const file = bucket.file(fileName);
          
          await file.save(buffer, {
            metadata: { contentType: `image/${extension}` },
          });
          await file.makePublic();
          
          imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        } catch (error) {
          console.error('Image upload error:', error);
          return sendError(response, 'Failed to upload image', 500);
        }
      }

      // Check if seller has shipping zones for default allowShipping
      let finalAllowShipping = allowShipping;
      if (finalAllowShipping === undefined) {
        const zonesSnapshot = await firestore
          .collection('shipping_zones')
          .where('sellerId', '==', auth.uid)
          .get();
        finalAllowShipping = zonesSnapshot.size > 0;
      }

      const productData: any = {
        name,
        description: description || '',
        price: parseFloat(price),
        compareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : undefined,
        stock: stock ? parseInt(stock) : 0,
        sku: sku || '',
        category: category || '',
        status: status || 'active',
        allowShipping: finalAllowShipping,
        sellerId: auth.uid,
        views: 0,
        salesCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (imageUrl) {
        productData.imageUrl = imageUrl;
      }

      if (variants && Array.isArray(variants)) {
        productData.variants = variants.map((variant: any, idx: number) => ({
          id: `variant_${Date.now()}_${idx}`,
          name: variant.name,
          options: variant.options.map((opt: any) => ({
            value: opt.value,
            priceModifier: opt.priceModifier || 0,
            stock: opt.stock,
            sku: opt.sku,
          })),
        }));
      }

      const productRef = await firestore.collection('products').add(productData);

      return sendResponse(response, {
        success: true,
        productId: productRef.id,
        product: { id: productRef.id, ...productData },
      });
    } catch (error: any) {
      console.error('Error in createProduct:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update product
 */
export const updateProduct = onRequest(
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

      const {
        productId,
        name,
        description,
        price,
        compareAtPrice,
        stock,
        sku,
        category,
        status,
        allowShipping,
        imageBase64,
        variants,
      } = request.body;

      if (!productId) {
        return sendError(response, 'Product ID is required', 400);
      }

      const productRef = firestore.collection('products').doc(productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        return sendError(response, 'Product not found', 404);
      }

      const product = productDoc.data()!;
      if (product.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only update your own products', 403);
      }

      let imageUrl: string | undefined;
      
      // Handle base64 image upload if provided
      if (imageBase64) {
        try {
          const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
          const buffer = Buffer.from(base64Data, 'base64');
          const matches = imageBase64.match(/data:image\/(\w+);base64/);
          const extension = matches ? matches[1] : 'jpg';
          
          const fileName = `product_images/${auth.uid}/${Date.now()}.${extension}`;
          const bucket = storage.bucket();
          const file = bucket.file(fileName);
          
          await file.save(buffer, {
            metadata: { contentType: `image/${extension}` },
          });
          await file.makePublic();
          
          imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        } catch (error) {
          console.error('Image upload error:', error);
          return sendError(response, 'Failed to upload image', 500);
        }
      }

      const updateData: any = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description || '';
      if (price !== undefined) updateData.price = parseFloat(price);
      if (compareAtPrice !== undefined) updateData.compareAtPrice = compareAtPrice ? parseFloat(compareAtPrice) : undefined;
      if (stock !== undefined) updateData.stock = parseInt(stock);
      if (sku !== undefined) updateData.sku = sku || '';
      if (category !== undefined) updateData.category = category || '';
      if (status !== undefined) updateData.status = status;
      if (allowShipping !== undefined) updateData.allowShipping = allowShipping;
      if (imageUrl) updateData.imageUrl = imageUrl;
      if (variants !== undefined) {
        updateData.variants = variants.map((variant: any, idx: number) => ({
          id: variant.id || `variant_${Date.now()}_${idx}`,
          name: variant.name,
          options: variant.options.map((opt: any) => ({
            value: opt.value,
            priceModifier: opt.priceModifier || 0,
            stock: opt.stock,
            sku: opt.sku,
          })),
        }));
      }

      await productRef.update(updateData);

      return sendResponse(response, {
        success: true,
        productId,
        message: 'Product updated successfully',
      });
    } catch (error: any) {
      console.error('Error in updateProduct:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Delete product
 */
export const deleteProduct = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const productId = request.body?.productId;
      if (!productId) {
        return sendError(response, 'Product ID is required', 400);
      }

      const productRef = firestore.collection('products').doc(productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        return sendError(response, 'Product not found', 404);
      }

      const product = productDoc.data()!;
      if (product.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only delete your own products', 403);
      }

      await productRef.delete();

      return sendResponse(response, {
        success: true,
        message: 'Product deleted successfully',
      });
    } catch (error: any) {
      console.error('Error in deleteProduct:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// NORTHERN PRODUCT FUNCTIONS (Category-Specific Products)
// ============================================================================

/**
 * Create Northern product (with all category-specific fields)
 * Supports: Fragrance, Fashion, Snacks, Materials, Skincare, Haircare, Islamic, Electronics
 */
export const createNorthernProduct = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const productData = request.body;

      // Basic validation
      if (!productData.name || !productData.price || !productData.category) {
        return sendError(response, 'Name, price, and category are required', 400);
      }

      // Validate category
      const validCategories = ['fragrance', 'fashion', 'snacks', 'materials', 'skincare', 'haircare', 'islamic', 'electronics'];
      if (!validCategories.includes(productData.category)) {
        return sendError(response, `Invalid category. Must be one of: ${validCategories.join(', ')}`, 400);
      }

      // Prepare product document
      const productDoc: any = {
        name: productData.name,
        description: productData.description || '',
        price: parseFloat(productData.price),
        compareAtPrice: productData.compareAtPrice ? parseFloat(productData.compareAtPrice) : undefined,
        stock: productData.stock ? parseInt(productData.stock) : 0,
        category: productData.category,
        status: productData.status || 'draft',
        sellerId: auth.uid,
        views: 0,
        salesCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Add media
      if (productData.imageUrls && Array.isArray(productData.imageUrls) && productData.imageUrls.length > 0) {
        productDoc.imageUrls = productData.imageUrls;
        productDoc.imageUrl = productData.imageUrls[0]; // Legacy field
      }
      if (productData.videoUrl) {
        productDoc.videoUrl = productData.videoUrl;
      }
      if (productData.audioDescription) {
        productDoc.audioDescription = productData.audioDescription;
      }

      // Add category-specific fields
      if (productData.category === 'fragrance') {
        if (productData.volume) productDoc.volume = productData.volume;
        if (productData.fragranceType) productDoc.fragranceType = productData.fragranceType;
        if (productData.container) productDoc.container = productData.container;
      }

      if (productData.category === 'fashion') {
        if (productData.sizeType) productDoc.sizeType = productData.sizeType;
        if (productData.abayaLength) productDoc.abayaLength = productData.abayaLength;
        if (productData.standardSize) productDoc.standardSize = productData.standardSize;
        if (productData.setIncludes) productDoc.setIncludes = productData.setIncludes;
        if (productData.material) productDoc.material = productData.material;
      }

      if (productData.category === 'snacks') {
        if (productData.packaging) productDoc.packaging = productData.packaging;
        if (productData.quantity) productDoc.quantity = parseInt(productData.quantity);
        if (productData.taste) productDoc.taste = productData.taste;
      }

      if (productData.category === 'materials') {
        if (productData.materialType) productDoc.materialType = productData.materialType;
        if (productData.fabricLength) productDoc.fabricLength = productData.fabricLength;
        if (productData.quality) productDoc.quality = productData.quality;
        if (productData.customMaterialType) productDoc.customMaterialType = productData.customMaterialType;
      }

      if (productData.category === 'skincare') {
        if (productData.skincareBrand) productDoc.skincareBrand = productData.skincareBrand;
        if (productData.skincareType) productDoc.skincareType = productData.skincareType;
        if (productData.skincareSize) productDoc.skincareSize = productData.skincareSize;
      }

      if (productData.category === 'haircare') {
        if (productData.haircareType) productDoc.haircareType = productData.haircareType;
        if (productData.haircareBrand) productDoc.haircareBrand = productData.haircareBrand;
        if (productData.haircareSize) productDoc.haircareSize = productData.haircareSize;
        if (productData.haircarePackageItems && Array.isArray(productData.haircarePackageItems)) {
          productDoc.haircarePackageItems = productData.haircarePackageItems;
        }
      }

      if (productData.category === 'islamic') {
        if (productData.islamicType) productDoc.islamicType = productData.islamicType;
        if (productData.islamicSize) productDoc.islamicSize = productData.islamicSize;
        if (productData.islamicMaterial) productDoc.islamicMaterial = productData.islamicMaterial;
      }

      if (productData.category === 'electronics') {
        if (productData.brand) productDoc.brand = productData.brand;
        if (productData.model) productDoc.model = productData.model;
      }

      // Add delivery settings
      if (productData.deliveryFeePaidBy) {
        productDoc.deliveryFeePaidBy = productData.deliveryFeePaidBy;
      }
      if (productData.deliveryMethods) {
        productDoc.deliveryMethods = productData.deliveryMethods;
      }

      // Create product
      const productRef = await firestore.collection('products').add(productDoc);

      // Generate share link (simplified - actual implementation would call the share action)
      const shareLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.com'}/product/${productRef.id}`;
      await productRef.update({ shareLink });

      return sendResponse(response, {
        success: true,
        productId: productRef.id,
        shareLink,
      });
    } catch (error: any) {
      console.error('Error in createNorthernProduct:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Update Northern product
 */
export const updateNorthernProduct = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const { productId, ...providedData } = request.body;

      if (!productId) {
        return sendError(response, 'Product ID is required', 400);
      }

      const productRef = firestore.collection('products').doc(productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        return sendError(response, 'Product not found', 404);
      }

      const product = productDoc.data()!;
      if (product.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only update your own products', 403);
      }

      const updateData: any = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Basic fields
      if (providedData.name !== undefined) updateData.name = providedData.name;
      if (providedData.description !== undefined) updateData.description = providedData.description || '';
      if (providedData.price !== undefined) updateData.price = parseFloat(providedData.price);
      if (providedData.compareAtPrice !== undefined) {
        updateData.compareAtPrice = providedData.compareAtPrice ? parseFloat(providedData.compareAtPrice) : null;
      }
      if (providedData.stock !== undefined) updateData.stock = parseInt(providedData.stock);
      if (providedData.status !== undefined) updateData.status = providedData.status;
      if (providedData.category !== undefined) updateData.category = providedData.category;

      // Media
      if (providedData.imageUrls !== undefined) {
        updateData.imageUrls = providedData.imageUrls;
        updateData.imageUrl = providedData.imageUrls?.[0] || null; // Legacy field
      }
      if (providedData.videoUrl !== undefined) {
        updateData.videoUrl = providedData.videoUrl || null;
      }
      if (providedData.audioDescription !== undefined) {
        updateData.audioDescription = providedData.audioDescription || null;
      }

      // Category-specific fields
      const category = providedData.category || product.category;

      if (category === 'fragrance') {
        if (providedData.volume !== undefined) updateData.volume = providedData.volume;
        if (providedData.fragranceType !== undefined) updateData.fragranceType = providedData.fragranceType;
        if (providedData.container !== undefined) updateData.container = providedData.container;
      }

      if (category === 'fashion') {
        if (providedData.sizeType !== undefined) updateData.sizeType = providedData.sizeType;
        if (providedData.abayaLength !== undefined) updateData.abayaLength = providedData.abayaLength;
        if (providedData.standardSize !== undefined) updateData.standardSize = providedData.standardSize;
        if (providedData.setIncludes !== undefined) updateData.setIncludes = providedData.setIncludes;
        if (providedData.material !== undefined) updateData.material = providedData.material;
      }

      if (category === 'snacks') {
        if (providedData.packaging !== undefined) updateData.packaging = providedData.packaging;
        if (providedData.quantity !== undefined) updateData.quantity = parseInt(providedData.quantity);
        if (providedData.taste !== undefined) updateData.taste = providedData.taste;
      }

      if (category === 'materials') {
        if (providedData.materialType !== undefined) updateData.materialType = providedData.materialType;
        if (providedData.fabricLength !== undefined) updateData.fabricLength = providedData.fabricLength;
        if (providedData.quality !== undefined) updateData.quality = providedData.quality;
        if (providedData.customMaterialType !== undefined) {
          updateData.customMaterialType = providedData.customMaterialType || null;
        }
      }

      if (category === 'skincare') {
        if (providedData.skincareBrand !== undefined) updateData.skincareBrand = providedData.skincareBrand;
        if (providedData.skincareType !== undefined) updateData.skincareType = providedData.skincareType;
        if (providedData.skincareSize !== undefined) updateData.skincareSize = providedData.skincareSize;
      }

      if (category === 'haircare') {
        if (providedData.haircareType !== undefined) updateData.haircareType = providedData.haircareType;
        if (providedData.haircareBrand !== undefined) updateData.haircareBrand = providedData.haircareBrand;
        if (providedData.haircareSize !== undefined) updateData.haircareSize = providedData.haircareSize;
        if (providedData.haircarePackageItems !== undefined) {
          updateData.haircarePackageItems = providedData.haircarePackageItems || null;
        }
      }

      if (category === 'islamic') {
        if (providedData.islamicType !== undefined) updateData.islamicType = providedData.islamicType;
        if (providedData.islamicSize !== undefined) updateData.islamicSize = providedData.islamicSize;
        if (providedData.islamicMaterial !== undefined) updateData.islamicMaterial = providedData.islamicMaterial;
      }

      if (category === 'electronics') {
        if (providedData.brand !== undefined) updateData.brand = providedData.brand;
        if (providedData.model !== undefined) updateData.model = providedData.model;
      }

      // Delivery settings
      if (providedData.deliveryFeePaidBy !== undefined) {
        updateData.deliveryFeePaidBy = providedData.deliveryFeePaidBy;
      }
      if (providedData.deliveryMethods !== undefined) {
        updateData.deliveryMethods = providedData.deliveryMethods;
      }

      // Update share link if product name or price changed
      if (updateData.name || updateData.price) {
        const shareLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.com'}/product/${productId}`;
        updateData.shareLink = shareLink;
      }

      await productRef.update(updateData);

      return sendResponse(response, {
        success: true,
        productId,
        message: 'Product updated successfully',
      });
    } catch (error: any) {
      console.error('Error in updateNorthernProduct:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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
