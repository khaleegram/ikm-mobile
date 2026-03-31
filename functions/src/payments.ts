import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import cors = require('cors');
import crypto from 'crypto';
import {
    getPaystackSecretKey,
    requireAuth,
    sendError,
    sendResponse,
    verifyIdToken,
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
            status: 'Processing',
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
          });
        });

        return sendResponse(response, { success: true, orderId: orderRef.id, message: 'Free order created successfully' });
      }

      // Paid orders
      const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
        signal: AbortSignal.timeout(10000),
      });

      const paystackResult = await paystackResponse.json();
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
          status: 'Processing',
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
        });
      });

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

      const result = await paystackResponse.json();
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
      if (request.method !== 'GET') {
        return sendError(response, 'Method not allowed', 405);
      }
      const paystackSecretKey = getPaystackSecretKey(paystackSecret.value());
      const paystackResponse = await fetch('https://api.paystack.co/bank?country=nigeria', {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
      });

      if (!paystackResponse.ok) return sendError(response, 'Failed to fetch banks');
      const result = await paystackResponse.json();
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
      const result = await paystackResponse.json();
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
      if (!amount || amount <= 0) return sendError(response, 'Valid amount is required');

      const firestore = admin.firestore();
      const userDoc = await firestore.collection('users').doc(auth.uid).get();
      if (!userDoc.data()?.payoutDetails) return sendError(response, 'Payout details not set');

      await firestore.collection('payouts').add({
        sellerId: auth.uid,
        amount,
        ...userDoc.data()?.payoutDetails,
        status: 'pending',
        requestedAt: FieldValue.serverTimestamp(),
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
      await verifyIdToken(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('payouts').orderBy('createdAt', 'desc').get();
      const payouts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return sendResponse(response, { success: true, payouts });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});
