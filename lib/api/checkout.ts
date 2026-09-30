import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';

/**
 * Checkout against `chatcart-api`.
 *
 * Two things make this different from the Firebase checkout it replaces:
 *
 *  1. **The server prices the order.** Nothing here computes a total. The cart is
 *     sent, the server returns the breakdown, and the same function that produced
 *     that breakdown builds the charge — so the number on screen is the number taken.
 *  2. **The cart is sent, not the amount.** There is no amount field to send, which
 *     is deliberate: an amount the client can edit is an amount a buyer can edit.
 */

export type CheckoutCartItem = {
  id: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
};

/** A money line, in kobo. The server always speaks kobo. */
export type CheckoutDisplay = {
  itemsKobo: number;
  discountKobo: number;
  protectionKobo: number;
  shippingKobo: number;
  totalKobo: number;
  code: string | null;
  campaignName: string | null;
};

export type CheckoutTotals = {
  itemsSubtotalKobo: number;
  discountKobo: number;
  protectionKobo: number;
  shippingKobo: number;
  buyerTotalKobo: number;
  commissionKobo: number;
  sellerPayoutKobo: number;
  platformLiabilityKobo: number;
};

export type CheckoutQuote =
  | {
      eligible: true;
      chargeable: boolean;
      reason: string | null;
      display: CheckoutDisplay;
      promo: {
        code: string | null;
        name: string | null;
        message: string;
        requiresTicket: boolean;
        discountKobo: number;
      } | null;
      totals: CheckoutTotals;
    }
  | {
      eligible: false;
      promo: { code: string | null; message: string } | null;
    };

export type InitializeCheckoutInput = {
  cartItems: CheckoutCartItem[];
  email: string;
  callbackUrl: string;
  reference?: string;
  code?: string | null;
  shippingPrice?: number;
  deliveryFeePaidBy?: string | null;
  deliveryAddress?: string;
  customerInfo?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type InitializeCheckoutResult = {
  success: boolean;
  authorizationUrl?: string;
  accessCode?: string;
  reference: string;
  amount: number;
  amountKobo: number;
  pricing: CheckoutDisplay | null;
  promo: { code: string | null; name: string | null; message: string } | null;
};

export type FinalizeCheckoutInput = {
  reference: string;
  cartItems: CheckoutCartItem[];
  total: number;
  code?: string | null;
  shippingPrice?: number;
  deliveryFeePaidBy?: string | null;
  deliveryAddress?: string;
  customerInfo?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type FinalizeCheckoutResult = {
  success: boolean;
  created: { orderId: string; sellerId: string; total: number; alreadyExists: boolean }[];
  orderId: string | null;
  orderIds: string[];
  alreadyExists: boolean;
  pricing?: { display: CheckoutDisplay | null } | null;
  message?: string;
};

/** The buyer's breakdown, without charging anything. Safe to call as they type. */
export async function quoteCheckoutCart(input: {
  cartItems: CheckoutCartItem[];
  shippingPrice?: number;
  code?: string | null;
}): Promise<CheckoutQuote> {
  return coreCloudClient.request<CheckoutQuote>(apiUrl('/checkout/quote'), {
    method: 'POST',
    requiresAuth: true,
    body: {
      cartItems: input.cartItems,
      shippingPrice: input.shippingPrice ?? 0,
      code: input.code || null,
    },
  });
}

/**
 * The offers live right now.
 *
 * Unauthenticated on purpose: the sheet has to show the real, current offer before
 * anyone signs in, and it must be whatever the operator configured rather than a
 * value baked into the app.
 */
export async function listLivePromoCodes(): Promise<
  {
    code: string;
    name: string;
    description?: string | null;
    display?: { headline: string; summary: string; conditions: string[] };
    endsAt?: string | null;
  }[]
> {
  try {
    const response = await coreCloudClient.request<{ success: boolean; campaigns: any[] }>(
      apiUrl('/promo/campaigns'),
      { method: 'GET' }
    );
    return Array.isArray(response.campaigns) ? response.campaigns : [];
  } catch {
    // A shelf of offers is not worth failing checkout over — the code field still
    // works without it.
    return [];
  }
}

export async function initializeCheckout(
  input: InitializeCheckoutInput
): Promise<InitializeCheckoutResult> {
  return coreCloudClient.request<InitializeCheckoutResult>(apiUrl('/payments/initialize'), {
    method: 'POST',
    requiresAuth: true,
    body: {
      email: input.email,
      callbackUrl: input.callbackUrl,
      reference: input.reference,
      cartItems: input.cartItems,
      promoCode: input.code || null,
      shippingPrice: input.shippingPrice ?? 0,
      deliveryFeePaidBy: input.deliveryFeePaidBy ?? null,
      deliveryAddress: input.deliveryAddress,
      customerInfo: input.customerInfo,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export async function finalizeCheckoutOrder(
  input: FinalizeCheckoutInput
): Promise<FinalizeCheckoutResult> {
  return coreCloudClient.request<FinalizeCheckoutResult>(apiUrl('/payments/checkout/finalize'), {
    method: 'POST',
    requiresAuth: true,
    body: {
      reference: input.reference,
      cartItems: input.cartItems,
      total: input.total,
      shippingPrice: input.shippingPrice ?? 0,
      deliveryFeePaidBy: input.deliveryFeePaidBy ?? null,
      deliveryAddress: input.deliveryAddress,
      customerInfo: input.customerInfo,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export type ChargeTruth = {
  reference: string;
  status: string;
  paid: boolean;
  /** The gateway will never settle this reference; a new payment is safe. */
  terminalUnpaid: boolean;
  amount?: number;
  amountNgn?: number;
  currency?: string;
  paidAt?: string | null;
};

/**
 * What the gateway says about a reference.
 *
 * Read from the API's own record of the charge rather than by asking Paystack
 * directly: the record is written from the webhook too, so it knows about a charge
 * that was paid while the app was dead — which is exactly when this matters.
 */
export async function inspectCharge(reference: string): Promise<ChargeTruth> {
  const response = await coreCloudClient.request<{ success: boolean; transaction: any }>(
    apiUrl(`/payments/transactions/${encodeURIComponent(reference)}`),
    { method: 'GET', requiresAuth: true }
  );
  const row = response.transaction || {};
  const status = String(row.status || '').toLowerCase();
  return {
    reference: String(row.reference || reference),
    status,
    paid: status === 'success' || status === 'successful',
    terminalUnpaid: ['abandoned', 'failed', 'reversed', 'declined'].includes(status),
    amount: Number(row.amount) || undefined,
    amountNgn: Number(row.amount) || undefined,
    currency: row.currency || 'NGN',
    paidAt: row.paid_at || null,
  };
}

/** Kobo to a display string. Every money value in checkout is kobo. */
export function formatKobo(kobo: number): string {
  const naira = Math.round(Number(kobo) || 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
