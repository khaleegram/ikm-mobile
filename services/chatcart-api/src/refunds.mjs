import { pool } from './db.mjs';
import { isEscrowReleased, roundMoney } from './escrow.mjs';
import { PaystackError, refundTransaction } from './paystack.mjs';
import { appendTimelineEvent } from './orders.mjs';

/**
 * Escrow refunds — shared by cancel, dispute, auto-cancel and the webhook.
 *
 * Refund state lives in `orders.refunds` (JSONB) and nowhere else. The Cloud
 * Functions version also wrote a `transactions` ledger row per refund and a
 * `refundStatus` flag on the order; both could disagree with the refunds array.
 * Here the array is the single source of truth and every status is derived from
 * it, so there is nothing to reconcile.
 *
 * `refund_lookups` still exists, because a Paystack refund webhook carries only a
 * transaction reference and must be mapped back to an order.
 */

const DEFAULT_COMMISSION_RATE = 0.05;

/** Refund entry states. `pending` means Paystack has not confirmed yet. */
export const REFUND_PENDING = 'pending';
export const REFUND_PROCESSED = 'processed';
export const REFUND_FAILED = 'failed';

function str(value) {
  return String(value ?? '').trim();
}

/** Timestamps inside JSONB must be JSON-safe, so ISO strings not Date objects. */
function stamp() {
  return new Date().toISOString();
}

export function newRefundId(orderId) {
  return `rf_${str(orderId).slice(0, 8)}_${Date.now().toString(36)}`;
}

function sumRefundedOrPending(refunds) {
  return roundMoney(
    (Array.isArray(refunds) ? refunds : []).reduce((sum, entry) => {
      if (entry?.status === REFUND_PROCESSED || entry?.status === REFUND_PENDING) {
        return sum + (Number(entry.amount) || 0);
      }
      return sum;
    }, 0)
  );
}

function sumProcessed(refunds) {
  return roundMoney(
    (Array.isArray(refunds) ? refunds : []).reduce(
      (sum, entry) =>
        entry?.status === REFUND_PROCESSED ? sum + (Number(entry.amount) || 0) : sum,
      0
    )
  );
}

/**
 * Derive every refund-related field from the refunds array.
 *
 * Nothing is stored separately, so these values cannot drift from the array.
 */
export function deriveRefundState(refunds, total) {
  const list = Array.isArray(refunds) ? refunds : [];
  const processed = sumProcessed(list);
  const hasPending = list.some((entry) => entry?.status === REFUND_PENDING);
  const hasFailed = list.some((entry) => entry?.status === REFUND_FAILED);
  const gross = roundMoney(Number(total) || 0);
  const fullyRefunded = gross <= 0 || processed + 0.001 >= gross;

  let refundStatus = null;
  if (fullyRefunded && gross > 0) refundStatus = 'processed';
  else if (hasPending) refundStatus = 'pending';
  else if (processed > 0) refundStatus = 'partial';
  else if (hasFailed) refundStatus = 'failed';

  return { processed, hasPending, hasFailed, fullyRefunded, refundStatus };
}

async function loadOrder(client, orderId) {
  const { rows } = await client.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  return rows[0] || null;
}

