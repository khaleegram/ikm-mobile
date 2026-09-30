import { pool } from './db.mjs';
import {
  PaystackError,
  createTransferRecipient,
  finalizeTransfer,
  initiateTransfer,
  resolveBankAccount,
  toKobo,
} from './paystack.mjs';

/**
 * Seller payouts via Paystack Transfers.
 *
 * The rail is fully automatic:
 *
 *   seller requests payout  ->  transfer recipient (cached per bank account)
 *                           ->  POST /transfer
 *                           ->  transfer.* webhook marks the payout final
 *
 * Nothing here needs a human. Paystack requires a one-time account setting
 * ("Disable OTP for transfers") for transfers to complete without an OTP; when it
 * is off, Paystack returns `status: 'otp'` and the transfer waits at
 * `pending_otp` until `finalizePayoutTransfer` is called.
 *
 * Payout amounts are stored in naira (NUMERIC) and cross the Paystack boundary as
 * integer kobo.
 */

export const PAYOUT_PENDING = 'pending';
export const PAYOUT_PENDING_OTP = 'pending_otp';
export const PAYOUT_COMPLETED = 'completed';
export const PAYOUT_FAILED = 'failed';
export const PAYOUT_REVERSED = 'reversed';
export const PAYOUT_CANCELLED = 'cancelled';

/** States that mean money has been committed and cannot be cancelled. */
export const PAYOUT_IN_FLIGHT = [PAYOUT_PENDING, PAYOUT_PENDING_OTP];

function str(value) {
  return String(value ?? '').trim();
}

/**
 * Resolve the recipient code for a seller's bank details.
 *
 * The account name Paystack resolves is stored, because it is authoritative and it
 * is what a payout later pays into. The recipient code is cached on the user so a
 * seller does not accumulate a new recipient per payout.
 */
export async function getOrCreateTransferRecipient({ sellerId, bankDetails }) {
  const cached = str(bankDetails?.recipientCode);
  const accountNumber = str(bankDetails?.accountNumber);
  const bankCode = str(bankDetails?.bankCode);

  if (!accountNumber || !bankCode) {
    return { ok: false, message: 'Bank account number and bank code are required' };
  }

  const resolved = await resolveBankAccount(accountNumber, bankCode).catch((error) => {
    throw new PaystackError(error?.message || 'Could not resolve the bank account', {
      statusCode: 400,
      code: error?.code,
    });
  });

  const resolvedName = str(resolved?.account_name);
  if (!resolvedName) {
    return { ok: false, message: 'Paystack did not return an account name' };
  }

  // Reuse the cached code, but only while the resolved name still matches what is
  // stored — a seller can change bank details, and paying an old recipient would
  // send money to the wrong account.
  if (cached) {
    const { rows } = await pool.query(
      `SELECT payout_details->>'accountName' AS stored_name FROM users WHERE id = $1`,
      [sellerId]
    );
    if (str(rows[0]?.stored_name) === resolvedName) {
      return { ok: true, recipientCode: cached, accountName: resolvedName };
    }
  }

  const created = await createTransferRecipient({
    name: resolvedName,
    accountNumber,
    bankCode,
    description: `ChatCart seller ${sellerId}`,
    metadata: { sellerId },
  });

  const recipientCode = str(created?.recipient_code);
  if (!recipientCode) {
    return { ok: false, message: 'Paystack did not return a recipient code' };
  }

  return { ok: true, recipientCode, accountName: resolvedName };
}

/**
 * Send a payout as a Paystack transfer.
 *
 * The payout row must exist before this is called, so a failure is recorded on a
 * real record rather than lost. The transfer reference is derived from the payout
 * id, which makes a retry idempotent on Paystack's side.
 */
