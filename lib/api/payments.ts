import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';

const PAYMENT_FUNCTIONS = {
  initializePaystackTransaction: cloudFunctionUrl('initializePaystackTransaction'),
  verifyPaystackTransaction: cloudFunctionUrl('verifyPaystackTransaction'),
  getTransactionTruth: cloudFunctionUrl('getTransactionTruth'),
  paystackWebhook: cloudFunctionUrl('paystackWebhook'),
  verifyPaymentAndCreateOrder: cloudFunctionUrl('verifyPaymentAndCreateOrder'),
  findRecentTransactionByEmail: cloudFunctionUrl('findRecentTransactionByEmail'),
  finalizeMarketEscrowPayment: cloudFunctionUrl('finalizeMarketEscrowPayment'),
};

type InitializePaymentInput = {
  amount: number; // NGN
  email: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  reference?: string;
};

type InitializePaymentResult = {
  authorizationUrl: string;
  reference: string;
  accessCode?: string;
};

type VerifyPaymentInput = {
  amount: number; // NGN
  email: string;
  reference: string;
  maxAttempts?: number;
  attemptDelayMs?: number;
};

type VerifyPaymentResult = {
  paid: boolean;
  reference: string;
  status?: string;
  paidAt?: string;
  amount?: number;
  currency?: string;
  channel?: string;
};

export type EscrowPaymentInspectStatus =
  | 'success'
  | 'abandoned'
  | 'failed'
  | 'reversed'
  | 'declined'
  | 'pending'
  | 'ongoing'
  | 'not_found'
  | 'unknown';

export type EscrowPaymentInspectResult = {
  reference: string;
  paid: boolean;
  /** True when Paystack/truth says this reference will never succeed. */
  terminalUnpaid: boolean;
  /**
   * True when there is no evidence of a charge for this reference
   * (abandoned/failed OR Paystack has no transaction yet for an unopened checkout).
   */
  safeToStartNewPayment: boolean;
  status: EscrowPaymentInspectStatus;
  amount?: number;
  message?: string;
};

/** Bank/USSD can stay pending a while — after this, buyer may start a new pay if still unpaid. */
export const ESCROW_PENDING_NEW_PAYMENT_GRACE_MS = 10 * 60 * 1000;

function normalizeEscrowInspectStatus(raw: unknown): EscrowPaymentInspectStatus {
  const status = asNonEmptyString(raw).toLowerCase();
  if (status === 'success' || status === 'successful') return 'success';
  if (status === 'abandoned') return 'abandoned';
  if (status === 'failed') return 'failed';
  if (status === 'reversed') return 'reversed';
  if (status === 'declined') return 'declined';
  if (status === 'ongoing') return 'ongoing';
  if (status === 'pending' || status === 'processing') return 'pending';
  return status ? 'unknown' : 'unknown';
}

function statusFromPaymentErrorMessage(message: string): EscrowPaymentInspectStatus {
  const normalized = String(message || '').toLowerCase();
  const matched = normalized.match(/status:\s*([a-z_]+)/i);
  if (matched?.[1]) return normalizeEscrowInspectStatus(matched[1]);
  if (normalized.includes('abandoned')) return 'abandoned';
  if (normalized.includes('reversed')) return 'reversed';
  if (normalized.includes('declined')) return 'declined';
  if (normalized.includes('failed')) return 'failed';
  // Initialized session that never became a Paystack charge — not "still processing forever".
  if (
    normalized.includes('transaction reference not found') ||
    normalized.includes('reference not found')
  ) {
    return 'not_found';
  }
  if (normalized.includes('pending') || normalized.includes('not confirmed')) return 'pending';
  return 'unknown';
}

function isTerminalUnpaidStatus(status: EscrowPaymentInspectStatus): boolean {
  return (
    status === 'abandoned' ||
    status === 'failed' ||
    status === 'reversed' ||
    status === 'declined'
  );
}

function isSafeToStartNewPaymentStatus(status: EscrowPaymentInspectStatus): boolean {
  return isTerminalUnpaidStatus(status) || status === 'not_found';
}

/**
 * Decide if a buyer can open a fresh Paystack session for the same product.
 * - paid / submitted → never
 * - abandoned / failed / not_found → yes
 * - pending/ongoing → only after grace window (default 10 minutes)
 */