async function patchRefundEntry(orderId, refundId, patch) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await loadOrder(client, orderId);
    if (!order) {
      await client.query('ROLLBACK');
      return null;
    }

    const refunds = Array.isArray(order.refunds) ? [...order.refunds] : [];
    const idx = refunds.findIndex((entry) => entry?.id === refundId);
    if (idx < 0) {
      await client.query('ROLLBACK');
      return null;
    }

    refunds[idx] = { ...refunds[idx], ...patch };

    const { rows } = await client.query(
      `UPDATE orders SET refunds = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
      [orderId, JSON.stringify(refunds)]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Mark a refund processed and settle the order's escrow state.
 *
 * Idempotent: a refund already `processed` is left alone rather than
 * double-counted, because the webhook and the synchronous path can both land.
 */
export async function applyRefundProcessedState({
  orderId,
  refundId,
  paystackRefundId = null,
  paystackStatus = 'processed',
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await loadOrder(client, orderId);
    if (!order) {
      await client.query('ROLLBACK');
      return null;
    }

    const refunds = Array.isArray(order.refunds) ? [...order.refunds] : [];
    const idx = refunds.findIndex((entry) => entry?.id === refundId);

    if (idx >= 0 && refunds[idx].status !== REFUND_PROCESSED) {
      refunds[idx] = {
        ...refunds[idx],
        status: REFUND_PROCESSED,
        paystackRefundId,
        paystackStatus,
        processedAt: stamp(),
        error: null,
      };
    }

    const total = roundMoney(Number(order.total) || 0);
    const { fullyRefunded, processed } = deriveRefundState(refunds, total);

    // Escrow settles once the money is fully back to the buyer, or once the order
    // is cancelled — a cancelled order must not stay withdrawable.
    const escrowStatus =
      fullyRefunded || str(order.status) === 'Cancelled' ? 'refunded' : 'held';

    const { rows } = await client.query(
      `UPDATE orders
          SET refunds = $2::jsonb,
              escrow_status = $3,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [orderId, JSON.stringify(refunds), escrowStatus]
    );

    await client.query('COMMIT');
    return { order: rows[0], processed, fullyRefunded };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Best-effort side effects. A failed notification must never fail a refund. */
async function refundSideEffects({ order, customText, event, status, text }) {
  const threadId = str(order?.deal_thread_id) || null;
  const orderId = str(order?.id);

  try {
    if (threadId && customText) {
      const { appendSystemEvent } = await import('./chat.mjs');
      await appendSystemEvent({ threadId, orderId, event, text: customText });
    }
  } catch (error) {
    console.error('Refund system message failed', orderId, error?.message);
  }

  try {
    await appendTimelineEvent({
      orderId,
      event,
      status: status || str(order?.status),
      text,
      actorId: 'system',
      actorRole: 'system',
    });
  } catch (error) {
    console.error('Refund timeline event failed', orderId, error?.message);
  }
}

