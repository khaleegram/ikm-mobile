import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import cors = require('cors');
import crypto from 'crypto';
import {
    getPaystackSecretKey,
    requireAdmin,
    requireAuth,
    sendError,
    sendResponse,
    verifyIdToken,
    getPlatformCommissionRate,
} from './utils';

// CORS configuration - allow all origins for mobile/web apps
const corsHandler = cors({ origin: true });

// Define Firebase Secret for Paystack
const paystackSecret = defineSecret('PAYSTACK_SECRET_KEY');

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
              // Preserve client market source/delivery fields; only fill gaps.
              source: String((metadata as any)?.source || 'ikm-mobile'),
              firebaseUid: auth.uid,
              buyerId: String((metadata as any)?.buyerId || auth.uid),
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        const payload: any = await paystackResponse.json().catch(() => ({}));
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

        const payload: any = await paystackResponse.json().catch(() => ({}));
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
 */
export const paystackWebhook = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
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

        // Refund lifecycle webhooks
        if (event.startsWith('refund.')) {
          try {
            const { handleRefundWebhookEvent } = await import('./refunds.js');
            await handleRefundWebhookEvent(event, data);
          } catch (refundErr) {
            console.error('Refund webhook handling failed:', refundErr);
          }
          return sendResponse(response, { success: true, handled: event });
        }

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

        // Money safety net: if charge succeeded, create the market order even when the
        // client crashed before finalize. Uses payment_sessions + Paystack metadata.
        if (
          (event === 'charge.success' || status === 'success') &&
          status === 'success'
        ) {
          try {
            await tryAutoFinalizeMarketEscrowFromWebhook({
              reference,
              amountNgn,
              customerEmail,
              metadata: data?.metadata || {},
            });
          } catch (autoFinalizeError) {
            console.error(
              'Webhook market auto-finalize failed (truth saved; client can still recover):',
              reference,
              autoFinalizeError
            );
          }
        }

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

      let auth: { uid: string; email?: string; isAdmin?: boolean } | null = null;
      try {
        auth = await verifyIdToken(request.headers.authorization || null);
      } catch {
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
        shippingType,
        shippingPrice,
        deliveryFeePaidBy,
      } = validation.data;

      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
      const firestore = admin.firestore();

      let finalCustomerId = auth?.uid;
      let isGuestOrder = false;

      if (!finalCustomerId) {
        if (!customerInfo?.email) {
          return sendError(response, 'Email is required for guest checkout');
        }
        isGuestOrder = true;
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
        if (auth) {
          const userDoc = await firestore.collection('users').doc(finalCustomerId).get();
          if (!userDoc.exists) {
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

      // Handle free orders (₦0 total)
      if (total <= 0) {
        if (!cartItems || cartItems.length === 0) {
          return sendError(response, 'Invalid cart: Cart is empty', 400);
        }
        const sellerId = cartItems[0]?.sellerId;
        const allSameSeller = cartItems.every((item: any) => item.sellerId === sellerId);
        if (!allSameSeller) {
          return sendError(response, 'Invalid cart: All items must be from the same seller', 400);
        }
        
        const orderRef = firestore.collection('orders').doc();
        await firestore.runTransaction(async (transaction) => {
          const productRefs = cartItems.map((item: any) => firestore.collection('products').doc(item.id));
          const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));
          
          for (let i = 0; i < productDocs.length; i++) {
            const productDoc = productDocs[i];
            const item = cartItems[i];
            if (!productDoc.exists) throw new Error(`Product not found: ${item.name}`);
            const currentStock = productDoc.data()?.stock || 0;
            if (currentStock < item.quantity) throw new Error(`Insufficient stock for ${item.name}`);
            transaction.update(productRefs[i], { stock: currentStock - item.quantity, updatedAt: FieldValue.serverTimestamp() });
          }

          transaction.set(orderRef, {
            customerId: finalCustomerId!,
            sellerId,
            items: cartItems.map(({ id, name, price, quantity }: any) => ({ productId: id, name, price, quantity })),
            total: 0,
            status: 'Paid',
            deliveryAddress,
            customerInfo: { ...customerInfo, isGuest: isGuestOrder },
            escrowStatus: 'completed',
            paymentReference: reference,
            idempotencyKey,
            shippingType: shippingType || 'delivery',
            shippingPrice: shippingPrice || 0,
            deliveryFeePaidBy: deliveryFeePaidBy || 'buyer',
            paymentMethod: 'Free',
            createdAt: FieldValue.serverTimestamp(),
            paymentVerifiedAt: FieldValue.serverTimestamp(),
            sellerUnreadCount: 0,
            buyerUnreadCount: 0,
          });
        });

        return sendResponse(response, { success: true, orderId: orderRef.id, message: 'Free order created successfully' });
      }

      // Paid orders
      const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
        signal: AbortSignal.timeout(10000),
      });

      const paystackResult: any = await paystackResponse.json();
      if (!paystackResult.status || paystackResult.data.status !== 'success') {
        return sendError(response, 'Payment verification failed');
      }

      if (paystackResult.data.amount / 100 !== total) {
        return sendError(response, 'Amount mismatch');
      }

      const sellerId = cartItems[0]?.sellerId;
      const orderRef = firestore.collection('orders').doc();
      
      await firestore.runTransaction(async (transaction) => {
        const productRefs = cartItems.map((item: any) => firestore.collection('products').doc(item.id));
        const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));
        
        for (let i = 0; i < productDocs.length; i++) {
          const productDoc = productDocs[i];
          const item = cartItems[i];
          if (!productDoc.exists) throw new Error(`Product not found: ${item.name}`);
          const currentStock = productDoc.data()?.stock || 0;
          if (currentStock < item.quantity) throw new Error(`Insufficient stock for ${item.name}`);
          transaction.update(productRefs[i], { stock: currentStock - item.quantity, updatedAt: FieldValue.serverTimestamp() });
        }

        transaction.set(orderRef, {
          customerId: finalCustomerId!,
          sellerId,
          items: cartItems.map(({ id, name, price, quantity }: any) => ({ productId: id, name, price, quantity })),
          total,
          status: 'Paid',
          deliveryAddress,
          customerInfo: { ...customerInfo, isGuest: isGuestOrder },
          escrowStatus: 'held',
          paymentReference: reference,
          idempotencyKey,
          shippingType: shippingType || 'delivery',
          shippingPrice: shippingPrice || 0,
          deliveryFeePaidBy: deliveryFeePaidBy || 'buyer',
          paymentMethod: 'Paystack',
          createdAt: FieldValue.serverTimestamp(),
          paymentVerifiedAt: FieldValue.serverTimestamp(),
          sellerUnreadCount: 0,
          buyerUnreadCount: 0,
        });
      });

      const orderSummary = cartItems[0]?.name + (cartItems.length > 1 ? ` +${cartItems.length - 1} more` : '');

      import('./notifications.js').then((mod) => {
        mod.notifyBuyer({
          buyerId: finalCustomerId!,
          event: 'payment_success',
          orderId: orderRef.id,
          orderSummary: `${orderSummary} — NGN ${Number(total).toLocaleString()}`,
        }).catch((e: any) => console.error('Failed to notify buyer:', e));

        mod.notifySeller({
          sellerId,
          event: 'new_order',
          orderId: orderRef.id,
          orderSummary: `${orderSummary} — NGN ${Number(total).toLocaleString()}`,
        }).catch((e: any) => console.error('Failed to notify seller:', e));
      }).catch(() => {});

      import('./order-chat.js').then((mod) => {
        mod.createSystemMessage({
          orderId: orderRef.id,
          event: 'order_paid',
          customText: `Order confirmed. Payment of NGN ${Number(total).toLocaleString()} received.`,
        }).catch((e: any) => console.error('Failed to create system message:', e));

        mod.createOrderTimelineEvent({
          orderId: orderRef.id,
          event: 'order_paid',
          status: 'Paid',
          text: 'Payment verified',
          actorId: finalCustomerId!,
          actorRole: 'buyer',
        }).catch((e: any) => console.error('Failed to create timeline event:', e));
      }).catch(() => {});

      return sendResponse(response, { success: true, orderId: orderRef.id, message: 'Order created successfully' });
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

      const paystackResponse = await fetch('https://api.paystack.co/transaction?perPage=100', {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!paystackResponse.ok) {
        return sendError(response, 'Failed to fetch transactions from Paystack');
      }

      const result: any = await paystackResponse.json();
      const transactions = result.data || [];
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

      const matchingTransaction = transactions.find((tx: any) => {
        const txEmail = (tx.customer?.email || tx.customer_email || '').toLowerCase();
        const txAmount = tx.amount || 0;
        const txTimestamp = tx.paid_at ? new Date(tx.paid_at).getTime() : 0;
        return txEmail === email.toLowerCase() && Math.abs(txAmount - amountInKobo) <= 1 && tx.status === 'success' && txTimestamp > tenMinutesAgo;
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

/**
 * Get banks list
 */
export const getBanksList = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }
      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
      const paystackResponse = await fetch('https://api.paystack.co/bank?country=nigeria', {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
      });

      if (!paystackResponse.ok) return sendError(response, 'Failed to fetch banks');
      const result: any = await paystackResponse.json();
      const banks = (result.data || []).map((bank: any) => ({ code: bank.code, name: bank.name, id: bank.id }));
      return sendResponse(response, { success: true, banks: banks.sort((a: any, b: any) => a.name.localeCompare(b.name)) });
    } catch (error: any) {
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
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      const { accountNumber, bankCode } = request.body;
      if (!accountNumber || !bankCode) return sendError(response, 'Account number and bank code are required');
      
      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
      const paystackResponse = await fetch(`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`, {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
      });

      if (!paystackResponse.ok) return sendError(response, 'Failed to resolve account number');
      const result: any = await paystackResponse.json();
      return sendResponse(response, { success: true, account_name: result.data.account_name, account_number: result.data.account_number });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Save payout details
 */
export const savePayoutDetails = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      const auth = await requireAuth(request.headers.authorization || null);
      const { bankName, bankCode, accountNumber, accountName } = request.body;
      
      await admin.firestore().collection('users').doc(auth.uid).update({
        payoutDetails: { bankName, bankCode, accountNumber, accountName },
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Request payout
 */
export const requestPayout = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      const auth = await requireAuth(request.headers.authorization || null);
      const { amount } = request.body;
      if (!amount || amount <= 0) return sendError(response, 'Valid amount is required', 400);

      const firestore = admin.firestore();

      // Check if user has payout details first
      const userDoc = await firestore.collection('users').doc(auth.uid).get();
      if (!userDoc.exists) {
        return sendError(response, 'User profile not found', 404);
      }
      const userData = userDoc.data()!;
      if (!userData.payoutDetails) {
        return sendError(response, 'Please set up your bank account details first', 400);
      }

      // Check for minimum payout amount from settings
      const settingsDoc = await firestore.collection('platform_settings').doc('platform_settings').get();
      const minimumPayout = settingsDoc.exists 
        ? (settingsDoc.data()?.minimumPayoutAmount as number) || 5000
        : 5000;

      if (amount < minimumPayout) {
        return sendError(response, `Minimum payout is ₦${minimumPayout.toLocaleString()}`, 400);
      }

      // Check for existing pending payout request to prevent double-draw
      const pendingPayoutsSnapshot = await firestore.collection('payouts')
        .where('sellerId', '==', auth.uid)
        .where('status', '==', 'pending')
        .get();

      if (!pendingPayoutsSnapshot.empty) {
        return sendError(response, 'You already have a pending payout request. Please wait for it to be processed.', 400);
      }

      // Calculate earnings server-side to verify balance
      let totalEarnings = 0;
      const transactionsSnapshot = await firestore.collection('transactions')
        .where('sellerId', '==', auth.uid)
        .where('type', '==', 'sale')
        .where('status', '==', 'completed')
        .get();

      if (!transactionsSnapshot.empty) {
        transactionsSnapshot.forEach(doc => {
          totalEarnings += doc.data().amount || 0;
        });
      } else {
        // Fallback: calculate from completed orders
        const ordersSnapshot = await firestore.collection('orders')
          .where('sellerId', '==', auth.uid)
          .where('status', '==', 'Completed')
          .get();
        const commissionRate = await getPlatformCommissionRate();
        ordersSnapshot.forEach(doc => {
          const order = doc.data();
          const orderTotal = order.total || 0;
          const orderCommissionRate = order.commissionRate || commissionRate;
          const commission = orderTotal * orderCommissionRate;
          totalEarnings += (orderTotal - commission);
        });
      }

      const completedPayoutsSnapshot = await firestore.collection('payouts')
        .where('sellerId', '==', auth.uid)
        .where('status', '==', 'completed')
        .get();

      let totalPayouts = 0;
      completedPayoutsSnapshot.forEach(doc => {
        totalPayouts += doc.data().amount || 0;
      });

      // Sum any currently pending payouts (already fetched)
      let pendingPayoutsSum = 0;
      pendingPayoutsSnapshot.forEach(doc => {
        pendingPayoutsSum += doc.data().amount || 0;
      });

      const availableBalance = Math.max(0, totalEarnings - totalPayouts - pendingPayoutsSum);

      if (amount > availableBalance) {
        return sendError(response, `Insufficient balance. Available: ₦${availableBalance.toLocaleString()}`, 400);
      }

      // Calculate expected processing date (business days)
      const payoutProcessingDays = settingsDoc.exists
        ? (settingsDoc.data()?.payoutProcessingDays as number) || 3
        : 3;

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

      const expectedProcessingDate = addBusinessDays(new Date(), payoutProcessingDays);

      await firestore.collection('payouts').add({
        sellerId: auth.uid,
        amount,
        bankName: userData.payoutDetails.bankName,
        bankCode: userData.payoutDetails.bankCode,
        accountNumber: userData.payoutDetails.accountNumber,
        accountName: userData.payoutDetails.accountName,
        status: 'pending',
        requestedAt: FieldValue.serverTimestamp(),
        expectedProcessingDate: admin.firestore.Timestamp.fromDate(expectedProcessingDate),
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Cancel payout request
 */
export const cancelPayoutRequest = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      await requireAuth(request.headers.authorization || null);
      const { payoutId } = request.body;
      await admin.firestore().collection('payouts').doc(payoutId).update({ status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });
      return sendResponse(response, { success: true });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get all payouts (admin only)
 */
export const getAllPayouts = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAdmin(request.headers.authorization || null);
      const firestore = admin.firestore();

      const status = (request.query.status as string) || request.body?.status;
      let query: admin.firestore.Query = firestore.collection('payouts').orderBy('createdAt', 'desc');

      if (status) {
        query = query.where('status', '==', status);
      }

      const snapshot = await query.get();

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

      const payouts = snapshot.docs.map((doc) => {
        const data = doc.data();
        const result: any = {
          id: doc.id,
          ...data,
        };

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

/**
 * Get transaction truth from Firestore (cached result)
 * Used by client for transaction-truth-first pattern
 */
export const getTransactionTruth = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { reference } = request.body;

      if (!reference) {
        return sendError(response, 'Transaction reference required', 400);
      }

      const firestore = admin.firestore();
      const txDoc = await firestore.collection('transactions').doc(reference).get();

      if (!txDoc.exists) {
        return sendResponse(response, { success: true, found: false });
      }

      const data = txDoc.data();
      if (!data) {
        return sendResponse(response, { success: true, found: false });
      }

      const txUid = String(data?.metadata?.firebaseUid || data?.uid || '').trim();

      // Authorization check: user can only read their own transactions
      if (txUid && txUid !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Forbidden: Transaction belongs to another user', 403);
      }

      // Return transaction truth with all relevant fields
      return sendResponse(response, {
        success: true,
        found: true,
        reference: data.reference,
        status: data.status,
        paid: data.status === 'success',
        amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
        currency: data.currency || 'NGN',
        channel: data.channel || null,
        paidAt: data.paidAt || null,
        customerEmail: data.customerEmail || null,
        metadata: data.metadata || null,
        source: data.source, // 'paystack-webhook' | 'paystack-verify'
        createdAt: data.createdAt || null
      });
    } catch (error: any) {
      console.error('Error in getTransactionTruth:', error);
      const statusCode = error?.message?.includes('Unauthorized') ? 401 : 500;
      return sendError(response, error?.message || 'Internal server error', statusCode);
    }
  });
});

// Define schema for finalizeMarketEscrowPayment
const finalizeMarketEscrowPaymentSchema = z.object({
  reference: z.string().min(6),
  postId: z.string().min(1),
  quantity: z.number().int().positive(),
  deliveryAddress: z.string().min(5),
  // Optional — never block order creation after Paystack has already charged the buyer.
  buyerPhone: z.string().optional().nullable(),
  dealThreadId: z.string().min(1).optional().nullable(),
  chatId: z.string().min(1).optional().nullable(),
  /** Accepted offer / checkout unit price — must match what Paystack charged. */
  agreedUnitPrice: z.number().positive().optional(),
  sellerId: z.string().min(1).optional().nullable(),
  itemTitle: z.string().min(1).max(120).optional().nullable(),
});

/**
 * Deterministic Firestore order id from Paystack reference.
 * Concurrent finalize calls for the same payment collide on the same doc inside
 * runTransaction — one creates, the other sees exists — instead of the old
 * TOCTOU race (query outside txn → two order docs for one payment).
 */
function marketOrderIdFromPaystackReference(reference: string): string {
  const clean = String(reference || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 680);
  return `mkt_${clean || 'unknown'}`;
}

/**
 * Server-side recovery when Paystack confirms charge.success but the mobile
 * client never reached finalizeMarketEscrowPayment (crash, killed app, etc.).
 * Idempotent: safe if client finalize races the webhook.
 */
async function tryAutoFinalizeMarketEscrowFromWebhook(input: {
  reference: string;
  amountNgn: number;
  customerEmail: string | null;
  metadata: Record<string, any>;
}): Promise<void> {
  const reference = asNonEmptyString(input.reference);
  if (!reference) return;

  const firestore = admin.firestore();
  const orderChat = await import('./order-chat.js');

  const existingNeon = await orderChat.fetchNeonOrderByReference(reference);
  if (existingNeon?.id) return;

  const orderId = marketOrderIdFromPaystackReference(reference);
  const orderRef = firestore.collection('orders').doc(orderId);
  if ((await orderRef.get()).exists) return;

  const sessionSnap = await firestore.collection('payment_sessions').doc(reference).get();
  const sessionData = sessionSnap.exists ? sessionSnap.data() || {} : {};
  const meta = {
    ...(sessionData.metadata || {}),
    ...(input.metadata || {}),
  };

  const source = asNonEmptyString(meta.source).toLowerCase();
  const postId = asNonEmptyString(meta.postId);
  const isMarketCheckout =
    !!postId &&
    (source.includes('market') ||
      source.includes('chatcart') ||
      meta.agreedUnitPrice != null ||
      meta.agreed_unit_price != null);
  if (!isMarketCheckout) return;

  const buyerId = asNonEmptyString(
    meta.firebaseUid || meta.firebase_uid || meta.buyerId || meta.userId || sessionData.uid
  );
  if (!buyerId) {
    console.warn('Webhook auto-finalize skipped: missing buyerId', reference);
    return;
  }

  let deliveryAddress = asNonEmptyString(meta.deliveryAddress);
  const quantity = Math.max(1, Math.floor(Number(meta.quantity || 1)) || 1);
  const bodyAgreedUnitPrice = Number(meta.agreedUnitPrice ?? meta.agreed_unit_price ?? 0);
  const bodySellerId = asNonEmptyString(meta.sellerId);
  const bodyItemTitle = asNonEmptyString(meta.itemTitle);
  const requestedDealThreadId =
    asNonEmptyString(meta.dealThreadId || meta.chatId) || null;
  let buyerPhone = asNonEmptyString(meta.buyerPhone);

  const neonProfile = await orderChat.fetchNeonUserProfile(buyerId);
  const userDoc = neonProfile ? null : await firestore.collection('users').doc(buyerId).get();
  const userData = neonProfile || (userDoc?.exists ? userDoc.data() : null);
  const buyerName = asNonEmptyString(
    meta.buyerName || userData?.displayName || input.customerEmail || 'Market Buyer'
  );
  buyerPhone =
    buyerPhone ||
    asNonEmptyString(userData?.marketBuyerPhone || userData?.phone) ||
    'Not provided';

  if (deliveryAddress.length < 5) {
    const loc = userData?.marketBuyerLocation || {};
    deliveryAddress = asNonEmptyString(
      [loc.address, loc.city, loc.state].filter(Boolean).join(', ')
    );
  }
  if (deliveryAddress.length < 5) {
    console.warn(
      'Webhook auto-finalize skipped: missing deliveryAddress (client must finalize)',
      reference
    );
    return;
  }

  const paidAmount =
    Number.isFinite(input.amountNgn) && input.amountNgn > 0
      ? input.amountNgn
      : Number(sessionData.amount || 0);
  if (!(paidAmount > 0)) {
    console.warn('Webhook auto-finalize skipped: missing paid amount', reference);
    return;
  }

  const commissionRate = await getPlatformCommissionRate();
  const postSnap = await firestore.collection('marketPosts').doc(postId).get();
  const postData = postSnap.exists ? postSnap.data()! : null;
  const postStatus = String(postData?.status || 'active').toLowerCase();
  if (postData && (postStatus === 'hidden' || postStatus === 'deleted')) {
    console.warn('Webhook auto-finalize skipped: post unavailable', reference, postId);
    return;
  }

  const listedPrice = Number(postData?.price || 0);
  const unitPrice =
    (Number.isFinite(bodyAgreedUnitPrice) && bodyAgreedUnitPrice > 0
      ? bodyAgreedUnitPrice
      : null) || (listedPrice > 0 ? listedPrice : null);
  if (!unitPrice || !(unitPrice > 0)) {
    console.warn('Webhook auto-finalize skipped: missing unit price', reference);
    return;
  }

  const orderTotal = unitPrice * quantity;
  if (Math.abs(orderTotal - paidAmount) > 0.01) {
    console.warn(
      'Webhook auto-finalize skipped: amount mismatch',
      reference,
      { paidAmount, orderTotal }
    );
    return;
  }

  const resolvedSellerId = asNonEmptyString(
    postData?.posterId || bodySellerId || meta.sellerId
  );
  if (!resolvedSellerId || resolvedSellerId === buyerId) {
    console.warn('Webhook auto-finalize skipped: invalid seller', reference);
    return;
  }

  const itemName = String(
    bodyItemTitle || postData?.title || postData?.description || 'Marketplace Item'
  ).slice(0, 70);
  const commission = orderTotal * commissionRate;
  const sellerEarning = orderTotal - commission;

  let dealThreadId: string | null = requestedDealThreadId;
  try {
    dealThreadId = await orderChat.ensureDealThreadForOrder({
      buyerId,
      postId,
      sellerId: resolvedSellerId,
      threadId: requestedDealThreadId,
    });
  } catch (linkError) {
    console.error('Webhook auto-finalize deal thread failed', reference, linkError);
  }

  const nowIso = new Date().toISOString();
  const orderPayload: Record<string, any> = {
    id: orderId,
    customerId: buyerId,
    sellerId: resolvedSellerId,
    postId,
    idempotencyKey: reference,
    items: [
      {
        productId: `market_post_${postId}`,
        name: itemName,
        price: unitPrice,
        quantity,
      },
    ],
    total: orderTotal,
    shippingPrice: 0,
    shippingType: 'pickup',
    status: 'Processing',
    deliveryAddress: deliveryAddress.trim(),
    customerInfo: {
      name: buyerName,
      email: input.customerEmail || asNonEmptyString(meta.buyerEmail) || '',
      phone: buyerPhone.trim(),
    },
    paymentMethod: 'Paystack Escrow',
    paymentReference: reference,
    paystackReference: reference,
    escrowStatus: 'held',
    commissionRate,
    dealThreadId: dealThreadId || null,
    chatThreadId: dealThreadId || null,
    marketMeta: {
      fromChatId: dealThreadId || requestedDealThreadId,
      postId,
      agreedUnitPrice: unitPrice,
      listedPrice: listedPrice || null,
      finalizedBy: 'paystack-webhook',
    },
    createdAt: nowIso,
    updatedAt: nowIso,
    paymentVerifiedAt: nowIso,
    sellerUnreadCount: 1,
    buyerUnreadCount: 0,
  };

  try {
    await orderChat.commitAndMirrorOrder(orderPayload, {
      bumpPurchaseCount: true,
      timeline: [
        {
          event: 'order_paid',
          status: 'Processing',
          text: 'Payment verified',
          actorId: buyerId,
          actorRole: 'buyer',
          createdAt: nowIso,
        },
      ],
    });
  } catch (commitError) {
    const raced = await orderChat.fetchNeonOrderByReference(reference);
    if (raced?.id) return;
    throw commitError;
  }

  try {
    await firestore.collection('transactions').doc(`ledger_${reference}`).set(
      {
        id: `ledger_${reference}`,
        type: 'sale',
        amount: sellerEarning,
        commission,
        commissionRate,
        orderId,
        sellerId: resolvedSellerId,
        customerId: buyerId,
        description: `Sale from order #${orderId.slice(0, 7)}`,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    if (postSnap.exists) {
      await firestore.collection('marketPosts').doc(postId).set(
        {
          lastBuyerId: buyerId,
          purchaseCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    await firestore.collection('payment_sessions').doc(reference).set(
      {
        status: 'finalized',
        orderId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (mirrorError) {
    console.warn('Webhook auto-finalize mirror side-effects failed', orderId, mirrorError);
  }

  try {
    await orderChat.createSystemMessage({
      orderId,
      event: 'order_paid',
      dealThreadId,
      customText: `Order confirmed. Payment of NGN ${Number(orderTotal).toLocaleString()} received.`,
    });
  } catch {
    // non-fatal
  }

  console.log('Webhook auto-finalized market escrow order', { reference, orderId, buyerId });
}

/**
 * Finalize Marketplace Escrow Payment:
 * Verifies Paystack status, secures inventory, creates the order, and updates ledger.
 */
export const finalizeMarketEscrowPayment = onRequest(
  { secrets: [paystackSecret] },
  async (request, response) => {
    return corsHandler(request, response, async () => {
      try {
        if (request.method !== 'POST') {
          return sendError(response, 'Method not allowed', 405);
        }

        const auth = await requireAuth(request.headers.authorization || null);
        const validation = finalizeMarketEscrowPaymentSchema.safeParse(request.body);
        if (!validation.success) {
          return sendError(response, `Invalid completion data: ${validation.error.message}`, 400);
        }

        const { reference, deliveryAddress } = validation.data;
        let postId = String(validation.data.postId || '').trim();
        let quantity = validation.data.quantity;
        const requestedDealThreadId = String(
          validation.data.dealThreadId || validation.data.chatId || ''
        ).trim() || null;
        const bodyAgreedUnitPrice =
          typeof validation.data.agreedUnitPrice === 'number' && validation.data.agreedUnitPrice > 0
            ? validation.data.agreedUnitPrice
            : null;
        const bodySellerId = String(validation.data.sellerId || '').trim() || null;
        const bodyItemTitle = String(validation.data.itemTitle || '').trim() || null;
        const bodyBuyerPhone = String(validation.data.buyerPhone || '').trim();
        const firestore = admin.firestore();
        const orderId = marketOrderIdFromPaystackReference(reference);
        const orderRef = firestore.collection('orders').doc(orderId);
        const orderChat = await import('./order-chat.js');

        // Idempotent short-circuit: Neon primary, then Firestore mirror.
        const existingNeon = await orderChat.fetchNeonOrderByReference(reference);
        if (existingNeon?.id) {
          return sendResponse(response, {
            success: true,
            orderId: existingNeon.id,
            dealThreadId: existingNeon.dealThreadId || existingNeon.chatThreadId || null,
            alreadyExists: true,
            message: 'Order already finalized for this payment',
          });
        }
        const existingSnap = await orderRef.get();
        if (existingSnap.exists) {
          const existingData = existingSnap.data() || {};
          try {
            await orderChat.dualWriteOrderToPostgres(orderRef.id, { bumpPurchaseCount: true });
          } catch (syncErr) {
            console.warn('Legacy FS order Neon backfill failed', orderRef.id, syncErr);
          }
          return sendResponse(response, {
            success: true,
            orderId: orderRef.id,
            dealThreadId: existingData.dealThreadId || existingData.chatThreadId || null,
            alreadyExists: true,
            message: 'Order already finalized for this payment',
          });
        }

        // Bind finalize to the initialized payment session so a paid ref cannot be
        // applied to a different product / qty / price than what was charged.
        const sessionSnap = await firestore.collection('payment_sessions').doc(reference).get();
        const sessionData = sessionSnap.exists ? sessionSnap.data() || {} : null;
        const sessionMeta = (sessionData?.metadata || {}) as Record<string, any>;
        if (sessionData) {
          const sessionUid = String(sessionData.uid || '').trim();
          if (sessionUid && sessionUid !== auth.uid && !auth.isAdmin) {
            return sendError(response, 'Forbidden: Payment session belongs to another user', 403);
          }
          const sessionPostId = String(sessionMeta.postId || '').trim();
          if (sessionPostId && postId && sessionPostId !== postId) {
            return sendError(
              response,
              'This payment was initialized for a different product',
              409
            );
          }
          if (sessionPostId) postId = sessionPostId;
          const sessionQty = Math.floor(Number(sessionMeta.quantity || 0));
          if (Number.isFinite(sessionQty) && sessionQty > 0) {
            quantity = sessionQty;
          }
        }

        // 2. Query/Verify transaction truth cached or via Paystack
        let txStatus = '';
        let paidAmount = 0;
        let customerEmail = '';
        let txMetadata: any = {};

        const cachedTx = await firestore.collection('transactions').doc(reference).get();
        if (cachedTx.exists) {
          const txData = cachedTx.data() || {};
          txStatus = String(txData.status || '').toLowerCase();
          paidAmount = Number(txData.amount || 0);
          customerEmail = String(txData.customerEmail || '').trim().toLowerCase();
          txMetadata = txData.metadata || {};
        }

        if (txStatus !== 'success') {
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

          const payload: any = await paystackResponse.json().catch(() => ({}));
          if (!paystackResponse.ok || !payload?.status || !payload?.data) {
            const message = payload?.message || `Paystack verify failed with status ${paystackResponse.status}`;
            return sendError(response, message, 400);
          }

          const tx = payload.data;
          txStatus = String(tx?.status || '').toLowerCase();
          if (txStatus !== 'success') {
            return sendError(response, `Payment not successful. Status: ${txStatus || 'unknown'}`, 400);
          }

          paidAmount = Number(tx?.amount || 0) / 100;
          customerEmail = String(tx?.customer?.email || tx?.customer_email || '').trim().toLowerCase();
          txMetadata = tx?.metadata || {};

          await writeTransactionTruth({
            reference,
            status: txStatus,
            amount: paidAmount,
            currency: String(tx?.currency || 'NGN'),
            channel: String(tx?.channel || ''),
            customerEmail,
            paidAt: tx?.paid_at || null,
            metadata: txMetadata,
            gatewayEvent: null,
            gatewayId: String(tx?.id || ''),
            source: 'paystack-verify',
          });
        }

        // Merge gateway + session metadata; session wins product binding fields.
        const gatewayMeta = txMetadata || {};
        txMetadata = {
          ...gatewayMeta,
          ...sessionMeta,
          postId: sessionMeta.postId || gatewayMeta.postId,
          quantity: sessionMeta.quantity ?? gatewayMeta.quantity,
          agreedUnitPrice:
            sessionMeta.agreedUnitPrice ??
            sessionMeta.agreed_unit_price ??
            gatewayMeta.agreedUnitPrice ??
            gatewayMeta.agreed_unit_price,
          sellerId: sessionMeta.sellerId || gatewayMeta.sellerId,
          firebaseUid:
            sessionMeta.firebaseUid ||
            sessionData?.uid ||
            gatewayMeta.firebaseUid ||
            gatewayMeta.firebase_uid ||
            gatewayMeta.userId,
        };

        const txMetadataUid = String(
          txMetadata?.firebaseUid ||
          txMetadata?.firebase_uid ||
          txMetadata?.userId ||
          sessionData?.uid ||
          ''
        ).trim();

        if (txMetadataUid && txMetadataUid !== auth.uid && !auth.isAdmin) {
          return sendError(response, 'Forbidden: Payment belongs to another user', 403);
        }

        if (sessionData) {
          const sessionAmount = Number(sessionData.amount || 0);
          if (sessionAmount > 0 && Math.abs(sessionAmount - paidAmount) > 0.01) {
            return sendError(
              response,
              `Payment session amount mismatch. Session: ₦${sessionAmount}, Paid: ₦${paidAmount}`,
              400
            );
          }
        }

        const metaPostId = String(txMetadata?.postId || '').trim();
        if (metaPostId && postId && metaPostId !== postId) {
          return sendError(
            response,
            'This payment was initialized for a different product',
            409
          );
        }
        if (metaPostId) postId = metaPostId;
        if (!postId) {
          return sendError(response, 'Missing product for this payment', 400);
        }

        const neonProfile = await orderChat.fetchNeonUserProfile(auth.uid);
        const userDoc = neonProfile ? null : await firestore.collection('users').doc(auth.uid).get();
        const userData = neonProfile || (userDoc?.exists ? userDoc.data() : null);
        const buyerName = String(userData?.displayName || auth.email || 'Market Buyer').trim();
        const buyerPhone =
          bodyBuyerPhone ||
          String(sessionMeta.buyerPhone || userData?.marketBuyerPhone || userData?.phone || '').trim() ||
          'Not provided';

        const commissionRate = await getPlatformCommissionRate();

        const postSnap = await firestore.collection('marketPosts').doc(postId).get();
        const postData = postSnap.exists ? postSnap.data()! : null;
        const postStatus = String(postData?.status || 'active').toLowerCase();
        if (postData && (postStatus === 'hidden' || postStatus === 'deleted')) {
          return sendError(response, 'This item is no longer available', 409);
        }

        const listedPrice = Number(postData?.price || 0);
        const sessionAgreed = Number(
          sessionMeta.agreedUnitPrice ?? sessionMeta.agreed_unit_price ?? 0
        );
        const metaAgreed = Number(
          txMetadata?.agreedUnitPrice ?? txMetadata?.agreed_unit_price ?? 0
        );
        // Session/unit locked at initialize wins over client body (anti-tamper).
        const unitPrice =
          (Number.isFinite(sessionAgreed) && sessionAgreed > 0 ? sessionAgreed : null) ||
          (Number.isFinite(metaAgreed) && metaAgreed > 0 ? metaAgreed : null) ||
          (bodyAgreedUnitPrice && bodyAgreedUnitPrice > 0 ? bodyAgreedUnitPrice : null) ||
          (listedPrice > 0 ? listedPrice : null);

        if (!unitPrice || !(unitPrice > 0)) {
          return sendError(
            response,
            'Checkout price missing. Reopen Complete purchase from the deal.',
            400
          );
        }

        const orderTotal = unitPrice * quantity;
        const itemName = String(
          bodyItemTitle ||
            sessionMeta.itemTitle ||
            postData?.title ||
            postData?.description ||
            'Marketplace Item'
        ).slice(0, 70);

        if (Math.abs(orderTotal - paidAmount) > 0.01) {
          return sendError(
            response,
            `Amount mismatch. Paid: ₦${paidAmount}, Order cost: ₦${orderTotal}`,
            400
          );
        }

        const resolvedSellerId = String(
          postData?.posterId || bodySellerId || sessionMeta.sellerId || txMetadata?.sellerId || ''
        ).trim();
        if (!resolvedSellerId) {
          return sendError(response, 'Seller ID missing from post', 400);
        }
        if (resolvedSellerId === auth.uid) {
          return sendError(response, 'You cannot purchase your own item', 403);
        }

        const commission = orderTotal * commissionRate;
        const sellerEarning = orderTotal - commission;

        let dealThreadId: string | null = requestedDealThreadId;
        try {
          dealThreadId = await orderChat.ensureDealThreadForOrder({
            buyerId: auth.uid,
            postId,
            sellerId: resolvedSellerId,
            threadId: requestedDealThreadId,
          });
        } catch (linkError: any) {
          console.error('Failed to ensure deal thread before order commit:', linkError);
        }

        const nowIso = new Date().toISOString();
        const orderPayload: Record<string, any> = {
          id: orderId,
          customerId: auth.uid,
          sellerId: resolvedSellerId,
          postId,
          idempotencyKey: reference,
          items: [
            {
              productId: `market_post_${postId}`,
              name: itemName,
              price: unitPrice,
              quantity,
            },
          ],
          total: orderTotal,
          shippingPrice: 0,
          shippingType: 'pickup',
          status: 'Processing',
          deliveryAddress: deliveryAddress.trim(),
          customerInfo: {
            name: buyerName,
            email: auth.email || customerEmail,
            phone: buyerPhone.trim(),
          },
          paymentMethod: 'Paystack Escrow',
          paymentReference: reference,
          paystackReference: reference,
          escrowStatus: 'held',
          commissionRate,
          dealThreadId: dealThreadId || null,
          chatThreadId: dealThreadId || null,
          marketMeta: {
            fromChatId: dealThreadId || requestedDealThreadId,
            postId,
            agreedUnitPrice: unitPrice,
            listedPrice: listedPrice || null,
          },
          createdAt: nowIso,
          updatedAt: nowIso,
          paymentVerifiedAt: nowIso,
          sellerUnreadCount: 1,
          buyerUnreadCount: 0,
        };

        try {
          await orderChat.commitAndMirrorOrder(orderPayload, {
            bumpPurchaseCount: true,
            timeline: [
              {
                event: 'order_paid',
                status: 'Processing',
                text: 'Payment verified',
                actorId: auth.uid,
                actorRole: 'buyer',
                createdAt: nowIso,
              },
            ],
          });
        } catch (commitError: any) {
          const raced = await orderChat.fetchNeonOrderByReference(reference);
          if (raced?.id) {
            return sendResponse(response, {
              success: true,
              orderId: raced.id,
              dealThreadId: raced.dealThreadId || raced.chatThreadId || dealThreadId,
              alreadyExists: true,
              message: 'Order already finalized for this payment',
            });
          }
          throw commitError;
        }

        try {
          await firestore.collection('transactions').doc(`ledger_${reference}`).set(
            {
              id: `ledger_${reference}`,
              type: 'sale',
              amount: sellerEarning,
              commission: commission,
              commissionRate,
              orderId,
              sellerId: resolvedSellerId,
              customerId: auth.uid,
              description: `Sale from order #${orderId.slice(0, 7)}`,
              status: 'completed',
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          if (postSnap.exists) {
            await firestore.collection('marketPosts').doc(postId).set(
              {
                status: postStatus === 'sold' ? 'active' : postData?.status || 'active',
                lastBuyerId: auth.uid,
                purchaseCount: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
          await firestore.collection('payment_sessions').doc(reference).set(
            {
              status: 'finalized',
              orderId,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } catch (ledgerError) {
          console.warn('Ledger/post mirror after Neon commit failed', orderId, ledgerError);
        }

        try {
          await orderChat.createSystemMessage({
            orderId,
            event: 'order_paid',
            dealThreadId,
            customText: `Order confirmed. Payment of NGN ${Number(orderTotal).toLocaleString()} received.`,
          });
        } catch (sysErr) {
          console.warn('System message after Neon commit failed', orderId, sysErr);
        }

        import('./notifications.js').then((mod) => {
          mod.notifyBuyer({
            buyerId: auth.uid,
            event: 'payment_success',
            orderId,
            orderSummary: `${itemName} — NGN ${Number(orderTotal).toLocaleString()}`,
            chatRoomId: dealThreadId,
          }).catch((e: any) => console.error('Failed to notify buyer:', e));

          if (resolvedSellerId) {
            mod.notifySeller({
              sellerId: resolvedSellerId,
              event: 'new_order',
              orderId,
              orderSummary: `${itemName} — NGN ${Number(orderTotal).toLocaleString()}`,
              chatRoomId: dealThreadId,
            }).catch((e: any) => console.error('Failed to notify seller:', e));
          }
        }).catch(() => {});

        return sendResponse(response, {
          success: true,
          orderId,
          dealThreadId,
          message: 'Order created successfully',
        });
      } catch (error: any) {
        console.error('Error in finalizeMarketEscrowPayment:', error);
        const message = error.message || 'Internal server error';
        const statusCode =
          message === 'Post not found'
            ? 404
            : message === 'This item is no longer available'
              ? 409
              : message.startsWith('Amount mismatch')
                ? 400
                : message === 'You cannot purchase your own item'
                  ? 403
                  : message.includes('Neon') || message.includes('commit')
                    ? 503
                    : 500;
        return sendError(response, message, statusCode);
      }
    });
  }
);

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
          .get();

        if (!transactionsSnapshot.empty) {
          transactionsSnapshot.forEach(doc => {
            const transaction = doc.data();
            const status = String(transaction.status || '');
            const refundStatus = String(transaction.refundStatus || '');
            // Exclude fully refunded or refund-in-flight sales from payoutable earnings
            if (status === 'refunded' || refundStatus === 'refunded' || refundStatus === 'pending') {
              return;
            }
            if (status !== 'completed') return;

            const gross = Number(transaction.amount) || 0;
            const refundedSeller = Number(transaction.refundedSellerAmount) || 0;
            const net = Math.max(0, gross - refundedSeller);
            if (net <= 0) return;

            totalEarnings += net;
            const commissionGross = Number(transaction.commission) || 0;
            const commissionShare =
              gross > 0 ? commissionGross * (net / gross) : commissionGross;
            commissionPaid += commissionShare;
            totalOrders++;
          });
        } else {
          // Fallback: Calculate from completed orders only (exclude cancelled / refunded escrow)
          const ordersSnapshot = await firestore.collection('orders')
            .where('sellerId', '==', sellerId)
            .where('status', '==', 'Completed')
            .get();

          ordersSnapshot.forEach(doc => {
            const order = doc.data();
            if (order.escrowStatus === 'refunded' || order.escrowStatus === 'refund_pending') {
              return;
            }
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
  }
);

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

        // Try load from transactions ledger collection
        const ledgerSnapshot = await firestore.collection('transactions')
          .where('sellerId', '==', sellerId)
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();

        if (!ledgerSnapshot.empty) {
          ledgerSnapshot.forEach(doc => {
            const data = doc.data();
            transactions.push({
              id: doc.id,
              ...data,
              createdAt: data.createdAt?.toDate?.() || data.createdAt,
              updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
            });
          });
        } else {
          // Fallback to orders calculation if ledger is empty (migration path)
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
        }

        // Get payout transactions and merge
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
            description: `Payout to ${payout.bankName || 'bank account'}`,
            status: payout.status,
            createdAt: payout.createdAt?.toDate?.() || payout.createdAt,
          });
        });

        // Sort by date (most recent first)
        transactions.sort((a, b) => {
          const dateA = new Date(a.createdAt?.toDate?.() || a.createdAt || 0).getTime();
          const dateB = new Date(b.createdAt?.toDate?.() || b.createdAt || 0).getTime();
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
  }
);
