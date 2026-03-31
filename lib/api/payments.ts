import { coreCloudClient } from './core-cloud-client';

const PAYMENT_FUNCTIONS = {
  initializePaystackTransaction: 'https://initializepaystacktransaction-q3rjv54uka-uc.a.run.app',
  verifyPaystackTransaction: 'https://verifypaystacktransaction-q3rjv54uka-uc.a.run.app',
  paystackWebhook: 'https://paystackwebhook-q3rjv54uka-uc.a.run.app',
  verifyPaymentAndCreateOrder: 'https://verifypaymentandcreateorder-q3rjv54uka-uc.a.run.app',
  findRecentTransactionByEmail: 'https://findrecenttransactionbyemail-q3rjv54uka-uc.a.run.app',
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

function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}

function buildDefaultReference(): string {
  return `ikm_escrow_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const verification = await coreCloudClient.request<any>(PAYMENT_FUNCTIONS.verifyPaystackTransaction, {
          method: 'POST',
          body: {
            reference: normalizedReference,
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
          if (
            finalMessage.includes('payment not successful') ||
            finalMessage.includes('abandoned') ||
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
};