async function markRefundFailed(orderId, refundId, error) {
  await patchRefundEntry(orderId, refundId, {
    status: REFUND_FAILED,
    paystackStatus: 'failed',
    error,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await loadOrder(client, orderId);
    if (order) {
      const refunds = Array.isArray(order.refunds) ? order.refunds : [];
      // A failed refund does not move escrow: the money never left.
      const { fullyRefunded } = deriveRefundState(refunds, order.total);
      await client.query(
        `UPDATE orders SET escrow_status = $2, updated_at = now() WHERE id = $1`,
        [orderId, fullyRefunded ? 'refunded' : 'refund_pending']
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }

  refundSideEffects({
    order: { id: orderId },
    event: 'refund_failed',
    status: 'Cancelled',
    text: `Refund needs attention: ${error}. Support can retry the refund.`,
    customText: `Refund needs attention: ${error}. Support can retry the refund.`,
  }).catch(() => {});
}

/**
 * Initiate, or idempotently resume, a refund for an escrow order.
 *
 * The claim is written in a transaction; the Paystack call happens outside it, so
 * a slow gateway never holds a database lock.
 */
export async function processOrderRefund(input) {
  const orderId = str(input?.orderId);
  if (!orderId) throw new Error('orderId is required');

  const reason = str(input?.reason) || 'Order cancelled';
  const cancelOrder = input?.cancelOrder !== false;

  const client = await pool.connect();
  let claim;
  try {
    await client.query('BEGIN');
    const order = await loadOrder(client, orderId);
    if (!order) {
      await client.query('ROLLBACK');
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    const escrowStatus = str(order.escrow_status) || 'held';
    const refunds = Array.isArray(order.refunds) ? [...order.refunds] : [];
    const paymentRef = str(order.payment_reference) || str(order.paystack_reference);
    const total = roundMoney(Number(order.total) || 0);
    // The rate the engine actually charged, when the order was priced in kobo. The
    // `commission_rate` float can disagree with `commission_bps` for a tiered order —
    // and a refund that splits commission on the wrong rate under- or over-pays the
    // seller by a few kobo every time.
    const bpsRaw = Number(order.commission_bps);
    const rateRaw = Number.isFinite(bpsRaw) && bpsRaw >= 0
      ? bpsRaw / 10000
      : Number(order.commission_rate);
    const rate = Number.isFinite(rateRaw) && rateRaw >= 0 ? rateRaw : DEFAULT_COMMISSION_RATE;

    // isEscrowReleased also covers the legacy 'completed' value free orders used.
    if (isEscrowReleased(escrowStatus)) {
      await client.query('ROLLBACK');
      const err = new Error(
        'Cannot refund: escrow already released to the seller. Open a dispute or contact support.'
      );
      err.code = 'ESCROW_RELEASED';
      err.statusCode = 400;
      throw err;
    }

    const { processed } = deriveRefundState(refunds, total);

    if (escrowStatus === 'refunded') {
      await client.query('ROLLBACK');
      return {
        success: true,
        escrowStatus,
        refundId: refunds.find((r) => r.status === REFUND_PROCESSED)?.id,
        mode: 'idempotent',
        message: 'Refund already in progress or completed',
      };
    }

    const pending = refunds.find((entry) => entry?.status === REFUND_PENDING);
    if (escrowStatus === 'refund_pending' && pending && !input?.isRetry) {
      await client.query('ROLLBACK');
      return {
        success: true,
        escrowStatus,
        refundId: pending.id,
        mode: 'idempotent',
        message: 'Refund already in progress or completed',
        paystackRefundId: pending.paystackRefundId ?? null,
      };
    }

    // On retry, a failed (or pending-without-a-Paystack-id) entry is reusable
    // rather than creating a duplicate claim.
    const reusableIdx = input?.isRetry
      ? [...refunds]
          .map((entry, index) => ({ entry, index }))
          .reverse()
          .find(
            ({ entry }) =>
              entry?.status === REFUND_FAILED ||
              (entry?.status === REFUND_PENDING && !entry?.paystackRefundId)
          )?.index ?? -1
      : -1;

    const committed = sumRefundedOrPending(
      refunds.filter((entry, index) => {
        if (index === reusableIdx) return false;
        return entry?.status === REFUND_PROCESSED || entry?.status === REFUND_PENDING;
      })
    );
    const remaining = roundMoney(Math.max(0, total - committed));

    if (remaining <= 0 && total > 0) {
      await client.query('ROLLBACK');
      return {
        success: true,
        escrowStatus: escrowStatus === 'refund_pending' ? 'refund_pending' : 'refunded',
        refundId: pending?.id,
        mode: 'idempotent',
        message: 'Refund already in progress or completed',
      };
    }

    let amount =
      input?.amountNgn != null ? roundMoney(Number(input.amountNgn)) : remaining;
    if (!(amount > 0) && total > 0) {
      await client.query('ROLLBACK');
      const err = new Error('Refund amount must be greater than zero');
      err.statusCode = 400;
      throw err;
    }
    if (amount > remaining) amount = remaining;

    const refundId = reusableIdx >= 0 ? refunds[reusableIdx].id : newRefundId(orderId);
    const sellerAmount = roundMoney(amount * (1 - rate));
    const commissionAmount = roundMoney(amount - sellerAmount);

    const isFreeOrder = total <= 0;
    const entry = {
      id: refundId,
      orderId,
      amount,
      reason,
      refundMethod: paymentRef ? 'original_payment' : 'manual',
      status: isFreeOrder ? REFUND_PROCESSED : REFUND_PENDING,
      processedBy: input?.actorId || null,
      createdAt: reusableIdx >= 0 ? refunds[reusableIdx].createdAt : stamp(),
      processedAt: isFreeOrder ? stamp() : undefined,
      transactionReference: paymentRef || null,
      paystackRefundId: null,
      paystackStatus: isFreeOrder || !paymentRef ? 'skipped' : 'initiating',
      sellerAmount,
      commissionAmount,
      error: paymentRef ? null : 'Missing payment reference — manual refund required',
    };

    const nextRefunds =
      reusableIdx >= 0
        ? refunds.map((existing, index) => (index === reusableIdx ? entry : existing))
        : [...refunds, entry];

    // A free order is settled immediately; anything paid waits on Paystack.
    const nextEscrow = isFreeOrder ? 'refunded' : 'refund_pending';

    const { rows } = await client.query(
      `UPDATE orders
          SET refunds = $2::jsonb,
              escrow_status = $3,
              status = CASE WHEN $4 THEN 'Cancelled' ELSE status END,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [orderId, JSON.stringify(nextRefunds), nextEscrow, cancelOrder]
    );

    if (paymentRef) {
      await client.query(
        `INSERT INTO refund_lookups (payment_reference, order_id, refund_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (payment_reference)
         DO UPDATE SET order_id = EXCLUDED.order_id,
                       refund_id = EXCLUDED.refund_id,
                       updated_at = now()`,
        [paymentRef, orderId, refundId]
      );
    }

    await client.query('COMMIT');

    claim = {
      kind: 'new',
      order: rows[0],
      orderBefore: order,
      escrowStatus: nextEscrow,
      paymentRef,
      refundId,
      amount,
      sellerAmount,
      commissionAmount,
      total,
      fullyRefunded: deriveRefundState(nextRefunds, total).fullyRefunded,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Zero-amount / free order: nothing to send to Paystack.
  if (claim.total <= 0) {
    await applyRefundProcessedState({
      orderId,
      refundId: claim.refundId,
      paystackRefundId: null,
      paystackStatus: 'processed',
    });
    await refundSideEffects({
      order: claim.order,
      event: 'refund_processed',
      status: 'Cancelled',
      text: 'Zero-amount order closed',
      customText: 'Order cancelled.',
    });
    return {
      success: true,
      escrowStatus: 'refunded',
      refundId: claim.refundId,
      mode: 'zero',
      message: 'Zero-amount order closed without Paystack refund',
    };
  }

  // Missing payment reference: no way to refund through the rail.
  if (!claim.paymentRef) {
    await refundSideEffects({
      order: claim.order,
      event: 'refund_requested',
      status: 'Cancelled',
      text: 'Refund needs manual processing (missing payment reference)',
      customText:
        'Order cancelled. Refund needs manual processing (missing payment reference). Support has been flagged.',
    });
    return {
      success: true,
      escrowStatus: 'refund_pending',
      refundId: claim.refundId,
      mode: 'manual',
      message: 'Missing payment reference — marked for manual refund',
    };
  }

  // The claim is already committed; a gateway failure is retryable, not fatal.
  const isPartial = claim.amount + 0.001 < claim.total;
  let paystackRefund = null;
  try {
    paystackRefund = await refundTransaction({
      transactionReference: claim.paymentRef,
      amountKobo: isPartial ? Math.round(claim.amount * 100) : undefined,
      merchantNote:
        str(input?.merchantNote) ||
        `orderId=${orderId};refundId=${claim.refundId};reason=${reason}`,
    });
  } catch (error) {
    const message = error?.message || 'Paystack refund call failed';

    // A hard client error will not fix itself; a 5xx or timeout might.
    const retryable = !(error instanceof PaystackError) || error.statusCode >= 500;
    if (retryable) {
      await patchRefundEntry(orderId, claim.refundId, {
        status: REFUND_PENDING,
        paystackStatus: 'error',
        error: message,
      });
    } else {
      await markRefundFailed(orderId, claim.refundId, message);
    }

    return {
      success: true,
      escrowStatus: 'refund_pending',
      refundId: claim.refundId,
      mode: 'paystack',
      message,
    };
  }

  const paystackRefundId = paystackRefund?.id ?? null;
  const paystackStatus = str(paystackRefund?.status) || 'pending';

  await patchRefundEntry(orderId, claim.refundId, {
    status: REFUND_PENDING,
    paystackRefundId,
    paystackStatus,
    error: null,
  });

  await refundSideEffects({
    order: claim.order,
    event: 'refund_requested',
    status: cancelOrder ? 'Cancelled' : str(claim.order.status),
    text: `Refund pending — NGN ${claim.amount.toLocaleString()}`,
    customText: `Order cancelled. Refund of NGN ${claim.amount.toLocaleString()} is processing to the original payment method.`,
  });

  return {
    success: true,
    escrowStatus: 'refund_pending',
    refundId: claim.refundId,
    mode: 'paystack',
    message: 'Refund queued with Paystack',
    paystackRefundId,
  };
}

/**
 * Apply a Paystack `refund.*` webhook to the matching order.
 *
 * A refund webhook carries only a transaction reference, so the order is found
 * through `refund_lookups`.
 */
export async function handleRefundWebhookEvent(event, data) {
  const paymentRef =
    str(data?.transaction_reference) ||
    str(data?.transaction?.reference) ||
    str(data?.reference);

  if (!paymentRef) {
    console.warn('Refund webhook: no transaction reference');
    return { handled: false };
  }

  const { rows } = await pool.query(
    `SELECT order_id, refund_id FROM refund_lookups WHERE payment_reference = $1 LIMIT 1`,
    [paymentRef]
  );
  if (!rows.length) {
    console.warn('Refund webhook: no order for ref', paymentRef);
    return { handled: false };
  }

  const orderId = rows[0].order_id;
  let refundId = str(rows[0].refund_id);

  const { rows: orderRows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = orderRows[0];
  if (!order) return { handled: false };

  const refunds = Array.isArray(order.refunds) ? order.refunds : [];
  if (!refundId) {
    const pending = [...refunds]
      .reverse()
      .find((entry) => entry?.status === REFUND_PENDING || entry?.status === REFUND_FAILED);
    refundId = pending?.id || '';
  }
  if (!refundId) {
    console.warn('Refund webhook: no refund entry for order', orderId);
    return { handled: false };
  }

  const paystackRefundId = data?.id ?? data?.refund_reference ?? null;
  const status = str(data?.status).toLowerCase() || str(event).replace('refund.', '');

  if (event === 'refund.processed' || status === 'processed') {
    const result = await applyRefundProcessedState({
      orderId,
      refundId,
      paystackRefundId,
      paystackStatus: 'processed',
    });
    if (result) {
      await refundSideEffects({
        order: result.order,
        event: 'refund_processed',
        status: str(result.order.status) || 'Cancelled',
        text: 'Refund processed',
        customText: `Refund of NGN ${result.processed.toLocaleString()} processed to the original payment method.`,
      });
    }
    return { handled: true, status: 'processed' };
  }

  if (
    event === 'refund.failed' ||
    status === 'failed' ||
    event === 'refund.needs-attention'
  ) {
    const message =
      event === 'refund.needs-attention'
        ? 'Refund needs attention (bank details may be required)'
        : str(data?.message) || 'Paystack refund failed';
    await markRefundFailed(orderId, refundId, message);
    return { handled: true, status: 'failed' };
  }

  // pending / processing
  await patchRefundEntry(orderId, refundId, {
    status: REFUND_PENDING,
    paystackRefundId,
    paystackStatus: status || str(event).replace('refund.', ''),
  });

  return { handled: true, status: 'pending' };
}
