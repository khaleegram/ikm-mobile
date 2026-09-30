import { pool } from './db.mjs';

/**
 * Escrow lifecycle — the single source of truth for buyer money and seller payouts.
 *
 * The rule this module enforces:
 *
 *   A seller's withdrawable balance counts ONLY orders whose escrow has been
 *   released — buyer confirmed receipt, the auto-release timer fired, or an
 *   admin decided it.
 *
 * Difference from the Cloud Functions version: there is **no sale ledger table**.
 * In Firestore a separate `transactions` ledger was written at payment time and
 * had to be promoted on release, and its `status` flag drifted from the order —
 * it was written `completed` the moment the buyer paid, which let sellers withdraw
 * for undelivered orders. Here the balance is derived from the `orders` row
 * itself, so there is nothing to drift and nothing to reconcile.
 *
 * Money crosses this module in naira as NUMERIC (Postgres decimals are exact);
 * the Paystack boundary converts to integer kobo.
 */

/** Money is with the platform, owed to the seller once delivery is confirmed. */
export const ESCROW_HELD = 'held';
/** Delivery confirmed (or auto-confirmed). Seller may now withdraw. */
export const ESCROW_RELEASED = 'released';
/** Refund sent back to the buyer. */
export const ESCROW_REFUNDED = 'refunded';
/** Refund initiated, waiting on Paystack to confirm. */
export const ESCROW_REFUND_PENDING = 'refund_pending';
/**
 * Legacy value written by free-order checkout before this module existed.
 * Read as "released" so old free orders are not mistaken for held escrow.
 */
export const ESCROW_RELEASED_LEGACY = 'completed';

const RELEASED_VALUES = [ESCROW_RELEASED, ESCROW_RELEASED_LEGACY];
const REFUND_VALUES = [ESCROW_REFUNDED, ESCROW_REFUND_PENDING];

/** Fallback commission when an order has no rate stored. */
const DEFAULT_COMMISSION_RATE = 0.05;

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** True when escrow has moved to the seller (including the legacy `completed`). */
export function isEscrowReleased(status) {
  return RELEASED_VALUES.includes(str(status));
}

/** True when money is still with the platform and could still be refunded. */
export function isEscrowHeld(status) {
  const value = str(status);
  return value === '' || value === ESCROW_HELD;
}

/** True for any refund state — money is heading back to the buyer. */
export function isEscrowRefunded(status) {
  return REFUND_VALUES.includes(str(status));
}

