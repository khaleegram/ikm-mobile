import crypto from 'node:crypto';
import { config, isPaystackConfigured } from './config.mjs';

/**
 * Paystack client for chatcart-api.
 *
 * Two rules hold everywhere in the money layer:
 *
 *   1. Amounts cross the Paystack boundary as **integer kobo**. Never floats.
 *   2. Failure is explicit. A gateway call either returns data or throws with a
 *      status; callers never have to guess whether money moved.
 */

export class PaystackError extends Error {
  constructor(message, { statusCode = 502, code = null, httpStatus = null, body = null } = {}) {
    super(message);
    this.name = 'PaystackError';
    this.statusCode = statusCode;
    this.code = code;
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

function assertConfigured() {
  if (!isPaystackConfigured()) {
    throw new PaystackError('PAYSTACK_SECRET_KEY is not configured on the API', {
      statusCode: 503,
      code: 'paystack_not_configured',
    });
  }
}

/** Naira -> integer kobo. Rounds half-up, which is the documented money rule. */
export function toKobo(amountNgn) {
  const value = Number(amountNgn);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** Integer kobo -> naira as a number. Only for display; never for arithmetic. */
export function fromKobo(kobo) {
  return Number(kobo) / 100;
}

/**
 * Paystack's charge for a given charged amount, in kobo.
 *
 * 1.5% + NGN 100, capped at NGN 2,000. The flat fee is waived when the charged
 * amount is under NGN 2,500 — keyed to the **charge**, not the item price.
 */
export function paystackFeeKobo(chargeKobo) {
  const charge = Math.max(0, Math.round(Number(chargeKobo) || 0));
  const percentFee = Math.round((charge * config.paystackFeePercent) / 100);

  if (charge < config.paystackFeeWaiverKobo) {
    return percentFee;
  }

  return Math.min(percentFee + config.paystackFeeFlatKobo, config.paystackFeeCapKobo);
}

/**
 * The buyer's charge that makes Paystack's fee exactly covered by the protection
 * line, in kobo. Solved in the same three regimes the fee function defines.
 *
 *   protection = charge - item, so charge must satisfy fee(charge) = charge - item
 *
 * Rounding is ceiling: protection must never fall a kobo short of the real fee.
 */
export function protectionForItemKobo(itemKobo) {
  const item = Math.max(0, Math.round(Number(itemKobo) || 0));
  const { paystackFeeWaiverKobo: waiver, paystackFeeCapKobo: cap } = config;

  // Regime A: no flat fee, so charge = item / (1 - rate).
  const rate = config.paystackFeePercent / 100;
  const noFlatCharge = Math.ceil(item / (1 - rate));
  if (noFlatCharge < waiver) {
    return { chargeKobo: noFlatCharge, protectionKobo: noFlatCharge - item };
  }

  // Regime B: flat fee applies, charge = (item + flat) / (1 - rate).
  const withFlatCharge = Math.ceil((item + config.paystackFeeFlatKobo) / (1 - rate));
  if (paystackFeeKobo(withFlatCharge) < cap) {
    return { chargeKobo: withFlatCharge, protectionKobo: withFlatCharge - item };
  }

  // Regime C: the cap binds, so protection is flat.
  const cappedCharge = item + cap;
  return { chargeKobo: cappedCharge, protectionKobo: cap };
}

/**
 * Constant-time verification of `x-paystack-signature` against the **raw** body.
 * Paystack signs the bytes it sent; a re-serialised object will not match.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!isPaystackConfigured()) return false;
  const provided = String(signatureHeader || '').trim();
  if (!provided || !rawBody) return false;

  const expected = crypto
    .createHmac('sha512', config.paystackSecretKey)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Call the Paystack API.
 *
 * Returns `data` from the envelope. Throws `PaystackError` on transport failure,
 * non-2xx, or `status: false` in the body — so a caller that receives a value
 * always has a gateway response, never an ambiguous one.
 */
export async function paystackRequest(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  assertConfigured();

  const url = `${config.paystackBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new PaystackError(
      error?.name === 'AbortError'
        ? `Paystack request timed out after ${timeoutMs}ms`
        : `Paystack request failed: ${error?.message || error}`,
      { statusCode: 504, code: 'paystack_unreachable' }
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.status === false) {
    throw new PaystackError(
      payload?.message || `Paystack returned HTTP ${response.status}`,
      {
        statusCode: response.status >= 400 && response.status < 500 ? 400 : 502,
        code: payload?.code || null,
        httpStatus: response.status,
        body: payload,
      }
    );
  }

  return payload?.data ?? null;
}

// ─── Transfers (payouts) ───────────────────────────────────────────────────

export async function resolveBankAccount(accountNumber, bankCode) {
  const query = new URLSearchParams({
    account_number: String(accountNumber || '').trim(),
    bank_code: String(bankCode || '').trim(),
  });
  return paystackRequest(`/bank/resolve?${query.toString()}`);
}

export async function listBanks(country = 'nigeria') {
  const banks = await paystackRequest(`/bank?country=${encodeURIComponent(country)}`);
  return (Array.isArray(banks) ? banks : [])
    .map((bank) => ({ code: bank.code, name: bank.name, id: bank.id }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function createTransferRecipient({
  name,
  accountNumber,
  bankCode,
  description,
  metadata,
}) {
  return paystackRequest('/transferrecipient', {
    method: 'POST',
    body: {
      type: 'nuban',
      name,
      account_number: String(accountNumber || '').trim(),
      bank_code: String(bankCode || '').trim(),
      currency: 'NGN',
      description,
      metadata,
    },
  });
}

/**
 * Initiate a transfer. `reference` must be stable per payout so a retry is not
 * treated as a second transfer.
 */
export async function initiateTransfer({
  amountKobo,
  recipientCode,
  reason,
  reference,
}) {
  return paystackRequest('/transfer', {
    method: 'POST',
    body: {
      source: 'balance',
      amount: Math.round(Number(amountKobo) || 0),
      recipient: recipientCode,
      reason,
      reference,
    },
  });
}

export async function finalizeTransfer({ transferCode, otp }) {
  return paystackRequest('/transfer/finalize_transfer', {
    method: 'POST',
    body: { transfer_code: transferCode, otp: String(otp || '').trim() },
  });
}

export async function verifyTransfer(reference) {
  return paystackRequest(`/transfer/verify/${encodeURIComponent(reference)}`);
}

// ─── Charges ───────────────────────────────────────────────────────────────

export async function initializeTransaction({
  amountKobo,
  email,
  callbackUrl,
  metadata,
  reference,
}) {
  return paystackRequest('/transaction/initialize', {
    method: 'POST',
    body: {
      amount: Math.round(Number(amountKobo) || 0),
      email,
      callback_url: callbackUrl,
      metadata,
      ...(reference ? { reference } : {}),
    },
  });
}

export async function verifyTransaction(reference) {
  return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
}

export async function refundTransaction({ transactionReference, amountKobo, merchantNote }) {
  return paystackRequest('/refund', {
    method: 'POST',
    body: {
      transaction: transactionReference,
      ...(amountKobo ? { amount: Math.round(Number(amountKobo)) } : {}),
      ...(merchantNote ? { merchant_note: merchantNote } : {}),
    },
  });
}

/**
 * Transfer fee Paystack charges on a payout, in kobo, excluding stamp duty.
 * Per the account schedule: NGN 10 up to 5,000, NGN 25 up to 50,000, NGN 50 above.
 */
export function transferFeeKobo(amountKobo) {
  const amount = Math.max(0, Math.round(Number(amountKobo) || 0));
  if (amount <= 500000) return 1000;
  if (amount <= 5000000) return 2500;
  return 5000;
}

/**
 * Nigerian stamp duty on an outgoing transfer of NGN 10,000 or more, in kobo.
 * Nigeria Tax Act 2025, in force from 1 January 2026; the sender bears it.
 */
export function stampDutyKobo(amountKobo) {
  const amount = Math.max(0, Math.round(Number(amountKobo) || 0));
  return amount >= 1000000 ? 5000 : 0;
}

export function payoutCostKobo(amountKobo) {
  return transferFeeKobo(amountKobo) + stampDutyKobo(amountKobo);
}

// ─── Account ───────────────────────────────────────────────────────────────

/**
 * The live Paystack balance, in kobo.
 *
 * Spec §6.3 makes the promo budget a *reserved balance* rather than an accounting
 * figure, because transfers draw from this balance — so the check that matters is
 * against real money, not against a number in a table.
 */
export async function fetchBalance() {
  const balances = await paystackRequest('/balance');
  const list = Array.isArray(balances) ? balances : [];
  const ngn = list.find((entry) => String(entry?.currency).toUpperCase() === 'NGN') || list[0];
  if (!ngn) {
    throw new PaystackError('Paystack returned no NGN balance for this account', {
      statusCode: 502,
      code: 'no_balance',
    });
  }
  return {
    currency: String(ngn.currency || 'NGN').toUpperCase(),
    balanceKobo: Math.round(Number(ngn.balance) || 0),
  };
}