export function canStartNewEscrowPayment(input: {
  inspected: EscrowPaymentInspectResult;
  phase?: 'initialized' | 'submitted' | null;
  createdAtMs?: number;
  nowMs?: number;
  graceMs?: number;
}): { allow: boolean; waitMsRemaining: number; label: string } {
  const inspected = input.inspected;
  const phase = input.phase || 'initialized';
  const graceMs = Math.max(0, Number(input.graceMs ?? ESCROW_PENDING_NEW_PAYMENT_GRACE_MS));
  const createdAtMs = Number(input.createdAtMs || 0);
  const nowMs = Number(input.nowMs || Date.now());
  const ageMs = createdAtMs > 0 ? Math.max(0, nowMs - createdAtMs) : graceMs;

  if (inspected.paid) {
    return { allow: false, waitMsRemaining: 0, label: 'Payment already succeeded — complete the order.' };
  }
  if (phase === 'submitted') {
    return {
      allow: false,
      waitMsRemaining: 0,
      label: 'Checkout already reported success — tap Complete order. Do not pay again.',
    };
  }
  if (inspected.safeToStartNewPayment || isSafeToStartNewPaymentStatus(inspected.status)) {
    return { allow: true, waitMsRemaining: 0, label: 'No charge found for this checkout — safe to pay again.' };
  }

  const waiting =
    inspected.status === 'pending' ||
    inspected.status === 'ongoing' ||
    inspected.status === 'unknown';
  if (waiting) {
    const waitMsRemaining = Math.max(0, graceMs - ageMs);
    if (waitMsRemaining <= 0) {
      return {
        allow: true,
        waitMsRemaining: 0,
        label: 'Still unconfirmed after waiting — you may start a new payment if no money left your account.',
      };
    }
    const mins = Math.max(1, Math.ceil(waitMsRemaining / 60000));
    return {
      allow: false,
      waitMsRemaining,
      label: `Paystack is still processing. Wait about ${mins} min, or tap Complete order if you already paid.`,
    };
  }

  return { allow: true, waitMsRemaining: 0, label: 'You can start a new payment.' };
}

function formatInspectResult(
  reference: string,
  status: EscrowPaymentInspectStatus,
  paid: boolean,
  amount?: number,
  message?: string
): EscrowPaymentInspectResult {
  return {
    reference,
    paid,
    terminalUnpaid: !paid && isTerminalUnpaidStatus(status),
    safeToStartNewPayment: !paid && isSafeToStartNewPaymentStatus(status),
    status: paid ? 'success' : status,
    amount,
    message,
  };
}

function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}