/** Escrow has finished moving; nothing further should happen to it. */
export function isEscrowSettled(status) {
  return isEscrowReleased(status) || isEscrowRefunded(status);
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Seller take-home for one order: total minus the commission stored at checkout.
 *
 * The kobo columns win when the order has them. They were priced by the engine —
 * commission off the seller's full price, delivery passed through in full, and a
 * campaign's discount funded by the platform — none of which the flat
 * `total × commission_rate` formula below can express. For a promo order that
 * formula would also charge commission on the delivery fee and, because `total` is
 * what the buyer paid, quietly take the platform's discount out of the seller.
 *
 * Orders written before the engine have no kobo payout, so they keep the old
 * arithmetic and settle exactly as they always would have.
 */
export function sellerAmountForOrder(order) {
  const pricedKobo = order?.seller_payout_kobo ?? order?.sellerPayoutKobo;
  if (pricedKobo != null && Number.isFinite(Number(pricedKobo))) {
    return roundMoney(Number(pricedKobo) / 100);
  }

  const total = Number(order?.total) || 0;
  const rate = Number(order?.commission_rate ?? order?.commissionRate);
  const commissionRate = Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_COMMISSION_RATE;
  return roundMoney(total - total * commissionRate);
}

/** Commission the platform earned on one order. */
export function commissionForOrder(order) {
  const pricedKobo = order?.commission_kobo ?? order?.commissionKobo;
  if (pricedKobo != null && Number.isFinite(Number(pricedKobo))) {
    return roundMoney(Number(pricedKobo) / 100);
  }

  const total = Number(order?.total) || 0;
  return roundMoney(total - sellerAmountForOrder(order));
}

/**
 * Seller money returned to the buyer on this order, from its `refunds` array.
 *
 * Only refunds that actually left the platform reduce what the seller is owed.
 * A `pending` refund is excluded here because the order's escrow state already
 * excludes it (see `splitByEscrow`) — counting it twice would under-pay the seller.
 */
export function refundedSellerAmount(order) {
  const refunds = Array.isArray(order?.refunds) ? order.refunds : [];
  return roundMoney(
    refunds
      .filter((entry) => str(entry?.status) === 'processed' || str(entry?.status) === 'refunded')
      .reduce((sum, entry) => sum + (Number(entry?.sellerAmount) || 0), 0)
  );
}

/** Refund states that have not settled yet. */
const REFUND_IN_FLIGHT = ['pending', 'processing', 'needs-attention', 'needs_attention'];

/**
 * True when a refund on this order has not settled.
 *
 * The escrow state should already be `refund_pending` in that case, but if the two
 * ever disagree, the money must not be withdrawable: the refund is on its way out
 * of the same balance. This is the guard the old Firestore ledger provided by
 * excluding in-flight refunds from earnings.
 */
export function hasRefundInFlight(order) {
  const refunds = Array.isArray(order?.refunds) ? order.refunds : [];
  return refunds.some((entry) => REFUND_IN_FLIGHT.includes(str(entry?.status)));
}

export const RELEASE_SOURCES = ['buyer', 'auto', 'admin', 'dispute'];

/** Orders that justify a release without an admin. */
const SHIPPED_STATUSES = ['Sent', 'Received', 'Completed', 'Disputed'];

export function isOrderShipped(order) {
  return SHIPPED_STATUSES.includes(str(order?.status)) || Boolean(order?.sent_at);
}

export function isDisputeOpen(order) {
  const dispute = order?.dispute;
  const disputeStatus = str(dispute?.status);
  return disputeStatus === 'open' || str(order?.status) === 'Disputed';
}

/**
 * Move an order's escrow to the seller. Idempotent and transactional.
 *
 * Returns a reason instead of throwing for expected no-ops, so scheduled jobs can
 * loop over many orders without one bad row aborting the batch.
 */
export async function releaseOrderEscrow({
  orderId,
  source,
  actorId = null,
  actorRole = null,
  note = null,
}) {
  const id = str(orderId);
  if (!id) throw new Error('orderId is required');
  if (!RELEASE_SOURCES.includes(source)) {
    throw new Error(`releaseOrderEscrow: unknown source "${source}"`);
  }
  if (!pool) throw new Error('Database is not configured');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row: two concurrent releases must not both see `held`.
    const { rows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { outcome: 'not_found' };
    }

    const order = rows[0];

    if (isEscrowReleased(order.escrow_status)) {
      await client.query('ROLLBACK');
      return { outcome: 'already_released', order };
    }
    if (isEscrowRefunded(order.escrow_status)) {
      await client.query('ROLLBACK');
      return { outcome: 'blocked_refunded', order };
    }

    // A dispute freezes escrow. Only an admin (or the dispute resolver) may move it.
    if (isDisputeOpen(order) && source !== 'admin' && source !== 'dispute') {
      await client.query('ROLLBACK');
      return { outcome: 'blocked_dispute', order };
    }

    // Never release money for goods that were never dispatched. An admin can
    // override — they are looking at the actual evidence.
    if (!isOrderShipped(order) && source !== 'admin' && source !== 'dispute') {
      await client.query('ROLLBACK');
      return { outcome: 'blocked_not_shipped', order };
    }

    const { rows: updated } = await client.query(
      `UPDATE orders
          SET status = 'Completed',
              escrow_status = $2,
              funds_released_at = now(),
              received_at = COALESCE(received_at, now()),
              auto_release_date = NULL,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, ESCROW_RELEASED]
    );

    const releasedOrder = updated[0];
    await client.query('COMMIT');

    // Audit fields (releasedBy/actorId/note) are deliberately not columns on
    // `orders`. The caller records them as an order timeline event, which is the
    // audit trail, so there is one place to read history from.
    return {
      outcome: 'released',
      order,
      releasedOrder,
      releasedAt: new Date(),
      sellerAmount: sellerAmountForOrder(order),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Split a seller's orders into withdrawable and still-in-escrow.
 *
 * Releasability is read from each ORDER's escrow state. There is no ledger flag to
 * disagree with it, which is what removes the historical withdrawal-for-undelivered
 * bug rather than working around it.
 *
 * An order that is refunded, or refund-pending, is excluded entirely: that money
 * is on its way back to the buyer.
 */
export function splitByEscrow(orders) {
  const result = {
    releasable: 0,
    pendingEscrow: 0,
    commission: 0,
    releasableOrders: 0,
    releasableOrderIds: [],
  };

  for (const order of orders) {
    const status = order.escrow_status;

    if (isEscrowReleased(status)) {
      // A refund in flight has not reduced the order yet, but it is leaving the
      // same balance — so the money is not withdrawable until it settles.
      if (hasRefundInFlight(order)) {
        result.pendingEscrow = roundMoney(
          result.pendingEscrow + sellerAmountForOrder(order)
        );
        continue;
      }

      // A partial refund reduces what the seller is owed on a released order.
      const net = roundMoney(
        Math.max(0, sellerAmountForOrder(order) - refundedSellerAmount(order))
      );
      if (net <= 0) continue;
      result.releasable = roundMoney(result.releasable + net);
      result.commission = roundMoney(result.commission + commissionForOrder(order));
      result.releasableOrders += 1;
      result.releasableOrderIds.push(order.id);
    } else if (isEscrowHeld(status)) {
      result.pendingEscrow = roundMoney(
        result.pendingEscrow + sellerAmountForOrder(order)
      );
    }
    // refund_pending / refunded: excluded entirely.
  }

  return result;
}

/**
 * Split a seller's sales into withdrawable and still-in-escrow.
 *
 * This is the number `requestPayout` trusts, so it reads the orders table and
 * nothing else.
 */
export async function getSellerReleasableEarnings(sellerId) {
  const id = str(sellerId);
  if (!id) throw new Error('sellerId is required');
  if (!pool) throw new Error('Database is not configured');

  const { rows } = await pool.query(
    `SELECT id, total, commission_rate, escrow_status, refunds, status, sent_at, dispute, received_at
       FROM orders
      WHERE seller_id = $1
        AND escrow_status IS NOT NULL
        AND escrow_status NOT IN ($2, $3)`,
    [id, ESCROW_REFUNDED, ESCROW_REFUND_PENDING]
  );

  return splitByEscrow(rows);
}

/**
 * The amount actually payable to a seller right now: releasable earnings minus
 * everything already paid out or in flight.
 *
 * Centralised here because `requestPayout` and the earnings endpoint must agree —
 * when they calculated it separately they could disagree.
 */
export async function getSellerPayableBalance(sellerId) {
  const earnings = await getSellerReleasableEarnings(sellerId);

  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) AS paid,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'pending_otp')), 0) AS in_flight
       FROM payouts
      WHERE seller_id = $1`,
    [sellerId]
  );

  const paid = Number(rows[0]?.paid || 0);
  const inFlight = Number(rows[0]?.in_flight || 0);
  const available = roundMoney(Math.max(0, earnings.releasable - paid - inFlight));

  return { ...earnings, paid, inFlight, available };
}
