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
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { onObjectFinalized } from 'firebase-functions/v2/storage';

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

const execFileAsync = promisify(execFile);

function safeTmpFile(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(os.tmpdir(), cleaned);
}

function parseMarketPostIdFromVideoPath(objectName: string): { ownerId: string | null; postId: string | null } {
  // Expected: marketPosts/{uid}/post_{postId}.mp4 (from mobile app)
  const normalized = String(objectName || '').trim();
  const parts = normalized.split('/');
  if (parts.length < 3) return { ownerId: null, postId: null };
  if (parts[0] !== 'marketPosts') return { ownerId: null, postId: null };
  const ownerId = parts[1] || null;
  const fileName = parts.slice(2).join('/');
  const match = fileName.match(/post_([a-zA-Z0-9_-]+)\./);
  const postId = match?.[1] ? String(match[1]).trim() : null;
  return { ownerId, postId };
}

async function ensureDirExists(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

/**
 * Storage trigger: when a Market Street video is uploaded, extract audio to an m4a file
 * and update:
 * - `marketSounds/{soundId}.sourceUri` to point to the extracted audio
 * - `marketPosts/{postId}.soundMeta.sourceUri` to match (for reuse/detail preview)
 *
 * This makes "Original sound" a real reusable audio asset while leaving feed playback
 * free to use the video’s own audio track.
 */
export const extractMarketSoundFromMarketVideo = onObjectFinalized(
  { cpu: 2, memory: '1GiB', timeoutSeconds: 300 },
  async (event) => {
    const objectName = String(event.data.name || '').trim();
    const contentType = String(event.data.contentType || '').trim().toLowerCase();
    if (!objectName) return;
    if (!contentType.startsWith('video/')) return;
    if (!objectName.startsWith('marketPosts/')) return;
    if (!objectName.includes('/post_')) return;

    const { ownerId, postId } = parseMarketPostIdFromVideoPath(objectName);
    if (!ownerId || !postId) return;

    const bucket = admin.storage().bucket(event.data.bucket);
    const firestore = admin.firestore();

    // Load post to find associated sound doc (created by client during publish)
    const postRef = firestore.collection('marketPosts').doc(postId);
    const postSnap = await postRef.get();
    if (!postSnap.exists) return;
    const postData = postSnap.data() || {};
    const soundId = String((postData as any)?.soundMeta?.soundId || '').trim();
    const soundType = String((postData as any)?.soundMeta?.sourceType || '').trim().toLowerCase();
    if (!soundId) return;
    if (soundType !== 'original') return;

    // Download video to tmp and extract audio with ffmpeg
    const ffmpegPath = require('ffmpeg-static') as string | null;
    if (!ffmpegPath) {
      console.error('ffmpeg-static not available; cannot extract audio');
      return;
    }

    const tmpDir = path.join(os.tmpdir(), `ikm_sound_${postId}`);
    await ensureDirExists(tmpDir);
    const tmpVideoPath = safeTmpFile(`market_post_${postId}.mp4`);
    const tmpAudioPath = safeTmpFile(`market_sound_${postId}.m4a`);

    try {
      await bucket.file(objectName).download({ destination: tmpVideoPath });

      // Extract audio track (AAC in m4a container) with a reasonable bitrate.
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i',
        tmpVideoPath,
        '-vn',
        '-acodec',
        'aac',
        '-b:a',
        '128k',
        tmpAudioPath,
      ]);

      const destPath = `marketSounds/${ownerId}/sound_${postId}.m4a`;
      await bucket.upload(tmpAudioPath, {
        destination: destPath,
        metadata: {
          contentType: 'audio/mp4',
          cacheControl: 'public,max-age=31536000',
        },
      });

      // Signed URL is not desired; use public download URL
      const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
        event.data.bucket
      )}/o/${encodeURIComponent(destPath)}?alt=media`;

      await firestore.runTransaction(async (tx) => {
        const soundRef = firestore.collection('marketSounds').doc(soundId);
        tx.set(
          soundRef,
          {
            sourceUri: audioUrl,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        tx.set(
          postRef,
          {
            soundMeta: {
              ...(postData as any).soundMeta,
              sourceUri: audioUrl,
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    } catch (error) {
      console.error('Failed to extract/upload market sound audio:', error);
    } finally {
      try {
        await fs.unlink(tmpVideoPath);
      } catch {}
      try {
        await fs.unlink(tmpAudioPath);
      } catch {}
    }
  }
);

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

/**
 * Send order message
 */
export const sendOrderMessage = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, message, imageUrl } = request.body;

      if (!orderId) {
        return sendError(response, 'Order ID is required');
      }

      if (!message && !imageUrl) {
        return sendError(response, 'Message or image is required');
      }

      const firestore = admin.firestore();
      const orderDoc = await firestore.collection('orders').doc(orderId).get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;
      if (order.customerId !== auth.uid && order.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: You do not have access to this order', 403);
      }

      const senderType = order.customerId === auth.uid ? 'customer' : 'seller';

      await firestore.collection('orders').doc(orderId).collection('chat').add({
        orderId,
        senderId: auth.uid,
        senderType,
        message: message || null,
        imageUrl: imageUrl || null,
        isSystemMessage: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in sendOrderMessage:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

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

function normalizeMarketHashtags(rawHashtags: unknown): string[] {
  if (!Array.isArray(rawHashtags)) {
    return [];
  }

  const uniqueTags = new Set<string>();

  for (const value of rawHashtags) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = value
      .trim()
      .replace(/^#/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');

    if (!normalized || normalized.length > 30) {
      continue;
    }

    uniqueTags.add(normalized);

    if (uniqueTags.size >= 10) {
      break;
    }
  }

  return Array.from(uniqueTags);
}

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

async function uploadMarketImage(
  imageDataUrl: string,
  destinationWithoutExt: string,
): Promise<string> {
  const { buffer, extension, contentType } = parseBase64Image(imageDataUrl);
  const storage = admin.storage();
  const bucket = storage.bucket();
  const filePath = `${destinationWithoutExt}.${extension}`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: 'public,max-age=31536000',
    },
  });
  await file.makePublic();

  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

async function adjustTrendingHashtags(hashtags: string[], delta: number): Promise<void> {
  if (!hashtags.length || delta === 0) {
    return;
  }

  const firestore = admin.firestore();

  await Promise.all(
    hashtags.map(async (tag) => {
      const ref = firestore.collection('trendingHashtags').doc(tag);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const existingCount = snapshot.exists ? (snapshot.data()?.count || 0) : 0;
        const nextCount = existingCount + delta;

        if (nextCount <= 0) {
          transaction.delete(ref);
          return;
        }

        const payload: Record<string, unknown> = {
          tag,
          count: nextCount,
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (!snapshot.exists) {
          payload.createdAt = FieldValue.serverTimestamp();
        }

        transaction.set(ref, payload, { merge: true });
      });
    }),
  );
}

async function deleteCollectionInBatches(
  baseQuery: admin.firestore.Query<admin.firestore.DocumentData>,
  batchSize: number = 400,
): Promise<void> {
  while (true) {
    const snapshot = await baseQuery.limit(batchSize).get();
    if (snapshot.empty) {
      return;
    }

    const batch = admin.firestore().batch();
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();

    if (snapshot.size < batchSize) {
      return;
    }
  }
}

/**
 * Create Market Post with image uploads
 */
export const createMarketPost = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const {
        images,
        hashtags,
        price,
        description,
        location,
        contactMethod,
      } = request.body || {};

      if (!Array.isArray(images) || images.length < 1 || images.length > 20) {
        return sendError(response, 'Images are required (1-20 images)', 400);
      }

      const cleanDescription =
        typeof description === 'string' ? description.trim() : '';
      if (cleanDescription.length > 1000) {
        return sendError(response, 'Description is too long (max 1000 characters)', 400);
      }

      let cleanPrice: number | undefined;
      if (price !== undefined && price !== null && price !== '') {
        const parsedPrice = Number(price);
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
          return sendError(response, 'Price must be a positive number', 400);
        }
        cleanPrice = parsedPrice;
      }

      const cleanContactMethod =
        contactMethod === 'whatsapp' ? 'whatsapp' : 'in-app';

      let cleanLocation: { state?: string; city?: string } | undefined;
      if (location && typeof location === 'object') {
        const rawState = typeof location.state === 'string' ? location.state.trim() : '';
        const rawCity = typeof location.city === 'string' ? location.city.trim() : '';
        cleanLocation = {};
        if (rawState) cleanLocation.state = rawState;
        if (rawCity) cleanLocation.city = rawCity;
        if (!cleanLocation.state && !cleanLocation.city) {
          cleanLocation = undefined;
        }
      }

      const normalizedHashtags = normalizeMarketHashtags(hashtags);
      const postRef = firestore.collection('marketPosts').doc();

      const uploadedImages = await Promise.all(
        images.map(async (image: unknown, index: number) => {
          if (typeof image !== 'string' || !image.startsWith('data:image/')) {
            throw new Error(`Invalid image at position ${index + 1}`);
          }

          const destination = `marketPosts/${postRef.id}/${Date.now()}_${index + 1}`;
          return uploadMarketImage(image, destination);
        }),
      );

      const postPayload: Record<string, unknown> = {
        posterId: auth.uid,
        images: uploadedImages,
        hashtags: normalizedHashtags,
        contactMethod: cleanContactMethod,
        likes: 0,
        views: 0,
        comments: 0,
        likedBy: [],
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (cleanPrice !== undefined) {
        postPayload.price = cleanPrice;
      }
      if (cleanDescription) {
        postPayload.description = cleanDescription;
      }
      if (cleanLocation) {
        postPayload.location = cleanLocation;
      }

      await postRef.set(postPayload);

      if (normalizedHashtags.length) {
        await adjustTrendingHashtags(normalizedHashtags, 1);
      }

      const createdPostDoc = await postRef.get();

      return sendResponse(response, {
        success: true,
        postId: postRef.id,
        post: {
          id: postRef.id,
          ...createdPostDoc.data(),
        },
      });
    } catch (error: any) {
      console.error('Error in createMarketPost:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Like or unlike a Market Post
 */
export const likeMarketPost = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { postId } = request.body || {};
      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      let likes = 0;
      let isLiked = false;

      await firestore.runTransaction(async (transaction) => {
        const postDoc = await transaction.get(postRef);
        if (!postDoc.exists) {
          throw new Error('Post not found');
        }

        const postData = postDoc.data() || {};
        const currentLikedBy = Array.isArray(postData.likedBy)
          ? postData.likedBy.filter((id): id is string => typeof id === 'string')
          : [];
        const currentLikes = typeof postData.likes === 'number' ? postData.likes : 0;

        if (currentLikedBy.includes(auth.uid)) {
          const nextLikedBy = currentLikedBy.filter((id) => id !== auth.uid);
          likes = Math.max(0, currentLikes - 1);
          isLiked = false;
          transaction.update(postRef, {
            likedBy: nextLikedBy,
            likes,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        likes = currentLikes + 1;
        isLiked = true;
        transaction.update(postRef, {
          likedBy: [...currentLikedBy, auth.uid],
          likes,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      return sendResponse(response, {
        success: true,
        likes,
        isLiked,
      });
    } catch (error: any) {
      console.error('Error in likeMarketPost:', error);
      const statusCode = error.message === 'Post not found' ? 404 : 500;
      return sendError(response, error.message || 'Internal server error', statusCode);
    }
  });
});

/**
 * Delete Market Post (poster or admin only)
 */
export const deleteMarketPost = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { postId } = request.body || {};
      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return sendError(response, 'Post not found', 404);
      }

      const postData = postDoc.data() || {};
      const posterId = typeof postData.posterId === 'string' ? postData.posterId : '';
      if (!posterId) {
        return sendError(response, 'Invalid post owner', 400);
      }

      if (posterId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Forbidden: You can only delete your own posts', 403);
      }

      const hashtags = Array.isArray(postData.hashtags)
        ? normalizeMarketHashtags(postData.hashtags)
        : [];

      await deleteCollectionInBatches(
        firestore.collection('marketPostComments').where('postId', '==', postId),
      );

      const chatSnapshot = await firestore
        .collection('marketChats')
        .where('postId', '==', postId)
        .get();

      for (const chatDoc of chatSnapshot.docs) {
        await deleteCollectionInBatches(chatDoc.ref.collection('messages'));
        await chatDoc.ref.delete();

        try {
          await admin.storage().bucket().deleteFiles({
            prefix: `marketMessages/${chatDoc.id}/`,
          });
        } catch (error) {
          console.warn(`Failed to delete chat images for ${chatDoc.id}:`, error);
        }
      }

      try {
        await admin.storage().bucket().deleteFiles({ prefix: `marketPosts/${postId}/` });
      } catch (error) {
        console.warn(`Failed to delete post images for ${postId}:`, error);
      }

      await postRef.delete();

      if (hashtags.length) {
        await adjustTrendingHashtags(hashtags, -1);
      }

      return sendResponse(response, {
        success: true,
        message: 'Post deleted successfully',
      });
    } catch (error: any) {
      console.error('Error in deleteMarketPost:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Increment post views (public endpoint)
 */
export const incrementPostViews = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const { postId } = request.body || {};
      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return sendError(response, 'Post not found', 404);
      }

      await postRef.update({
        views: FieldValue.increment(1),
      });

      return sendResponse(response, {
        success: true,
        message: 'Views incremented',
      });
    } catch (error: any) {
      console.error('Error in incrementPostViews:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create Market Comment
 */
export const createMarketComment = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { postId, comment } = request.body || {};

      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const cleanComment = typeof comment === 'string' ? comment.trim() : '';
      if (!cleanComment) {
        return sendError(response, 'Comment cannot be empty', 400);
      }
      if (cleanComment.length > 500) {
        return sendError(response, 'Comment is too long (max 500 characters)', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      const commentRef = firestore.collection('marketPostComments').doc();

      await firestore.runTransaction(async (transaction) => {
        const postDoc = await transaction.get(postRef);
        if (!postDoc.exists) {
          throw new Error('Post not found');
        }

        transaction.set(commentRef, {
          postId,
          userId: auth.uid,
          comment: cleanComment,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.update(postRef, {
          comments: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      return sendResponse(response, {
        success: true,
        commentId: commentRef.id,
        message: 'Comment added successfully',
      });
    } catch (error: any) {
      console.error('Error in createMarketComment:', error);
      const statusCode = error.message === 'Post not found' ? 404 : 500;
      return sendError(response, error.message || 'Internal server error', statusCode);
    }
  });
});

/**
 * Delete Market Comment
 */
export const deleteMarketComment = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { commentId } = request.body || {};

      if (!commentId || typeof commentId !== 'string') {
        return sendError(response, 'Comment ID is required', 400);
      }

      const firestore = admin.firestore();
      const commentRef = firestore.collection('marketPostComments').doc(commentId);

      await firestore.runTransaction(async (transaction) => {
        const commentDoc = await transaction.get(commentRef);
        if (!commentDoc.exists) {
          throw new Error('Comment not found');
        }

        const commentData = commentDoc.data() || {};
        const commentOwnerId =
          typeof commentData.userId === 'string' ? commentData.userId : '';

        if (!commentOwnerId) {
          throw new Error('Invalid comment owner');
        }

        if (commentOwnerId !== auth.uid && !auth.isAdmin) {
          throw new Error('Forbidden: You can only delete your own comments');
        }

        const postId = typeof commentData.postId === 'string' ? commentData.postId : '';
        if (!postId) {
          throw new Error('Invalid post reference');
        }

        const postRef = firestore.collection('marketPosts').doc(postId);
        const postDoc = await transaction.get(postRef);
        const currentComments = postDoc.exists && typeof postDoc.data()?.comments === 'number'
          ? postDoc.data()!.comments
          : 0;

        transaction.delete(commentRef);

        if (postDoc.exists) {
          transaction.update(postRef, {
            comments: Math.max(0, currentComments - 1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      return sendResponse(response, {
        success: true,
        message: 'Comment deleted successfully',
      });
    } catch (error: any) {
      console.error('Error in deleteMarketComment:', error);
      if (error.message === 'Comment not found') {
        return sendError(response, error.message, 404);
      }
      if (error.message?.startsWith('Forbidden')) {
        return sendError(response, error.message, 403);
      }
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create or fetch Market Chat
 */
export const createMarketChat = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { buyerId, posterId, postId } = request.body || {};

      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postDoc = await firestore.collection('marketPosts').doc(postId).get();
      if (!postDoc.exists) {
        return sendError(response, 'Post not found', 404);
      }

      const postData = postDoc.data() || {};
      const finalPosterId =
        typeof posterId === 'string' && posterId.trim()
          ? posterId.trim()
          : (typeof postData.posterId === 'string' ? postData.posterId : '');
      const finalBuyerId =
        typeof buyerId === 'string' && buyerId.trim()
          ? buyerId.trim()
          : auth.uid;

      if (!finalPosterId || !finalBuyerId) {
        return sendError(response, 'Invalid chat participants', 400);
      }

      if (finalPosterId === finalBuyerId) {
        return sendError(response, 'Cannot create chat with yourself', 400);
      }

      if (auth.uid !== finalBuyerId && auth.uid !== finalPosterId) {
        return sendError(response, 'Forbidden: You are not a participant', 403);
      }

      const chatId = `${finalBuyerId}_${finalPosterId}_${postId}`;
      const chatRef = firestore.collection('marketChats').doc(chatId);
      const existingChatDoc = await chatRef.get();

      if (existingChatDoc.exists) {
        return sendResponse(response, {
          success: true,
          chatId,
          chat: {
            id: chatId,
            ...existingChatDoc.data(),
          },
        });
      }

      const posterUserDoc = await firestore.collection('users').doc(finalPosterId).get();
      const posterUserData = posterUserDoc.data() || {};
      const posterName =
        (typeof posterUserData.storeName === 'string' && posterUserData.storeName) ||
        (typeof posterUserData.displayName === 'string' && posterUserData.displayName) ||
        'Seller';

      await chatRef.set({
        chatId,
        postId,
        buyerId: finalBuyerId,
        posterId: finalPosterId,
        participants: [finalBuyerId, finalPosterId],
        posterName,
        lastMessage: '',
        lastMessageAt: null,
        unreadCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const createdChatDoc = await chatRef.get();

      return sendResponse(response, {
        success: true,
        chatId,
        chat: {
          id: chatId,
          ...createdChatDoc.data(),
        },
      });
    } catch (error: any) {
      console.error('Error in createMarketChat:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Send Market Message
 */
export const sendMarketMessage = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const {
        chatId,
        message,
        imageUrl,
        paymentLink,
      } = request.body || {};

      if (!chatId || typeof chatId !== 'string') {
        return sendError(response, 'Chat ID is required', 400);
      }

      const cleanMessage = typeof message === 'string' ? message.trim() : '';
      const cleanImage = typeof imageUrl === 'string' ? imageUrl.trim() : '';
      const cleanPaymentLink = typeof paymentLink === 'string' ? paymentLink.trim() : '';

      if (!cleanMessage && !cleanImage) {
        return sendError(response, 'Message or image is required', 400);
      }

      if (cleanMessage.length > 1000) {
        return sendError(response, 'Message is too long (max 1000 characters)', 400);
      }

      let normalizedPaymentLink: string | undefined;
      if (cleanPaymentLink) {
        try {
          const parsed = new URL(cleanPaymentLink);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return sendError(response, 'Invalid payment link URL', 400);
          }
          normalizedPaymentLink = cleanPaymentLink;
        } catch {
          return sendError(response, 'Invalid payment link URL', 400);
        }
      }

      const firestore = admin.firestore();
      const chatRef = firestore.collection('marketChats').doc(chatId);
      let chatDoc = await chatRef.get();

      if (!chatDoc.exists) {
        const segments = chatId.split('_').filter(Boolean);
        let inferredBuyerId = auth.uid;
        let inferredPosterId = '';
        let inferredPostId = '';

        if (segments.length >= 3) {
          inferredBuyerId = segments[0];
          inferredPosterId = segments[1];
          inferredPostId = segments.slice(2).join('_');
        } else if (segments.length === 2) {
          inferredPosterId = segments[0];
          inferredPostId = segments[1];
        } else {
          return sendError(response, 'Chat not found', 404);
        }

        if (!inferredPostId || !inferredPosterId) {
          return sendError(response, 'Invalid chat metadata', 400);
        }

        if (auth.uid !== inferredBuyerId && auth.uid !== inferredPosterId) {
          inferredBuyerId = auth.uid;
        }

        const participants = Array.from(new Set([inferredBuyerId, inferredPosterId]));
        if (participants.length < 2) {
          return sendError(response, 'Invalid chat participants', 400);
        }

        const postDoc = await firestore.collection('marketPosts').doc(inferredPostId).get();
        if (!postDoc.exists) {
          return sendError(response, 'Related post not found', 404);
        }

        await chatRef.set({
          chatId,
          postId: inferredPostId,
          buyerId: inferredBuyerId,
          posterId: inferredPosterId,
          participants,
          lastMessage: '',
          lastMessageAt: null,
          unreadCount: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        chatDoc = await chatRef.get();
      }

      const chatData = chatDoc.data() || {};
      const participants = Array.isArray(chatData.participants)
        ? chatData.participants.filter((id): id is string => typeof id === 'string')
        : [];

      if (!participants.includes(auth.uid)) {
        return sendError(response, 'Forbidden: You are not part of this chat', 403);
      }

      const receiverId = participants.find((id) => id !== auth.uid);
      if (!receiverId) {
        return sendError(response, 'Invalid chat participants', 400);
      }

      const postId = typeof chatData.postId === 'string' ? chatData.postId : '';
      if (!postId) {
        return sendError(response, 'Invalid chat post reference', 400);
      }

      const messageRef = chatRef.collection('messages').doc();
      let uploadedImageUrl: string | undefined;

      if (cleanImage) {
        if (cleanImage.startsWith('data:image/')) {
          uploadedImageUrl = await uploadMarketImage(
            cleanImage,
            `marketMessages/${chatRef.id}/${messageRef.id}_image`,
          );
        } else {
          uploadedImageUrl = cleanImage;
        }
      }

      const messagePayload: Record<string, unknown> = {
        chatId: chatRef.id,
        senderId: auth.uid,
        receiverId,
        postId,
        message: cleanMessage,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      };

      if (uploadedImageUrl) {
        messagePayload.imageUrl = uploadedImageUrl;
      }
      if (normalizedPaymentLink) {
        messagePayload.paymentLink = normalizedPaymentLink;
      }

      await messageRef.set(messagePayload);

      await chatRef.set({
        lastMessage: cleanMessage || (uploadedImageUrl ? 'Image' : 'Message'),
        lastMessageAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return sendResponse(response, {
        success: true,
        messageId: messageRef.id,
        message: 'Message sent successfully',
      });
    } catch (error: any) {
      console.error('Error in sendMarketMessage:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// KEEP HELLO WORLD FOR TESTING
// ============================================================================

export const helloWorld = functions.https.onRequest((request, response) => {
  response.json({ message: 'Hello from Cloud Functions! 🎉' });
});

// Force redeploy to pick up config changes