export async function initiatePayoutTransfer({ payoutId, sellerId, amountNgn }) {
  const id = str(payoutId);
  const reference = `payout_${id}`;

  const { rows: userRows } = await pool.query(
    `SELECT payout_details FROM users WHERE id = $1`,
    [sellerId]
  );
  const bankDetails = userRows[0]?.payout_details || {};

  let recipient;
  try {
    recipient = await getOrCreateTransferRecipient({ sellerId, bankDetails });
  } catch (error) {
    await markPayoutFailed(id, error?.message || 'Could not resolve the bank account', { reference });
    return { ok: false, payoutId: id, status: PAYOUT_FAILED, reference, message: error?.message };
  }

  if (!recipient.ok) {
    await markPayoutFailed(id, recipient.message, { reference });
    return { ok: false, payoutId: id, status: PAYOUT_FAILED, reference, message: recipient.message };
  }

  // Cache the recipient so subsequent payouts skip resolution.
  await pool.query(
    `UPDATE users
        SET payout_details = COALESCE(payout_details, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [
      sellerId,
      JSON.stringify({
        recipientCode: recipient.recipientCode,
        accountName: recipient.accountName,
      }),
    ]
  );

  let transfer;
  try {
    transfer = await initiateTransfer({
      amountKobo: toKobo(amountNgn),
      recipientCode: recipient.recipientCode,
      reason: 'ChatCart seller payout',
      reference,
    });
  } catch (error) {
    // A rejected transfer is a real failure. The message is Paystack's, so the
    // seller sees why (e.g. transfer_unavailable on a starter business).
    await markPayoutFailed(id, error?.message || 'Paystack rejected the transfer', {
      reference,
      recipientCode: recipient.recipientCode,
      code: error?.code,
    });
    return {
      ok: false,
      payoutId: id,
      status: PAYOUT_FAILED,
      reference,
      message: error?.message,
      code: error?.code || null,
    };
  }

  const transferCode = str(transfer?.transfer_code) || null;
  const gatewayStatus = str(transfer?.status).toLowerCase();

  // Paystack asks for an OTP when the account setting is still on. The transfer
  // exists and is waiting; it is not a failure.
  if (gatewayStatus === 'otp') {
    await pool.query(
      `UPDATE payouts
          SET status = $2, reference = $3, transfer_code = $4, recipient_code = $5,
              account_name = $6, updated_at = now()
        WHERE id = $1`,
      [
        id,
        PAYOUT_PENDING_OTP,
        reference,
        transferCode,
        recipient.recipientCode,
        recipient.accountName,
      ]
    );
    return {
      ok: true,
      payoutId: id,
      status: PAYOUT_PENDING_OTP,
      reference,
      transferCode,
      requiresOtp: true,
      message: 'Paystack requires an OTP to release this transfer',
    };
  }

  await pool.query(
    `UPDATE payouts
        SET status = $2, reference = $3, transfer_code = $4, recipient_code = $5,
            account_name = $6, gateway_status = $7, updated_at = now()
      WHERE id = $1`,
    [
      id,
      PAYOUT_PENDING,
      reference,
      transferCode,
      recipient.recipientCode,
      recipient.accountName,
      gatewayStatus || null,
    ]
  );

  return { ok: true, payoutId: id, status: PAYOUT_PENDING, reference, transferCode };
}

async function markPayoutFailed(payoutId, reason, { reference = null, recipientCode = null, code = null } = {}) {
  await pool.query(
    `UPDATE payouts
        SET status = $2, failure_reason = $3, reference = COALESCE($4, reference),
            recipient_code = COALESCE($5, recipient_code),
            gateway_status = COALESCE($6, gateway_status),
            failed_at = now(), updated_at = now()
      WHERE id = $1`,
    [payoutId, PAYOUT_FAILED, reason, reference, recipientCode, code]
  );
}

/** Complete a transfer Paystack is holding for an OTP. */
export async function finalizePayoutTransfer({ payoutId, otp }) {
  const { rows } = await pool.query(
    `SELECT transfer_code, status FROM payouts WHERE id = $1`,
    [str(payoutId)]
  );
  if (!rows.length) return { ok: false, message: 'Payout not found' };

  const transferCode = str(rows[0].transfer_code);
  if (!transferCode) return { ok: false, message: 'This payout has no pending transfer' };

  try {
    await finalizeTransfer({ transferCode, otp });
  } catch (error) {
    return { ok: false, message: error?.message || 'Paystack rejected the OTP' };
  }

  await pool.query(
    `UPDATE payouts SET status = $2, updated_at = now() WHERE id = $1`,
    [str(payoutId), PAYOUT_PENDING]
  );

  return { ok: true };
}

function classifyTransferEvent(event, status) {
  const e = str(event).toLowerCase();
  const s = str(status).toLowerCase();

  if (e === 'transfer.success' || s === 'success') return 'success';
  if (e === 'transfer.failed' || s === 'failed') return 'failed';
  if (e === 'transfer.reversed' || s === 'reversed') return 'reversed';
  if (['pending', 'otp', 'processing'].includes(s)) return 'pending';
  return 'unknown';
}

/**
 * Apply a Paystack transfer webhook to the payout row.
 *
 * The payout is located by the reference it was given (`payout_<id>`), falling back
 * to the transfer code, so a webhook needs no lookup table.
 */
export async function handleTransferWebhookEvent(event, data) {
  const reference = str(data?.reference);
  const transferCode = str(data?.transfer_code);
  const gatewayStatus = str(data?.status);

  let payout = null;

  if (reference.startsWith('payout_')) {
    const { rows } = await pool.query(`SELECT * FROM payouts WHERE id = $1`, [
      reference.slice('payout_'.length),
    ]);
    payout = rows[0] || null;
  }

  if (!payout && transferCode) {
    const { rows } = await pool.query(
      `SELECT * FROM payouts WHERE transfer_code = $1 LIMIT 1`,
      [transferCode]
    );
    payout = rows[0] || null;
  }

  if (!payout) {
    // Not an error worth failing the webhook for: Paystack retries, and an
    // unknown payout means it belongs to the other runtime during cutover.
    console.warn('Transfer webhook: no payout for', reference || transferCode);
    return { handled: false };
  }

  const outcome = classifyTransferEvent(event, gatewayStatus);

  if (outcome === 'success') {
    await pool.query(
      `UPDATE payouts
          SET status = $2, gateway_status = $3, transfer_code = COALESCE($4, transfer_code),
              completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [payout.id, PAYOUT_COMPLETED, gatewayStatus || null, transferCode || null]
    );
    return { handled: true, status: PAYOUT_COMPLETED };
  }

  if (outcome === 'failed' || outcome === 'reversed') {
    const status = outcome === 'reversed' ? PAYOUT_REVERSED : PAYOUT_FAILED;
    await pool.query(
      `UPDATE payouts
          SET status = $2, gateway_status = $3, transfer_code = COALESCE($4, transfer_code),
              failure_reason = $5, failed_at = now(), updated_at = now()
        WHERE id = $1`,
      [
        payout.id,
        status,
        gatewayStatus || null,
        transferCode || null,
        str(data?.message) || `Paystack reported ${event}`,
      ]
    );
    return { handled: true, status };
  }

  await pool.query(
    `UPDATE payouts
        SET status = $2, gateway_status = $3, transfer_code = COALESCE($4, transfer_code),
            updated_at = now()
      WHERE id = $1`,
    [payout.id, PAYOUT_PENDING, gatewayStatus || null, transferCode || null]
  );
  return { handled: true, status: PAYOUT_PENDING };
}

/** Save a seller's bank details. The recipient code is derived, never trusted. */
export async function savePayoutDetails(userId, { bankName, bankCode, accountNumber, accountName }) {
  const details = {
    bankName: str(bankName),
    bankCode: str(bankCode),
    accountNumber: str(accountNumber),
    accountName: str(accountName),
  };
  if (!details.accountNumber || !details.bankCode) {
    const err = new Error('Account number and bank code are required');
    err.statusCode = 400;
    throw err;
  }

  // Bank details changed, so any cached recipient is stale and must be dropped.
  await pool.query(
    `UPDATE users
        SET payout_details = $2::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [userId, JSON.stringify(details)]
  );

  return details;
}
