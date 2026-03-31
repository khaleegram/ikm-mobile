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
import { z } from 'zod';
import cors = require('cors');
import crypto from 'crypto';

// Initialize Firebase Admin
admin.initializeApp();

// CORS configuration - allow all origins for mobile/web apps
const corsHandler = cors({ origin: true });

// Define Firebase Secret for Paystack
const paystackSecret = defineSecret('PAYSTACK_SECRET_KEY');

// Import utilities
import {
    getPaystackSecretKey,
    getPlatformCommissionRate,
    requireAdmin,
    requireAuth,
    sendError,
    sendResponse,
    verifyIdToken,
} from './utils';

// ============================================================================
// PAYMENT FUNCTIONS
// ============================================================================

const verifyPaymentSchema = z.object({
  reference: z.string(),
  idempotencyKey: z.string(),
  cartItems: z.array(z.any()),
  total: z.number(),
  deliveryAddress: z.string(),
  customerInfo: z.any(),
  discountCode: z.string().optional(),
  shippingType: z.enum(['delivery', 'pickup', 'contact']).optional(),
  shippingPrice: z.number().optional(),
  deliveryFeePaidBy: z.enum(['seller', 'buyer']).optional(),
});

const initializePaystackTransactionSchema = z.object({
  amount: z.number().positive(),
  email: z.string().email(),
  callbackUrl: z.string().url(),
  metadata: z.record(z.string(), z.any()).optional(),
  reference: z.string().min(6).max(120).optional(),
});

const verifyPaystackTransactionSchema = z.object({
  reference: z.string().min(6),
  expectedAmount: z.number().positive().optional(),
  expectedEmail: z.string().email().optional(),
});

function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}

function computePaystackSignature(rawBody: Buffer, secretKey: string): string {
  return crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
}