function buildDefaultReference(): string {
  return `ikm_escrow_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingTransactionTruthEndpoint(error: any): boolean {
  const functionName = asNonEmptyString(error?.functionName).toLowerCase();
  return functionName === 'gettransactiontruth' && Number(error?.status) === 404;
}

export const paymentsApi = {
  async initializeEscrowPayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const normalizedEmail = asNonEmptyString(input.email);
    if (!normalizedEmail) {
      throw new Error('Buyer email is required to initialize payment.');
    }

    const normalizedAmount = Number(input.amount || 0);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error('Invalid payment amount.');
    }

    const normalizedCallbackUrl = asNonEmptyString(input.callbackUrl);
    if (!normalizedCallbackUrl) {
      throw new Error('Payment callback URL is required.');
    }

    const requestedReference = asNonEmptyString(input.reference) || buildDefaultReference();

    const initialized = await coreCloudClient.request<any>(PAYMENT_FUNCTIONS.initializePaystackTransaction, {
      method: 'POST',
      body: {
        amount: normalizedAmount,
        email: normalizedEmail,
        callbackUrl: normalizedCallbackUrl,
        metadata: input.metadata,
        reference: requestedReference,
      },
      requiresAuth: true,
    });

    const authorizationUrl =
      asNonEmptyString(initialized?.authorizationUrl) ||
      asNonEmptyString(initialized?.authorization_url) ||
      asNonEmptyString(initialized?.data?.authorization_url);
    const reference =
      asNonEmptyString(initialized?.reference) ||
      asNonEmptyString(initialized?.data?.reference) ||
      requestedReference;
    const accessCode =
      asNonEmptyString(initialized?.accessCode) ||
      asNonEmptyString(initialized?.access_code) ||
      asNonEmptyString(initialized?.data?.access_code) ||
      undefined;

    if (!authorizationUrl) {
      throw new Error('Unable to initialize checkout. Missing authorization URL.');
    }
    if (!reference) {
      throw new Error('Unable to initialize checkout. Missing payment reference.');
    }

    return { authorizationUrl, reference, accessCode };
  },

  async verifyEscrowPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const normalizedEmail = asNonEmptyString(input.email);
    if (!normalizedEmail) {
      throw new Error('Buyer email is required to verify payment.');
    }

    const normalizedReference = asNonEmptyString(input.reference);
    if (!normalizedReference) {
      throw new Error('Missing payment reference.');
    }

    const normalizedAmount = Number(input.amount || 0);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error('Invalid payment amount.');
    }

    const maxAttempts = Math.max(1, Number(input.maxAttempts || 3));
    const attemptDelayMs = Math.max(200, Number(input.attemptDelayMs || 1500));

    // TRANSACTION TRUTH FIRST: Try to read cached result from Firestore
    try {
      const cachedResult = await coreCloudClient.request<any>(
        PAYMENT_FUNCTIONS.getTransactionTruth,
        {
          method: 'POST',
          body: { reference: normalizedReference },
          requiresAuth: true,
        }
      );

      if (cachedResult?.found && cachedResult?.status === 'success') {
        return {
          paid: true,
          reference: cachedResult.reference,
          status: 'success',
          amount: cachedResult.amount || normalizedAmount,
          currency: cachedResult.currency || 'NGN',
          channel: cachedResult.channel,
          paidAt: cachedResult.paidAt,
        };
      }
    } catch (cacheError) {
      // Fall through to polling if cache read fails
      if (!isMissingTransactionTruthEndpoint(cacheError)) {
        console.warn('Transaction truth cache read failed, falling back to polling:', cacheError);
      }
    }

    // POLLING FALLBACK: Poll Paystack verification endpoint with retry logic
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const verification = await coreCloudClient.request<any>(PAYMENT_FUNCTIONS.verifyPaystackTransaction, {
          method: 'POST',
          body: {
            reference: normalizedReference,
            expectedAmount: normalizedAmount,
            expectedEmail: normalizedEmail,
          },
          requiresAuth: true,
        });

        const verifiedReference = asNonEmptyString(verification?.reference) || normalizedReference;
        const normalizedStatus = asNonEmptyString(verification?.status).toLowerCase();
        const paid = verification?.paid === true || normalizedStatus === 'success';

        if (!paid) {
          throw new Error('Payment has not been confirmed as successful.');
        }

        return {
          paid: true,
          reference: verifiedReference,
          status: asNonEmptyString(verification?.status) || 'success',
          paidAt: asNonEmptyString(verification?.paidAt) || undefined,
          amount:
            Number.isFinite(Number(verification?.amount)) &&
            Number(verification?.amount) > 0
              ? Number(verification?.amount)
              : normalizedAmount,
          currency: asNonEmptyString(verification?.currency) || 'NGN',
          channel: asNonEmptyString(verification?.channel) || undefined,
        };
      } catch (verifyError) {
        // Backward-compatible fallback while verifyPaystackTransaction is being deployed.
        const fallback = await coreCloudClient.request<any>(PAYMENT_FUNCTIONS.findRecentTransactionByEmail, {
          method: 'POST',
          body: {
            email: normalizedEmail,
            amount: normalizedAmount,
          },
          requiresAuth: true,
        }).catch(() => null);

        const fallbackReference = asNonEmptyString(fallback?.reference);
        if (fallbackReference && fallbackReference === normalizedReference) {
          return {
            paid: true,
            reference: fallbackReference,
            status: asNonEmptyString(fallback?.status) || 'success',
            paidAt: asNonEmptyString(fallback?.paidAt) || undefined,
            amount: normalizedAmount,
            currency: 'NGN',
          };
        }

        if (attempt === maxAttempts - 1) {
          const finalMessage = String((verifyError as any)?.message || '').toLowerCase();
          // Abandoned/failed are terminal — do not rewrite as "try again" or clients keep retrying forever.
          if (
            finalMessage.includes('abandoned') ||
            finalMessage.includes('failed') ||
            finalMessage.includes('reversed') ||
            finalMessage.includes('declined')
          ) {
            throw verifyError;
          }
          if (
            finalMessage.includes('payment not successful') ||
            finalMessage.includes('pending')
          ) {
            throw new Error(
              'Payment not confirmed yet. If you already paid, wait a few seconds and try again.'
            );
          }
          throw verifyError;
        }
      }

      await sleep((attempt + 1) * attemptDelayMs);
    }

    throw new Error('Payment could not be verified yet. Please try again in a moment.');
  },

  /**
   * Non-destructive payment status check. Used before clearing local pending
   * checkout or starting a second charge — never invents "safe to delete".
   */
  async inspectEscrowPaymentStatus(input: {
    reference: string;
    amount?: number;
    email?: string;
  }): Promise<EscrowPaymentInspectResult> {
    const normalizedReference = asNonEmptyString(input.reference);
    if (!normalizedReference) {
      throw new Error('Missing payment reference.');
    }

    const normalizedAmount =
      Number.isFinite(Number(input.amount)) && Number(input.amount) > 0
        ? Number(input.amount)
        : undefined;
    const normalizedEmail = asNonEmptyString(input.email) || undefined;

    try {
      const cachedResult = await coreCloudClient.request<any>(
        PAYMENT_FUNCTIONS.getTransactionTruth,
        {
          method: 'POST',
          body: { reference: normalizedReference },
          requiresAuth: true,
        }
      );

      if (cachedResult?.found) {
        const status = normalizeEscrowInspectStatus(cachedResult.status);
        // Success from truth store is authoritative for "paid".
        if (status === 'success' || cachedResult.paid === true) {
          return formatInspectResult(
            asNonEmptyString(cachedResult.reference) || normalizedReference,
            'success',
            true,
            Number.isFinite(Number(cachedResult.amount)) && Number(cachedResult.amount) > 0
              ? Number(cachedResult.amount)
              : normalizedAmount
          );
        }
        // Cached abandoned/failed can be stale vs a later success — always confirm live
        // before callers clear local recovery data.
      }
    } catch (cacheError) {
      if (!isMissingTransactionTruthEndpoint(cacheError)) {
        console.warn('inspectEscrowPaymentStatus truth read failed:', cacheError);
      }
    }

    try {
      const verification = await coreCloudClient.request<any>(
        PAYMENT_FUNCTIONS.verifyPaystackTransaction,
        {
          method: 'POST',
          body: {
            reference: normalizedReference,
            ...(normalizedAmount != null ? { expectedAmount: normalizedAmount } : {}),
            ...(normalizedEmail ? { expectedEmail: normalizedEmail } : {}),
          },
          requiresAuth: true,
        }
      );

      const status = normalizeEscrowInspectStatus(verification?.status);
      const paid = verification?.paid === true || status === 'success';
      return formatInspectResult(
        asNonEmptyString(verification?.reference) || normalizedReference,
        paid ? 'success' : status,
        paid,
        Number.isFinite(Number(verification?.amount)) && Number(verification?.amount) > 0
          ? Number(verification?.amount)
          : normalizedAmount
      );
    } catch (verifyError: any) {
      const message = String(verifyError?.message || '');
      const status = statusFromPaymentErrorMessage(message);
      return formatInspectResult(
        normalizedReference,
        status,
        false,
        normalizedAmount,
        message || undefined
      );
    }
  },

  async finalizeMarketEscrowPayment(input: {
    reference: string;
    postId: string;
    quantity: number;
    deliveryAddress: string;
    buyerPhone?: string | null;
    dealThreadId?: string | null;
    chatId?: string | null;
    agreedUnitPrice?: number;
    sellerId?: string | null;
    itemTitle?: string | null;
    lineItems?: Array<{
      postId: string;
      quantity: number;
      unitPrice: number;
      title?: string;
    }>;
    cartSessionId?: string | null;
  }): Promise<{
    success: boolean;
    orderId: string;
    dealThreadId?: string | null;
    alreadyExists?: boolean;
    message?: string;
  }> {
    if (!input.reference) throw new Error('Payment reference is required to finalize order');
    if (!input.postId) throw new Error('Market post ID is required to finalize order');
    if (input.quantity <= 0) throw new Error('Invalid quantity');
    if (!input.deliveryAddress) throw new Error('Delivery address is required to finalize order');
    // Phone is optional — never block order creation after Paystack has charged.

    const dealThreadId = String(input.dealThreadId || input.chatId || '').trim() || null;
    const agreedUnitPrice =
      typeof input.agreedUnitPrice === 'number' && input.agreedUnitPrice > 0
        ? input.agreedUnitPrice
        : undefined;
    const sellerId = String(input.sellerId || '').trim() || null;
    const itemTitle = String(input.itemTitle || '').trim() || null;
    const buyerPhone = String(input.buyerPhone || '').trim();
    const lineItems = Array.isArray(input.lineItems) ? input.lineItems : undefined;
    const cartSessionId = String(input.cartSessionId || '').trim() || null;

    return coreCloudClient.request<{
      success: boolean;
      orderId: string;
      dealThreadId?: string | null;
      alreadyExists?: boolean;
      message?: string;
    }>(
      PAYMENT_FUNCTIONS.finalizeMarketEscrowPayment,
      {
        method: 'POST',
        body: {
          reference: input.reference,
          postId: input.postId,
          quantity: input.quantity,
          deliveryAddress: input.deliveryAddress,
          buyerPhone: buyerPhone || 'Not provided',
          ...(dealThreadId ? { dealThreadId, chatId: dealThreadId } : {}),
          ...(agreedUnitPrice != null ? { agreedUnitPrice } : {}),
          ...(sellerId ? { sellerId } : {}),
          ...(itemTitle ? { itemTitle } : {}),
          ...(lineItems?.length ? { lineItems } : {}),
          ...(cartSessionId ? { cartSessionId } : {}),
        },
        requiresAuth: true,
      }
    );
  },
};
