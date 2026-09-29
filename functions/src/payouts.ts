import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Seller payouts via Paystack Transfers.
 *
 * The payout rail is fully automatic:
 *
 *   seller requests payout  ->  transfer recipient (cached per bank account)
 *                           ->  POST /transfer
 *                           ->  transfer.* webhook marks the payout final
 *
 * Nothing in this path requires a human. Paystack requires a one-time account
 * setting ("Disable OTP for transfers") for transfers to complete without an
 * OTP; when that setting is off, Paystack returns `status: 'otp'` and the
 * transfer waits at `pending_otp` until `finalizePayoutTransfer` is called.
 *
 * All amounts cross the Paystack boundary as integer kobo.
 */

const PAYSTACK_BASE = 'https://api.paystack.co';

export type PayoutStatus =
  | 'pending'
  | 'pending_otp'
  | 'completed'
  | 'failed'
  | 'reversed'
  | 'cancelled';

export interface SellerBankDetails {
  bankName?: string;
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
  recipientCode?: string;
}

export interface PayoutInitiationResult {
  ok: boolean;
  payoutId: string;
  status: PayoutStatus;
  transferCode?: string;
  reference: string;
  message?: string;
  requiresOtp?: boolean;
}

export function toKobo(amountNgn: number): number {
  return Math.round(Number(amountNgn) * 100);
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

async function paystackRequest(
  path: string,
  secretKey: string,
  init: { method: 'GET' | 'POST'; body?: unknown }
): Promise<{ ok: boolean; httpStatus: number; data: any }> {
  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  let parsed: any = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  return {
    ok: response.ok && parsed?.status !== false,
    httpStatus: response.status,
    data: parsed,
  };
}

/**
 * Resolve the recipient code for a seller's bank details.
 *
 * Paystack resolves the account name itself; that resolved name is what gets
 * stored, because it is the authoritative one and it is what a payout later
 * pays into. Creating a recipient per payout would work but leaks recipients,
 * so the code is cached on the user document.
 */
export async function getOrCreateTransferRecipient(input: {
  sellerId: string;
  bankDetails: SellerBankDetails;
  secretKey: string;
}): Promise<{ ok: boolean; recipientCode?: string; accountName?: string; message?: string }> {
  const { sellerId, bankDetails, secretKey } = input;
  const cached = asString(bankDetails.recipientCode);
  if (cached) {
    return { ok: true, recipientCode: cached, accountName: asString(bankDetails.accountName) };
  }

  const accountNumber = asString(bankDetails.accountNumber);
  const bankCode = asString(bankDetails.bankCode);
  if (!accountNumber || !bankCode) {
    return { ok: false, message: 'Bank account number and bank code are required' };
  }

  const resolved = await paystackRequest(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    secretKey,
    { method: 'GET' }
  );

  if (!resolved.ok || !resolved.data?.data?.account_name) {
    return {
      ok: false,
      message: asString(resolved.data?.message) || 'Could not resolve the bank account',
    };
  }

  const resolvedName = asString(resolved.data.data.account_name);

  const created = await paystackRequest('/transferrecipient', secretKey, {
    method: 'POST',
    body: {
      type: 'nuban',
      name: resolvedName,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
      description: `ChatCart seller ${sellerId}`,
      metadata: { sellerId },
    },
  });

  const recipientCode = asString(created.data?.data?.recipient_code);
  if (!created.ok || !recipientCode) {
    return {
      ok: false,
      message: asString(created.data?.message) || 'Could not create a transfer recipient',
    };
  }

  await admin.firestore().collection('users').doc(sellerId).set(
    {
      payoutDetails: {
        ...bankDetails,
        accountName: resolvedName,
        recipientCode,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, recipientCode, accountName: resolvedName };
}

/**
 * Send a payout as a Paystack transfer.
 *
 * The payout document is created first by the caller, so a failure here is
 * recorded on a real record rather than lost. The Paystack transfer reference is
 * derived from the payout id, which makes a retry idempotent on Paystack's side.
 */
export async function initiatePayoutTransfer(input: {
  payoutId: string;
  sellerId: string;
  amountNgn: number;
  secretKey: string;
  reason?: string;
}): Promise<PayoutInitiationResult> {
  const { payoutId, sellerId, amountNgn, secretKey } = input;
  const firestore = admin.firestore();
  const payoutRef = firestore.collection('payouts').doc(payoutId);
  const reference = `payout_${payoutId}`;

  const userSnap = await firestore.collection('users').doc(sellerId).get();
  const bankDetails = (userSnap.data()?.payoutDetails || {}) as SellerBankDetails;

  const recipient = await getOrCreateTransferRecipient({ sellerId, bankDetails, secretKey });
  if (!recipient.ok || !recipient.recipientCode) {
    const message = recipient.message || 'No payable bank account for this seller';
    await payoutRef.set(
      {
        status: 'failed',
        failureReason: message,
        reference,
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, payoutId, status: 'failed', reference, message };
  }

  const transfer = await paystackRequest('/transfer', secretKey, {
    method: 'POST',
    body: {
      source: 'balance',
      amount: toKobo(amountNgn),
      recipient: recipient.recipientCode,
      reason: input.reason || 'ChatCart seller payout',
      reference,
    },
  });

  const transferData = transfer.data?.data || {};
  const transferCode = asString(transferData.transfer_code);
  const gatewayStatus = asString(transferData.status).toLowerCase();

  if (!transfer.ok && gatewayStatus !== 'otp') {
    const message = asString(transfer.data?.message) || 'Paystack rejected the transfer';
    await payoutRef.set(
      {
        status: 'failed',
        failureReason: message,
        reference,
        transferCode: transferCode || null,
        recipientCode: recipient.recipientCode,
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, payoutId, status: 'failed', reference, transferCode, message };
  }

  // Paystack asks for an OTP when the account setting is still on. The transfer
  // exists and is waiting; it is not a failure.
  if (gatewayStatus === 'otp') {
    await payoutRef.set(
      {
        status: 'pending_otp',
        reference,
        transferCode: transferCode || null,
        recipientCode: recipient.recipientCode,
        accountName: recipient.accountName || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      ok: true,
      payoutId,
      status: 'pending_otp',
      reference,
      transferCode,
      requiresOtp: true,
      message: 'Paystack requires an OTP to release this transfer',
    };
  }

  await payoutRef.set(
    {
      status: 'pending',
      reference,
      transferCode: transferCode || null,
      recipientCode: recipient.recipientCode,
      accountName: recipient.accountName || null,
      gatewayStatus: gatewayStatus || null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, payoutId, status: 'pending', reference, transferCode };
}

/**
 * Complete a transfer Paystack is holding for an OTP.
 * Only reachable when the account still has transfer OTP enabled.
 */
export async function finalizePayoutTransfer(input: {
  payoutId: string;
  otp: string;
  secretKey: string;
}): Promise<{ ok: boolean; message?: string }> {
  const firestore = admin.firestore();
  const payoutRef = firestore.collection('payouts').doc(input.payoutId);
  const payoutSnap = await payoutRef.get();
  if (!payoutSnap.exists) return { ok: false, message: 'Payout not found' };

  const transferCode = asString(payoutSnap.data()?.transferCode);
  if (!transferCode) return { ok: false, message: 'This payout has no pending transfer' };

  const result = await paystackRequest('/transfer/finalize_transfer', input.secretKey, {
    method: 'POST',
    body: { transfer_code: transferCode, otp: asString(input.otp) },
  });

  if (!result.ok) {
    return {
      ok: false,
      message: asString(result.data?.message) || 'Paystack rejected the OTP',
    };
  }

  await payoutRef.set(
    {
      status: 'pending',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
}

type TransferOutcome = 'success' | 'failed' | 'reversed' | 'pending' | 'unknown';

function classifyTransferEvent(event: string, status: string): TransferOutcome {
  const normalizedEvent = event.toLowerCase();
  const normalizedStatus = status.toLowerCase();

  if (normalizedEvent === 'transfer.success' || normalizedStatus === 'success') return 'success';
  if (normalizedEvent === 'transfer.failed' || normalizedStatus === 'failed') return 'failed';
  if (normalizedEvent === 'transfer.reversed' || normalizedStatus === 'reversed') return 'reversed';
  if (normalizedStatus === 'pending' || normalizedStatus === 'otp' || normalizedStatus === 'processing') {
    return 'pending';
  }
  return 'unknown';
}

/**
 * Apply a Paystack transfer webhook to the payout record.
 *
 * The payout is located by its own id, which is embedded in the transfer
 * reference (`payout_<id>`), so a webhook needs no extra lookup table.
 */
export async function handleTransferWebhookEvent(event: string, data: any): Promise<void> {
  const firestore = admin.firestore();
  const reference = asString(data?.reference);
  const transferCode = asString(data?.transfer_code);
  const gatewayStatus = asString(data?.status);

  let payoutId = reference.startsWith('payout_') ? reference.slice('payout_'.length) : '';
  let payoutRef = payoutId ? firestore.collection('payouts').doc(payoutId) : null;

  if (payoutRef) {
    const snap = await payoutRef.get();
    if (!snap.exists) payoutRef = null;
  }

  if (!payoutRef) {
    const byCode = transferCode
      ? await firestore.collection('payouts').where('transferCode', '==', transferCode).limit(1).get()
      : null;
    if (byCode && !byCode.empty) {
      payoutRef = byCode.docs[0].ref;
      payoutId = byCode.docs[0].id;
    }
  }

  if (!payoutRef) {
    console.warn('Transfer webhook: no payout for', reference || transferCode);
    return;
  }

  const outcome = classifyTransferEvent(event, gatewayStatus);

  if (outcome === 'success') {
    await payoutRef.set(
      {
        status: 'completed',
        gatewayStatus,
        transferCode: transferCode || null,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  if (outcome === 'failed' || outcome === 'reversed') {
    await payoutRef.set(
      {
        status: outcome === 'reversed' ? 'reversed' : 'failed',
        gatewayStatus,
        transferCode: transferCode || null,
        failureReason: asString(data?.message) || `Paystack reported ${event}`,
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  await payoutRef.set(
    {
      status: 'pending',
      gatewayStatus: gatewayStatus || null,
      transferCode: transferCode || null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