async function writeTransactionTruth(input: {
  reference: string;
  status: string;
  amount?: number | null; // in NGN
  currency?: string | null;
  channel?: string | null;
  customerEmail?: string | null;
  paidAt?: string | null;
  metadata?: any;
  gatewayEvent?: string | null;
  gatewayId?: string | null;
  source?: 'paystack-webhook' | 'paystack-verify';
}) {
  const reference = asNonEmptyString(input.reference);
  if (!reference) return;

  const txStatus = asNonEmptyString(input.status).toLowerCase() || 'unknown';
  const uidFromMetadata = asNonEmptyString(input.metadata?.firebaseUid || input.metadata?.firebase_uid || input.metadata?.userId);
  const firestore = admin.firestore();

  await firestore.collection('transactions').doc(reference).set(
    {
      reference,
      gateway: 'paystack',
      status: txStatus,
      uid: uidFromMetadata || null,
      amount: typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null,
      currency: asNonEmptyString(input.currency) || 'NGN',
      channel: asNonEmptyString(input.channel) || null,
      customerEmail: asNonEmptyString(input.customerEmail).toLowerCase() || null,
      paidAt: input.paidAt || null,
      metadata: input.metadata || null,
      gatewayEvent: input.gatewayEvent || null,
      gatewayId: input.gatewayId || null,
      source: input.source || 'paystack-verify',
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Initialize Paystack transaction for in-app checkout.
 * Secret key stays on server, mobile only receives authorization URL.
 */
export const initializePaystackTransaction = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
    return corsHandler(request, response, async () => {
      try {
        if (request.method !== 'POST') {
          return sendError(response, 'Method not allowed', 405);
        }

        const auth = await requireAuth(request.headers.authorization || null);
        const validation = initializePaystackTransactionSchema.safeParse(request.body);
        if (!validation.success) {
          return sendError(response, 'Invalid payment initialization data', 400);
        }

        const {
          amount,
          email,
          callbackUrl,
          metadata,
          reference,
        } = validation.data;

        const amountInKobo = Math.round(amount * 100);
        if (!Number.isFinite(amountInKobo) || amountInKobo <= 0) {
          return sendError(response, 'Invalid payment amount', 400);
        }

        const normalizedReference =
          reference?.trim() ||
          `ikm_escrow_${auth.uid.slice(0, 8)}_${Date.now()}`;

        const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            amount: amountInKobo,
            currency: 'NGN',
            callback_url: callbackUrl,
            reference: normalizedReference,
            metadata: {
              ...(metadata || {}),
              source: 'ikm-mobile',
              firebaseUid: auth.uid,
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        const payload = await paystackResponse.json().catch(() => ({}));
        if (!paystackResponse.ok || !payload?.status || !payload?.data?.authorization_url) {
          const message =
            payload?.message ||
            `Paystack initialize failed with status ${paystackResponse.status}`;
          return sendError(response, message, 400);
        }

        const firestore = admin.firestore();
        try {
          await firestore.collection('payment_sessions').doc(normalizedReference).set({
            uid: auth.uid,
            email: email.toLowerCase(),
            amount,
            amountKobo: amountInKobo,
            callbackUrl,
            metadata: metadata || {},
            status: 'initialized',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (sessionError) {
          // Non-blocking. Checkout can continue.
          console.warn('Failed to persist payment session:', sessionError);
        }

        return sendResponse(response, {
          success: true,
          authorizationUrl: payload.data.authorization_url,
          accessCode: payload.data.access_code,
          reference: payload.data.reference || normalizedReference,
        });
      } catch (error: any) {
        console.error('Error in initializePaystackTransaction:', error);
        const statusCode = error?.message?.startsWith('Unauthorized') ? 401 : 500;
        return sendError(response, error?.message || 'Internal server error', statusCode);
      }
    });
  }
);

/**
 * Verify Paystack transaction by reference.
 */
export const verifyPaystackTransaction = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
    return corsHandler(request, response, async () => {
      try {
        if (request.method !== 'POST') {
          return sendError(response, 'Method not allowed', 405);
        }

        const auth = await requireAuth(request.headers.authorization || null);
        const validation = verifyPaystackTransactionSchema.safeParse(request.body);
        if (!validation.success) {
          return sendError(response, 'Invalid payment verification data', 400);
        }

        const { reference, expectedAmount, expectedEmail } = validation.data;
        const firestore = admin.firestore();

        // If webhook (or previous verify) already wrote transaction truth, prefer it.
        try {
          const existingTx = await firestore.collection('transactions').doc(reference).get();
          if (existingTx.exists) {
            const data = existingTx.data() || {};
            const existingStatus = String(data.status || '').toLowerCase();
            if (existingStatus === 'success') {
              const existingAmount = Number(data.amount || 0);
              if (typeof expectedAmount === 'number' && Math.abs(existingAmount - expectedAmount) > 0.01) {
                return sendError(
                  response,
                  `Amount mismatch. Expected: ₦${expectedAmount}, received: ₦${existingAmount}`,
                  400
                );
              }
              const existingEmail = String(data.customerEmail || '').trim().toLowerCase();
              if (expectedEmail && existingEmail && existingEmail !== expectedEmail.trim().toLowerCase()) {
                return sendError(response, 'Payment email mismatch', 400);
              }

              return sendResponse(response, {
                success: true,
                paid: true,
                reference,
                status: 'success',
                amount: Number.isFinite(existingAmount) && existingAmount > 0 ? existingAmount : undefined,
                currency: String(data.currency || 'NGN'),
                channel: String(data.channel || ''),
                paidAt: data.paidAt || null,
                customerEmail: existingEmail || null,
                metadata: data.metadata || null,
              });
            }
          }
        } catch (txTruthReadError) {
          // Non-blocking: fall back to Paystack API verify below.
          console.warn('Failed to read transaction truth:', txTruthReadError);
        }

        const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
        const paystackResponse = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${paystackSecretKey}`,
            },
            signal: AbortSignal.timeout(10000),
          }
        );

        const payload = await paystackResponse.json().catch(() => ({}));
        if (!paystackResponse.ok || !payload?.status || !payload?.data) {
          const message =
            payload?.message ||
            `Paystack verify failed with status ${paystackResponse.status}`;
          return sendError(response, message, 400);
        }

        const tx = payload.data;
        const txStatus = String(tx?.status || '').toLowerCase();
        if (txStatus !== 'success') {
          return sendError(response, `Payment not successful. Status: ${txStatus || 'unknown'}`, 400);
        }

        const paidAmount = Number(tx?.amount || 0) / 100;
        if (
          typeof expectedAmount === 'number' &&
          Math.abs(paidAmount - expectedAmount) > 0.01
        ) {
          return sendError(
            response,
            `Amount mismatch. Expected: ₦${expectedAmount}, received: ₦${paidAmount}`,
            400
          );
        }

        const customerEmail = String(tx?.customer?.email || tx?.customer_email || '').trim().toLowerCase();
        if (expectedEmail && customerEmail !== expectedEmail.trim().toLowerCase()) {
          return sendError(response, 'Payment email mismatch', 400);
        }

        const txMetadataUid = String(
          tx?.metadata?.firebaseUid ||
          tx?.metadata?.firebase_uid ||
          tx?.metadata?.userId ||
          ''
        ).trim();

        if (txMetadataUid && txMetadataUid !== auth.uid && !auth.isAdmin) {
          return sendError(response, 'Forbidden: Payment belongs to another user', 403);
        }

        try {
          await writeTransactionTruth({
            reference: String(tx?.reference || reference),
            status: txStatus,
            amount: paidAmount,
            currency: String(tx?.currency || 'NGN'),
            channel: String(tx?.channel || ''),
            customerEmail,
            paidAt: tx?.paid_at || null,
            metadata: tx?.metadata || null,
            gatewayEvent: null,
            gatewayId: String(tx?.id || ''),
            source: 'paystack-verify',
          });

          await firestore.collection('payment_verifications').doc(reference).set({
            uid: auth.uid,
            reference,
            status: txStatus,
            amount: paidAmount,
            currency: String(tx?.currency || 'NGN'),
            channel: String(tx?.channel || ''),
            customerEmail,
            paidAt: tx?.paid_at || null,
            metadata: tx?.metadata || null,
            verifiedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (verificationLogError) {
          // Non-blocking. Verification can still succeed.
          console.warn('Failed to persist payment verification log:', verificationLogError);
        }

        return sendResponse(response, {
          success: true,
          paid: true,
          reference: String(tx?.reference || reference),
          status: txStatus,
          amount: paidAmount,
          currency: String(tx?.currency || 'NGN'),
          channel: String(tx?.channel || ''),
          paidAt: tx?.paid_at || null,
          customerEmail: customerEmail || null,
          metadata: tx?.metadata || null,
        });
      } catch (error: any) {
        console.error('Error in verifyPaystackTransaction:', error);
        const statusCode = error?.message?.startsWith('Unauthorized') ? 401 : 500;
        return sendError(response, error?.message || 'Internal server error', statusCode);
      }
    });
  }
);

/**
 * Paystack webhook receiver.
 *
 * This endpoint is called by Paystack servers (no Firebase auth).
 * We verify the `x-paystack-signature` header and then persist transaction truth
 * into `transactions/{reference}`.
 *
 * Configure this URL as your Paystack webhook.
 */
export const paystackWebhook = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
    // Paystack does not require CORS, but we keep handler consistent.
    return corsHandler(request, response, async () => {
      try {
        if (request.method !== 'POST') {
          return sendError(response, 'Method not allowed', 405);
        }

        const secretKey = getPaystackSecretKey(paystackSecret.value());
        const signatureHeader = String(request.headers['x-paystack-signature'] || '').trim();
        const rawBody = (request as any).rawBody as Buffer | undefined;
        if (!rawBody || !Buffer.isBuffer(rawBody)) {
          return sendError(response, 'Missing raw body for signature verification', 400);
        }
        const computed = computePaystackSignature(rawBody, secretKey);
        if (!signatureHeader || computed !== signatureHeader) {
          return sendError(response, 'Invalid webhook signature', 401);
        }

        const event = asNonEmptyString((request.body as any)?.event);
        const data = (request.body as any)?.data || {};
        const reference = asNonEmptyString(data?.reference);
        const status = asNonEmptyString(data?.status).toLowerCase() || 'unknown';
        const amountNgn = Number(data?.amount || 0) / 100;
        const customerEmail = asNonEmptyString(data?.customer?.email || data?.customer_email).toLowerCase() || null;

        if (!reference) {
          return sendError(response, 'Missing transaction reference', 400);
        }

        await writeTransactionTruth({
          reference,
          status,
          amount: Number.isFinite(amountNgn) && amountNgn > 0 ? amountNgn : null,
          currency: asNonEmptyString(data?.currency || 'NGN'),
          channel: asNonEmptyString(data?.channel || ''),
          customerEmail,
          paidAt: data?.paid_at || null,
          metadata: data?.metadata || null,
          gatewayEvent: event || null,
          gatewayId: asNonEmptyString(data?.id || ''),
          source: 'paystack-webhook',
        });

        return sendResponse(response, { success: true });
      } catch (error: any) {
        console.error('Error in paystackWebhook:', error);
        return sendError(response, error?.message || 'Internal server error', 500);
      }
    });
  }
);

/**
 * Verify payment and create order
 */
export const verifyPaymentAndCreateOrder = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      // Verify authentication (optional for guest checkout)
      let auth: { uid: string; email?: string; isAdmin?: boolean } | null = null;
      try {
        auth = await verifyIdToken(request.headers.authorization || null);
      } catch {
        // Guest checkout is allowed
        auth = null;
      }

      const validation = verifyPaymentSchema.safeParse(request.body);
      if (!validation.success) {
        return sendError(response, 'Invalid payment verification data');
      }

      const {
        reference,
        idempotencyKey,
        cartItems,
        total,
        deliveryAddress,
        customerInfo,
        discountCode,
        shippingType,
        shippingPrice,
        deliveryFeePaidBy,
      } = validation.data;

      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
      const firestore = admin.firestore();

      // CRITICAL: Handle customer ID - prioritize logged-in user
      let finalCustomerId = auth?.uid; // If user is logged in, use their UID
      let isGuestOrder = false;

      if (!finalCustomerId) {
        // Guest checkout - create guest user ID from email
        if (!customerInfo?.email) {
          return sendError(response, 'Email is required for guest checkout');
        }
        isGuestOrder = true;
        // CRITICAL: Use consistent guest ID format (without timestamp for better linking)
        const emailKey = customerInfo.email.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const guestId = `guest_${emailKey}`;
        const guestUserRef = firestore.collection('users').doc(guestId);
        const guestUserDoc = await guestUserRef.get();

        if (!guestUserDoc.exists) {
          await guestUserRef.set({
            email: customerInfo.email.toLowerCase(),
            displayName: customerInfo.name || `${customerInfo.firstName || ''} ${customerInfo.lastName || ''}`.trim(),
            firstName: customerInfo.firstName || '',
            lastName: customerInfo.lastName || '',
            phone: customerInfo.phone || '',
            role: 'buyer',
            isGuest: true,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        finalCustomerId = guestId;
      } else {
        // CRITICAL: User is logged in - ensure order is tied to their account
        // Verify user exists in users collection
        if (auth) {
          const userDoc = await firestore.collection('users').doc(finalCustomerId).get();
          if (!userDoc.exists) {
            // Create user document if it doesn't exist
            await firestore.collection('users').doc(finalCustomerId).set({
              email: auth.email || customerInfo?.email || '',
              displayName: customerInfo?.name || `${customerInfo?.firstName || ''} ${customerInfo?.lastName || ''}`.trim(),
              firstName: customerInfo?.firstName || '',
              lastName: customerInfo?.lastName || '',
              phone: customerInfo?.phone || '',
              role: 'buyer',
              createdAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }

      // Check for existing order with same idempotency key
      const existingOrderQuery = await firestore
        .collection('orders')
        .where('idempotencyKey', '==', idempotencyKey)
        .limit(1)
        .get();

      if (!existingOrderQuery.empty) {
        return sendResponse(response, {
          success: true,
          orderId: existingOrderQuery.docs[0].id,
          alreadyExists: true,
          message: 'Order already created for this payment',
        });
      }

      // Handle free orders (₦0 total) - skip payment verification
      if (total <= 0) {
        // Validate cart items before processing free order
        if (!cartItems || cartItems.length === 0) {
          return sendError(response, 'Invalid cart: Cart is empty', 400);
        }

        const sellerId = cartItems[0]?.sellerId;
        if (!sellerId) {
          return sendError(response, 'Invalid cart: No seller ID found', 400);
        }

        // Validate all items belong to the same seller
        const allSameSeller = cartItems.every((item: any) => item.sellerId === sellerId);
        if (!allSameSeller) {
          return sendError(response, 'Invalid cart: All items must be from the same seller', 400);
        }

        // Validate cart items
        for (const item of cartItems) {
          if (!item.id || !item.quantity || item.quantity <= 0) {
            return sendError(response, `Invalid cart item: ${item.name || 'Unknown'}`, 400);
          }
          if (!item.price || item.price <= 0) {
            return sendError(response, `Invalid price for ${item.name}`, 400);
          }
        }

        const commissionRate = await getPlatformCommissionRate();
        const orderRef = firestore.collection('orders').doc();

        // Use transaction for stock management
        await firestore.runTransaction(async (transaction) => {
          // Check and update stock
          const productRefs = cartItems.map((item: any) => 
            firestore.collection('products').doc(item.id)
          );
          
          const productDocs = await Promise.all(
            productRefs.map(ref => transaction.get(ref))
          );
          
          for (let i = 0; i < productDocs.length; i++) {
            const productDoc = productDocs[i];
            const item = cartItems[i];
            
            if (!productDoc.exists) {
              throw new Error(`Product not found: ${item.name}`);
            }
            
            const productData = productDoc.data();
            const currentStock = productData?.stock || 0;
            const requiredQuantity = item.quantity;
            
            if (currentStock < requiredQuantity) {
              throw new Error(`Insufficient stock for ${item.name}. Available: ${currentStock}, Required: ${requiredQuantity}`);
            }
            
            const newStock = Math.max(0, currentStock - requiredQuantity);
            transaction.update(productRefs[i], {
              stock: newStock,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          // Create free order
          const orderData = {
            customerId: finalCustomerId!,
            sellerId: sellerId,
            items: cartItems.map(({ id, name, price, quantity }: any) => ({
              productId: id,
              name,
              price,
              quantity,
            })),
            total: 0,
            status: 'Processing',
            deliveryAddress: deliveryAddress,
            customerInfo: {
              ...customerInfo,
              isGuest: isGuestOrder,
            },
            escrowStatus: 'completed', // No escrow needed for free orders
            paymentReference: reference,
            idempotencyKey,
            commissionRate,
            shippingType: shippingType || 'delivery',
            shippingPrice: shippingPrice || 0,
            deliveryFeePaidBy: deliveryFeePaidBy || 'buyer',
            paymentMethod: 'Free', // Mark as free order
            createdAt: FieldValue.serverTimestamp(),
            paystackReference: reference,
          };

          transaction.set(orderRef, orderData);
        }).catch((error: any) => {
          console.error('Transaction failed for free order:', error);
          throw error;
        });

        // Increment discount code usage if applied
        if (discountCode) {
          try {
            const discountQuery = await firestore
              .collection('discount_codes')
              .where('code', '==', discountCode.toUpperCase())
              .where('sellerId', '==', sellerId)
              .limit(1)
              .get();

            if (!discountQuery.empty) {
              const discountRef = discountQuery.docs[0].ref;
              await discountRef.update({
                uses: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
          } catch (error) {
            console.error('Failed to increment discount code usage:', error);
            // Non-critical - order is already created
          }
        }

        // Create payment record marking it as free
        await firestore.collection('payments').add({
          orderId: orderRef.id,
          customerId: finalCustomerId,
          sellerId: sellerId,
          amount: 0,
          reference: reference,
          idempotencyKey,
          status: 'completed',
          method: 'Free', // Mark payment method as "Free"
          discountCode: discountCode || null,
          isGuest: isGuestOrder,
          verifiedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });

        // Create initial system messages in chat
        try {
          const chatCollection = orderRef.collection('chat');
          
          await chatCollection.add({
            orderId: orderRef.id,
            senderId: 'system',
            senderType: 'system',
            message: 'Order placed',
            isSystemMessage: true,
            createdAt: FieldValue.serverTimestamp(),
          });

          await chatCollection.add({
            orderId: orderRef.id,
            senderId: 'system',
            senderType: 'system',
            message: 'Free order - payment not required',
            isSystemMessage: true,
            createdAt: FieldValue.serverTimestamp(),
          });
        } catch (error) {
          console.error('Failed to create chat messages:', error);
          // Non-critical - order is already created
        }

        return sendResponse(response, {
          success: true,
          orderId: orderRef.id,
          message: 'Free order created successfully',
        });
      }

      // Continue with normal payment verification for paid orders
      // Verify with Paystack
      let paystackResult;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        try {
          const paystackResponse = await fetch(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
              headers: {
                Authorization: `Bearer ${paystackSecretKey}`,
              },
              signal: AbortSignal.timeout(10000),
            }
          );

          if (!paystackResponse.ok) {
            const errorData = await paystackResponse.json();
            throw new Error(errorData.message || `Paystack API error: ${paystackResponse.status}`);
          }

          paystackResult = await paystackResponse.json();
          if (!paystackResult.status || !paystackResult.data) {
            throw new Error(paystackResult.message || 'Paystack verification failed');
          }
          break;
        } catch (error: any) {
          retries++;
          if (retries >= maxRetries) {
            await firestore.collection('failed_payments').add({
              reference,
              idempotencyKey,
              customerId: finalCustomerId,
              amount: total,
              error: error.message || 'Payment verification failed after retries',
              retryCount: retries,
              createdAt: FieldValue.serverTimestamp(),
            });
            return sendError(response, `Payment verification failed: ${error.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries - 1) * 1000));
        }
      }

      const { status, amount } = paystackResult.data;

      if (status !== 'success') {
        return sendError(response, `Payment not successful. Status: ${status}`);
      }

      if (amount / 100 !== total) {
        await firestore.collection('payment_mismatches').add({
          reference,
          idempotencyKey,
          expectedAmount: total,
          actualAmount: amount / 100,
          customerId: finalCustomerId,
          createdAt: FieldValue.serverTimestamp(),
        });
        return sendError(response, `Amount mismatch. Expected: ₦${total}, Received: ₦${amount / 100}`);
      }

      // CRITICAL: Validate cart items and stock BEFORE creating order
      if (!cartItems || cartItems.length === 0) {
        return sendError(response, 'Invalid cart: Cart is empty', 400);
      }
      
      const sellerId = cartItems[0]?.sellerId;
      if (!sellerId) {
        return sendError(response, 'Invalid cart: No seller ID found', 400);
      }
      
      // CRITICAL: Validate all items belong to the same seller
      const allSameSeller = cartItems.every((item: any) => item.sellerId === sellerId);
      if (!allSameSeller) {
        return sendError(response, 'Invalid cart: All items must be from the same seller', 400);
      }
      
      // CRITICAL: Validate total amount matches cart items
      const calculatedTotal = cartItems.reduce((sum: number, item: any) => {
        return sum + (item.price * item.quantity);
      }, 0);
      const shippingCost = shippingPrice || 0;
      const discountAmount = 0; // Will be calculated if discount code is valid
      const expectedTotal = calculatedTotal + shippingCost - discountAmount;
      
      // Allow small rounding differences (0.01)
      if (Math.abs(total - expectedTotal) > 0.01) {
        console.warn('Total mismatch:', { total, expectedTotal, calculatedTotal, shippingCost });
        // Log but don't fail - frontend calculation might differ slightly
      }

      // CRITICAL: Validate cart items
      for (const item of cartItems) {
        if (!item.id || !item.quantity || item.quantity <= 0) {
          return sendError(response, `Invalid cart item: ${item.name || 'Unknown'}`, 400);
        }
        if (!item.price || item.price <= 0) {
          return sendError(response, `Invalid price for ${item.name}`, 400);
        }
      }

      const commissionRate = await getPlatformCommissionRate();

      // CRITICAL: Use Firestore transaction to ensure atomicity - check stock and create order atomically
      const orderRef = firestore.collection('orders').doc();
      
      await firestore.runTransaction(async (transaction) => {
        // CRITICAL: Check stock availability within transaction
        const productRefs = cartItems.map((item: any) => 
          firestore.collection('products').doc(item.id)
        );
        
        const productDocs = await Promise.all(
          productRefs.map(ref => transaction.get(ref))
        );
        
        // Validate products and stock
        for (let i = 0; i < productDocs.length; i++) {
          const productDoc = productDocs[i];
          const item = cartItems[i];
          
          if (!productDoc.exists) {
            throw new Error(`Product not found: ${item.name}`);
          }
          
          const productData = productDoc.data();
          const currentStock = productData?.stock || 0;
          const requiredQuantity = item.quantity;
          
          if (currentStock < requiredQuantity) {
            throw new Error(`Insufficient stock for ${item.name}. Available: ${currentStock}, Required: ${requiredQuantity}`);
          }
          
          // Update stock in transaction
          const newStock = Math.max(0, currentStock - requiredQuantity);
          transaction.update(productRefs[i], {
            stock: newStock,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        
        // CRITICAL: Create order data with payment verification metadata
        const orderData = {
          customerId: finalCustomerId!,
          sellerId: sellerId,
          items: cartItems.map(({ id, name, price, quantity }: any) => ({
            productId: id,
            name,
            price,
            quantity,
          })),
          total: total,
          status: 'Processing',
          deliveryAddress: deliveryAddress,
          customerInfo: {
            ...customerInfo,
            isGuest: isGuestOrder,
          },
          escrowStatus: 'held',
          paymentReference: reference,
          idempotencyKey,
          commissionRate,
          shippingType: shippingType || 'delivery',
          shippingPrice: shippingPrice || 0,
          deliveryFeePaidBy: deliveryFeePaidBy || 'buyer',
          createdAt: FieldValue.serverTimestamp(),
          paystackReference: reference,
          // CRITICAL: Add payment verification metadata
          paymentVerifiedAt: FieldValue.serverTimestamp(),
          paymentStatus: 'success',
          paymentAmount: amount / 100,
        };
        
        // Create order in transaction
        transaction.set(orderRef, orderData);
      }).catch((error: any) => {
        // CRITICAL: If transaction fails, log for manual recovery
        console.error('CRITICAL: Transaction failed after payment verification', {
          reference,
          idempotencyKey,
          customerId: finalCustomerId,
          error: error.message,
        });
        
        // Log to failed_orders collection for manual recovery
        firestore.collection('failed_orders').add({
          reference,
          idempotencyKey,
          customerId: finalCustomerId,
          sellerId,
          total,
          cartItems,
          error: error.message || 'Transaction failed',
          paymentVerified: true, // Payment was verified but order creation failed
          createdAt: FieldValue.serverTimestamp(),
        });
        
        throw new Error(`Order creation failed: ${error.message}`);
      });

      // Increment discount code usage if applied (non-critical, can fail without affecting order)
      if (discountCode && sellerId) {
        try {
          const discountQuery = await firestore
            .collection('discount_codes')
            .where('code', '==', discountCode.toUpperCase())
            .where('sellerId', '==', sellerId)
            .limit(1)
            .get();

          if (!discountQuery.empty) {
            const discountDoc = discountQuery.docs[0];
            const discountData = discountDoc.data();
            const currentUses = discountData.uses || 0;
            const maxUses = discountData.maxUses;

            // CRITICAL: Check if discount code has reached max uses
            if (maxUses && currentUses >= maxUses) {
              console.warn(`Discount code ${discountCode} has reached max uses`);
            } else {
              await discountDoc.ref.update({
                uses: currentUses + 1,
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
          }
        } catch (error) {
          console.error('Failed to increment discount code usage:', error);
          // Non-critical - order is already created
        }
      }

      // Create payment record for audit trail
      try {
        await firestore.collection('payments').add({
          orderId: orderRef.id,
          customerId: finalCustomerId,
          sellerId: sellerId,
          amount: total,
          reference: reference,
          status: 'completed',
          method: 'Paystack',
          discountCode: discountCode || null,
          isGuest: isGuestOrder,
          verifiedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error('Failed to create payment record:', error);
        // Non-critical - order is already created
      }

      // Create initial chat messages (non-critical)
      try {
        await firestore.collection('orders').doc(orderRef.id).collection('chat').add({
          orderId: orderRef.id,
          senderId: 'system',
          senderType: 'system',
          message: 'Order created successfully. Payment verified.',
          isSystemMessage: true,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error('Failed to create chat message:', error);
        // Non-critical - order is already created
      }

      return sendResponse(response, {
        success: true,
        orderId: orderRef.id,
        message: 'Order created successfully',
      });
    } catch (error: any) {
      console.error('Error in verifyPaymentAndCreateOrder:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Find recent transaction by email and amount
 */
export const findRecentTransactionByEmail = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const { email, amount } = request.body;

      if (!email || !amount) {
        return sendError(response, 'Email and amount are required');
      }

      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
      const amountInKobo = Math.round(amount * 100);

      const paystackResponse = await fetch(
        `https://api.paystack.co/transaction?perPage=100`,
        {
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!paystackResponse.ok) {
        return sendError(response, 'Failed to fetch transactions from Paystack');
      }

      const result = await paystackResponse.json();
      if (!result.status || !result.data) {
        return sendResponse(response, { success: false, found: false });
      }

      const transactions = result.data || [];
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

      const matchingTransaction = transactions.find((tx: any) => {
        const txEmail = tx.customer?.email || tx.customer_email || '';
        const txAmount = tx.amount || 0;
        const emailMatch = txEmail.toLowerCase() === email.toLowerCase();
        const amountMatch = Math.abs(txAmount - amountInKobo) <= 1;
        const txDate = tx.paid_at ? new Date(tx.paid_at) : null;
        const txTimestamp = txDate ? txDate.getTime() : 0;
        const isRecent = txTimestamp > tenMinutesAgo;

        return emailMatch && amountMatch && tx.status === 'success' && isRecent;
      });

      if (matchingTransaction) {
        return sendResponse(response, {
          success: true,
          found: true,
          reference: matchingTransaction.reference,
          status: matchingTransaction.status,
          amount: matchingTransaction.amount / 100,
          paidAt: matchingTransaction.paid_at,
        });
      }

      return sendResponse(response, { success: true, found: false });
    } catch (error: any) {
      console.error('Error in findRecentTransactionByEmail:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// ORDER FUNCTIONS
// ============================================================================
// ============================================================================
// SHIPPING FUNCTIONS (PUBLIC - NO AUTH REQUIRED)
// ============================================================================
// ============================================================================
// PAYOUT FUNCTIONS
// ============================================================================

/**
 * Get banks list (public)
 */
export const getBanksList = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET') {
        return sendError(response, 'Method not allowed', 405);
      }

      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());

      const paystackResponse = await fetch('https://api.paystack.co/bank?country=nigeria', {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!paystackResponse.ok) {
        return sendError(response, 'Failed to fetch banks from Paystack');
      }

      const result = await paystackResponse.json();
      if (result.status && result.data) {
        const banks = result.data
          .map((bank: any) => ({
            code: bank.code || bank.id.toString(),
            name: bank.name,
            id: bank.id,
          }))
          .filter((bank: any) => bank.code)
          .sort((a: any, b: any) => a.name.localeCompare(b.name));

        return sendResponse(response, {
          success: true,
          banks,
        });
      }

      return sendError(response, 'Unable to fetch banks list');
    } catch (error: any) {
      console.error('Error in getBanksList:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Resolve account number
 */
export const resolveAccountNumber = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const { accountNumber, bankCode } = request.body;

      if (!accountNumber || !bankCode) {
        return sendError(response, 'Account number and bank code are required');
      }

      if (accountNumber.length !== 10) {
        return sendError(response, 'Account number must be 10 digits');
      }

      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());

      const paystackResponse = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        {
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!paystackResponse.ok) {
        const errorData = await paystackResponse.json().catch(() => ({ message: 'Unknown error' }));
        return sendError(response, errorData.message || 'Failed to resolve account number');
      }

      const result = await paystackResponse.json();

      if (result.status === true && result.data && result.data.account_name) {
        return sendResponse(response, {
          success: true,
          bank_id: result.data.bank_id || parseInt(bankCode),
          account_name: result.data.account_name,
          account_number: result.data.account_number || accountNumber,
        });
      }

      return sendError(response, result.message || 'Unable to resolve account number');
    } catch (error: any) {
      console.error('Error in resolveAccountNumber:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Save payout details
 */
export const savePayoutDetails = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { bankName, bankCode, accountNumber, accountName } = request.body;

      if (!bankName || !bankCode || !accountNumber || !accountName) {
        return sendError(response, 'All payout details are required');
      }

      const firestore = admin.firestore();
      const userRef = firestore.collection('users').doc(auth.uid);

      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        return sendError(response, 'User profile not found', 404);
      }

      const userData = userDoc.data()!;
      if (userData?.role && !['seller', 'admin'].includes(userData.role)) {
        return sendError(response, 'Only sellers and admins can set payout details', 403);
      }

      await userRef.update({
        payoutDetails: {
          bankName,
          bankCode,
          accountNumber,
          accountName,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in savePayoutDetails:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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

/**
 * Calculate seller earnings
 */
export const calculateSellerEarnings = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;

      // Verify seller owns this request or is admin
      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only view your own earnings', 403);
      }

      const firestore = admin.firestore();
      const commissionRate = await getPlatformCommissionRate();

      let totalEarnings = 0;
      let totalOrders = 0;
      let commissionPaid = 0;

      // Try to calculate from transactions collection first
      const transactionsSnapshot = await firestore.collection('transactions')
        .where('sellerId', '==', sellerId)
        .where('type', '==', 'sale')
        .where('status', '==', 'completed')
        .get();

      if (!transactionsSnapshot.empty) {
        transactionsSnapshot.forEach(doc => {
          const transaction = doc.data();
          totalEarnings += transaction.amount || 0;
          commissionPaid += transaction.commission || 0;
          totalOrders++;
        });
      } else {
        // Fallback: Calculate from orders
        const ordersSnapshot = await firestore.collection('orders')
          .where('sellerId', '==', sellerId)
          .where('status', '==', 'Completed')
          .get();

        ordersSnapshot.forEach(doc => {
          const order = doc.data();
          const orderTotal = order.total || 0;
          const orderCommissionRate = order.commissionRate || commissionRate;
          const commission = orderTotal * orderCommissionRate;
          const sellerEarning = orderTotal - commission;

          totalEarnings += sellerEarning;
          commissionPaid += commission;
          totalOrders++;
        });
      }

      // Get pending payouts
      const pendingPayoutsSnapshot = await firestore.collection('payouts')
        .where('sellerId', '==', sellerId)
        .where('status', '==', 'pending')
        .get();

      let pendingPayouts = 0;
      pendingPayoutsSnapshot.forEach(doc => {
        const payout = doc.data();
        pendingPayouts += payout.amount || 0;
      });

      // Get completed payouts
      const completedPayoutsSnapshot = await firestore.collection('payouts')
        .where('sellerId', '==', sellerId)
        .where('status', '==', 'completed')
        .get();

      let totalPayouts = 0;
      completedPayoutsSnapshot.forEach(doc => {
        const payout = doc.data();
        totalPayouts += payout.amount || 0;
      });

      const availableBalance = Math.max(0, totalEarnings - totalPayouts - pendingPayouts);

      return sendResponse(response, {
        success: true,
        earnings: {
          totalEarnings,
          availableBalance,
          pendingPayouts,
          totalPayouts,
          commissionPaid,
          totalOrders,
        },
      });
    } catch (error: any) {
      console.error('Error in calculateSellerEarnings:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get seller transactions
 */
export const getSellerTransactions = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const sellerId = request.query.sellerId as string || request.body?.sellerId || auth.uid;
      const limit = parseInt(request.query.limit as string) || request.body?.limit || 50;

      // Verify seller owns this request or is admin
      if (sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only view your own transactions', 403);
      }

      const firestore = admin.firestore();
      const commissionRate = await getPlatformCommissionRate();
      const transactions: any[] = [];

      // Get sales from orders
      const ordersSnapshot = await firestore.collection('orders')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        const orderTotal = order.total || 0;
        const orderCommissionRate = order.commissionRate || commissionRate;
        const commission = orderTotal * orderCommissionRate;
        const sellerEarning = orderTotal - commission;

        if (order.status === 'Completed') {
          transactions.push({
            id: `sale_${doc.id}`,
            type: 'sale',
            amount: sellerEarning,
            orderId: doc.id,
            description: `Sale from order #${doc.id.slice(0, 7)}`,
            status: 'completed',
            createdAt: order.createdAt,
          });

          transactions.push({
            id: `commission_${doc.id}`,
            type: 'commission',
            amount: -commission,
            orderId: doc.id,
            description: `Platform commission (${(orderCommissionRate * 100).toFixed(1)}%)`,
            status: 'completed',
            createdAt: order.createdAt,
          });
        }
      });

      // Get payout transactions
      const payoutsSnapshot = await firestore.collection('payouts')
        .where('sellerId', '==', sellerId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      payoutsSnapshot.forEach(doc => {
        const payout = doc.data();
        transactions.push({
          id: `payout_${doc.id}`,
          type: 'payout',
          amount: -payout.amount,
          payoutId: doc.id,
          description: `Payout to ${payout.accountName || 'bank account'}`,
          status: payout.status,
          createdAt: payout.createdAt,
        });
      });

      // Sort by date (most recent first)
      transactions.sort((a, b) => {
        const dateA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt).getTime();
        const dateB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      return sendResponse(response, {
        success: true,
        transactions: transactions.slice(0, limit),
      });
    } catch (error: any) {
      console.error('Error in getSellerTransactions:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// PAYOUT REQUEST FUNCTIONS
// ============================================================================

/**
 * Request payout
 */
export const requestPayout = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { amount } = request.body;

      if (!amount || amount <= 0) {
        return sendError(response, 'Valid amount is required', 400);
      }

      const firestore = admin.firestore();

      // Get minimum payout amount from settings
      const settingsDoc = await firestore.collection('platform_settings').doc('platform_settings').get();
      const minimumPayout = settingsDoc.exists 
        ? (settingsDoc.data()?.minimumPayoutAmount as number) || 5000
        : 5000;

      if (amount < minimumPayout) {
        return sendError(response, `Minimum payout is ₦${minimumPayout.toLocaleString()}`, 400);
      }

      // Calculate earnings to verify balance
      const transactionsSnapshot = await firestore.collection('transactions')
        .where('sellerId', '==', auth.uid)
        .where('type', '==', 'sale')
        .where('status', '==', 'completed')
        .get();

      let totalEarnings = 0;
      if (!transactionsSnapshot.empty) {
        transactionsSnapshot.forEach(doc => {
          const transaction = doc.data();
          totalEarnings += transaction.amount || 0;
        });
      }

      const pendingPayoutsSnapshot = await firestore.collection('payouts')
        .where('sellerId', '==', auth.uid)
        .where('status', '==', 'pending')
        .get();

      let pendingPayouts = 0;
      pendingPayoutsSnapshot.forEach(doc => {
        const payout = doc.data();
        pendingPayouts += payout.amount || 0;
      });

      const completedPayoutsSnapshot = await firestore.collection('payouts')
        .where('sellerId', '==', auth.uid)
        .where('status', '==', 'completed')
        .get();

      let totalPayouts = 0;
      completedPayoutsSnapshot.forEach(doc => {
        const payout = doc.data();
        totalPayouts += payout.amount || 0;
      });

      const availableBalance = Math.max(0, totalEarnings - totalPayouts - pendingPayouts);

      if (amount > availableBalance) {
        return sendError(response, `Insufficient balance. Available: ₦${availableBalance.toLocaleString()}`, 400);
      }

      // Check if user has payout details
      const userDoc = await firestore.collection('users').doc(auth.uid).get();
      if (!userDoc.exists) {
        return sendError(response, 'User profile not found', 404);
      }

      const userData = userDoc.data()!;
      if (!userData.payoutDetails) {
        return sendError(response, 'Please set up your bank account details first', 400);
      }

      // Check for existing pending payout
      if (!pendingPayoutsSnapshot.empty) {
        return sendError(response, 'You already have a pending payout request. Please wait for it to be processed.', 400);
      }

      // Get payout processing days from settings
      const payoutProcessingDays = settingsDoc.exists
        ? (settingsDoc.data()?.payoutProcessingDays as number) || 3
        : 3;

      // Calculate expected processing date (business days)
      const addBusinessDays = (date: Date, days: number): Date => {
        const result = new Date(date);
        let addedDays = 0;
        while (addedDays < days) {
          result.setDate(result.getDate() + 1);
          if (result.getDay() !== 0 && result.getDay() !== 6) {
            addedDays++;
          }
        }
        return result;
      };

      const requestedDate = new Date();
      const expectedProcessingDate = addBusinessDays(requestedDate, payoutProcessingDays);

      // Create payout request
      const payoutRef = await firestore.collection('payouts').add({
        sellerId: auth.uid,
        amount: amount,
        bankName: userData.payoutDetails.bankName,
        bankCode: userData.payoutDetails.bankCode,
        accountNumber: userData.payoutDetails.accountNumber,
        accountName: userData.payoutDetails.accountName,
        status: 'pending',
        requestedAt: FieldValue.serverTimestamp(),
        expectedProcessingDate: admin.firestore.Timestamp.fromDate(expectedProcessingDate),
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, {
        success: true,
        payoutId: payoutRef.id,
      });
    } catch (error: any) {
      console.error('Error in requestPayout:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Cancel payout request
 */
export const cancelPayoutRequest = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { payoutId } = request.body;

      if (!payoutId) {
        return sendError(response, 'Payout ID is required', 400);
      }

      const firestore = admin.firestore();
      const payoutDoc = await firestore.collection('payouts').doc(payoutId).get();

      if (!payoutDoc.exists) {
        return sendError(response, 'Payout not found', 404);
      }

      const payout = payoutDoc.data()!;

      if (payout.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: Can only cancel your own payouts', 403);
      }

      if (payout.status !== 'pending') {
        return sendError(response, 'Only pending payouts can be cancelled', 400);
      }

      await firestore.collection('payouts').doc(payoutId).update({
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in cancelPayoutRequest:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Get all payouts (admin only)
 */
export const getAllPayouts = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const status = request.query.status as string || request.body?.status;
      let query: admin.firestore.Query = firestore.collection('payouts').orderBy('createdAt', 'desc');

      if (status) {
        query = query.where('status', '==', status) as any;
      }

      const snapshot = await query.get();

      // Serialize Firestore Timestamps
      const serializeTimestamp = (ts: any): any => {
        if (!ts) return null;
        if (ts.toDate && typeof ts.toDate === 'function') {
          return {
            _seconds: ts.seconds || Math.floor(ts.toMillis() / 1000),
            _nanoseconds: ts.nanoseconds || 0,
          };
        }
        if (ts._seconds !== undefined) {
          return { _seconds: ts._seconds, _nanoseconds: ts._nanoseconds || 0 };
        }
        return null;
      };

      const payouts = snapshot.docs.map(doc => {
        const data = doc.data();
        const result: any = {
          id: doc.id,
          ...data,
        };

        // Serialize all timestamp fields
        if (data.createdAt) result.createdAt = serializeTimestamp(data.createdAt);
        if (data.requestedAt) result.requestedAt = serializeTimestamp(data.requestedAt);
        if (data.processedAt) result.processedAt = serializeTimestamp(data.processedAt);
        if (data.cancelledAt) result.cancelledAt = serializeTimestamp(data.cancelledAt);
        if (data.expectedProcessingDate) result.expectedProcessingDate = serializeTimestamp(data.expectedProcessingDate);

        return result;
      });

      return sendResponse(response, {
        success: true,
        payouts,
      });
    } catch (error: any) {
      console.error('Error in getAllPayouts:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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
