/**
 * Escrow lifecycle — the single source of truth for buyer money and seller payouts.
 *
 * The rule this file enforces:
 *
 *   A seller's withdrawable balance counts ONLY orders whose escrow has been
 *   released — buyer confirmed receipt, the auto-release timer fired, or an
 *   admin decided it.
 *
 * Why this file exists. Previously the sale ledger entry was written with
 * `status: 'completed'` the moment the buyer paid (see market-checkout.ts and the
 * Paystack webhook path). `requestPayout` trusted that flag, so a seller could
 * withdraw money for an order that had never been delivered. If that order later
 * fell through, the buyer was refunded out of the platform's Paystack balance
 * while the seller had already been paid — the platform ate the loss twice over.
 *
 * Two independent guards now prevent that:
 *   1. `getSellerReleasableEarnings` derives releasability from the ORDER's escrow
 *      state, never from the ledger's own status flag. This also repairs existing
 *      bad rows without a migration.
 *   2. `releaseOrderEscrow` is the only way escrow moves to released, so the
 *      ledger is promoted at the same moment money becomes withdrawable.
 *
 * This module deliberately imports nothing from the rest of `functions/` to avoid
 * import cycles. Callers are responsible for the Neon mirror, timeline and
 * notifications.
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

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

/** Ledger states. `pending` means earned-but-not-yet-withdrawable. */
export const LEDGER_PENDING = 'pending';
export const LEDGER_COMPLETED = 'completed';

const RELEASED_VALUES = [ESCROW_RELEASED, ESCROW_RELEASED_LEGACY];
const REFUND_VALUES = [ESCROW_REFUNDED, ESCROW_REFUND_PENDING];

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** True when escrow has moved to the seller (including the legacy `completed`). */
export function isEscrowReleased(status: unknown): boolean {
  return RELEASED_VALUES.includes(str(status));
}

/** True when money is still with the platform and could still be refunded. */
export function isEscrowHeld(status: unknown): boolean {
  const value = str(status);
  return value === '' || value === ESCROW_HELD;
}

/** True for any refund state — money is heading back to the buyer. */
export function isEscrowRefunded(status: unknown): boolean {
  return REFUND_VALUES.includes(str(status));
}

/** Escrow has finished moving; nothing further should happen to it. */
export function isEscrowSettled(status: unknown): boolean {
  return isEscrowReleased(status) || isEscrowRefunded(status);
}

/** The two ledger document ids a market order can be recorded under. */
export function ledgerDocIds(orderId: string, paymentRef?: string | null): string[] {
  const ids = [`ledger_${orderId}`];
  const ref = str(paymentRef);
  // Single-seller refunds still look up ledger_${paymentRef} for backward compat.
  if (ref && ref !== orderId) ids.push(`ledger_${ref}`);
  return ids;
}

export type ReleaseSource = 'buyer' | 'auto' | 'admin' | 'dispute';

export type ReleaseOutcome =
  | 'released'
  | 'already_released'
  | 'blocked_refunded'
  | 'blocked_dispute'
  | 'blocked_not_shipped'
  | 'not_found';

export interface ReleaseEscrowInput {
  orderId: string;
  source: ReleaseSource;
  /** Who triggered it, for the audit trail. Omitted for system/auto. */
  actorId?: string;
  actorRole?: string;
  /** Human-readable reason, recorded on the order and the ledger. */
  note?: string;
}

export interface ReleaseEscrowResult {
  outcome: ReleaseOutcome;
  /** The order as it was before the release, for notifications. */
  order?: Record<string, any>;
  releasedAt?: Date;
  /** Amount moved to the seller, when known. */
  sellerAmount?: number;
}

/** Orders that justify a release without an admin. */
const SHIPPED_STATUSES = ['Sent', 'Received', 'Completed', 'Disputed'];

/**
 * Move an order's escrow to the seller. Idempotent and transactional.
 *
 * Returns a reason instead of throwing for expected no-ops, so scheduled jobs can
 * loop safely over many orders without one bad row aborting the batch.
 */
export async function releaseOrderEscrow(
  input: ReleaseEscrowInput
): Promise<ReleaseEscrowResult> {
  const orderId = str(input.orderId);
  if (!orderId) throw new Error('orderId is required');

  const now = new Date();
  const firestore = admin.firestore();
  const orderRef = firestore.collection('orders').doc(orderId);

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return { outcome: 'not_found' as const };

    const order = (snap.data() || {}) as Record<string, any>;
    const escrowStatus = order.escrowStatus;

    if (isEscrowReleased(escrowStatus)) {
      return { outcome: 'already_released' as const, order };
    }
    if (isEscrowRefunded(escrowStatus)) {
      return { outcome: 'blocked_refunded' as const, order };
    }

    // A dispute freezes escrow. Only an admin (or the dispute resolver) may move it.
    const disputeOpen =
      str(order.disputeStatus) === 'open' || str(order.status) === 'Disputed';
    if (disputeOpen && input.source !== 'admin' && input.source !== 'dispute') {
      return { outcome: 'blocked_dispute' as const, order };
    }

    // Never release money for goods that were never dispatched. An admin can
    // override — they are looking at the actual evidence.
    const shipped = SHIPPED_STATUSES.includes(str(order.status)) || Boolean(order.sentAt);
    if (!shipped && input.source !== 'admin' && input.source !== 'dispute') {
      return { outcome: 'blocked_not_shipped' as const, order };
    }

    const update: Record<string, any> = {
      status: 'Completed',
      escrowStatus: ESCROW_RELEASED,
      fundsReleasedAt: FieldValue.serverTimestamp(),
      escrowReleasedBy: input.source,
      escrowReleasedAt: FieldValue.serverTimestamp(),
      // The timer did its job; clear it so nothing tries again.
      autoReleaseDate: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!order.receivedAt) update.receivedAt = FieldValue.serverTimestamp();
    if (input.actorId) update.escrowReleasedActorId = input.actorId;
    if (input.note) update.escrowReleaseNote = input.note;

    tx.update(orderRef, update);

    // Promote the sale ledger in the same transaction, so "withdrawable" and
    // "delivered" can never disagree.
    const ids = ledgerDocIds(orderId, order.paymentReference || order.paystackReference);
    const ledgerSnaps = await tx.getAll(...ids.map((id) => firestore.collection('transactions').doc(id)));
    ledgerSnaps.forEach((docSnap, index) => {
      if (!docSnap.exists) return;
      const ledger = (docSnap.data() || {}) as Record<string, any>;
      // A refunded sale must stay refunded even if the order is later released.
      if (str(ledger.refundStatus) === 'refunded' || str(ledger.refundStatus) === 'pending') return;
      tx.set(
        firestore.collection('transactions').doc(ids[index]),
        {
          status: LEDGER_COMPLETED,
          escrowStatus: ESCROW_RELEASED,
          releasedAt: FieldValue.serverTimestamp(),
          releasedBy: input.source,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return {
      outcome: 'released' as const,
      order,
      releasedAt: now,
      sellerAmount: sellerAmountForOrder(order),
    };
  });
}

/** Seller take-home for one order: total minus the commission stored at checkout. */
export function sellerAmountForOrder(order: Record<string, any>): number {
  const total = Number(order?.total) || 0;
  const rate = Number(order?.commissionRate);
  const commissionRate = Number.isFinite(rate) && rate >= 0 ? rate : 0.05;
  return roundMoney(total - total * commissionRate);
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export interface SellerEarnings {
  /** Withdrawable now: released orders only. */
  releasable: number;
  /** Earned but still in escrow — shown to the seller so the money is not a mystery. */
  pendingEscrow: number;
  /** Commission the platform earned on released orders. */
  commission: number;
  /** Number of released orders behind `releasable`. */
  releasableOrders: number;
  /** Released order ids — used by callers that need to reconcile. */
  releasableOrderIds: string[];
}

/** One withdrawable-or-not sale, resolved from a ledger document. */
export interface SaleLedgerEntry {
  orderId: string;
  /** Seller take-home after refunds on this sale. */
  net: number;
  commission: number;
}

/**
 * Read one sale ledger document into an entry, or null when it is not earnings.
 *
 * Excluded: fully refunded sales, refunds still in flight, and anything that
 * refunds down to zero. Kept pure so it can be tested without Firestore.
 */
export function toSaleLedgerEntry(
  docId: string,
  raw: Record<string, any> | undefined | null
): SaleLedgerEntry | null {
  const entry = raw || {};
  const refundStatus = str(entry.refundStatus);
  if (str(entry.status) === ESCROW_REFUNDED) return null;
  if (refundStatus === 'refunded' || refundStatus === 'pending') return null;

  const gross = Number(entry.amount) || 0;
  const refundedSellerAmount = Number(entry.refundedSellerAmount) || 0;
  const net = Math.max(0, gross - refundedSellerAmount);
  if (net <= 0) return null;

  const orderId = str(entry.orderId) || docId.replace(/^ledger_/, '');
  if (!orderId) return null;

  const commissionGross = Number(entry.commission) || 0;
  const commission = gross > 0 ? commissionGross * (net / gross) : commissionGross;

  return { orderId, net: roundMoney(net), commission: roundMoney(commission) };
}

/**
 * Split sales into withdrawable and still-held, given each order's escrow state.
 *
 * This is the rule that decides whether a seller can take money out. It reads the
 * ORDER's escrow state and deliberately ignores the ledger's own `status` flag,
 * because that flag was historically written as `completed` at payment time.
 *
 * An unknown order (deleted, or not yet mirrored) counts as NOT withdrawable —
 * money is only released against an order we can actually see as delivered.
 *
 * Pure, so the decision can be tested without a database.
 */
export function splitEarningsByEscrow(
  entries: SaleLedgerEntry[],
  escrowByOrderId: Map<string, string | null | undefined>
): SellerEarnings {
  const result: SellerEarnings = {
    releasable: 0,
    pendingEscrow: 0,
    commission: 0,
    releasableOrders: 0,
    releasableOrderIds: [],
  };

  for (const entry of entries) {
    const known = escrowByOrderId.has(entry.orderId);
    const escrowStatus = escrowByOrderId.get(entry.orderId);

    // A missing or unreadable order cannot be verified as delivered.
    if (!known || escrowStatus == null) {
      result.pendingEscrow = roundMoney(result.pendingEscrow + entry.net);
      continue;
    }

    if (isEscrowReleased(escrowStatus)) {
      result.releasable = roundMoney(result.releasable + entry.net);
      result.commission = roundMoney(result.commission + entry.commission);
      result.releasableOrders += 1;
      result.releasableOrderIds.push(entry.orderId);
    } else if (isEscrowHeld(escrowStatus)) {
      result.pendingEscrow = roundMoney(result.pendingEscrow + entry.net);
    }
    // refund_pending / refunded: excluded entirely.
  }

  return result;
}

/**
 * Split a seller's sales into withdrawable and still-in-escrow.
 *
 * Releasability comes from each ORDER's escrow state. This is deliberately not
 * read from the ledger's own `status` flag — that flag was historically written as
 * `completed` at payment time, which is exactly the bug this function prevents.
 * As a side effect it also corrects balances for orders already in the database.
 */
export async function getSellerReleasableEarnings(sellerId: string): Promise<SellerEarnings> {
  const firestore = admin.firestore();
  const snapshot = await firestore
    .collection('transactions')
    .where('sellerId', '==', sellerId)
    .where('type', '==', 'sale')
    .get();

  const entries: SaleLedgerEntry[] = [];
  snapshot.forEach((doc) => {
    const entry = toSaleLedgerEntry(doc.id, doc.data() as Record<string, any>);
    if (entry) entries.push(entry);
  });

  if (!entries.length) return splitEarningsByEscrow([], new Map());

  const uniqueOrderIds = [...new Set(entries.map((entry) => entry.orderId))];
  const refs = uniqueOrderIds.map((id) => firestore.collection('orders').doc(id));
  const orderDocs = await firestore.getAll(...refs);
  // getAll preserves order, but index by id so a missing doc is detectable.
  const escrowByOrderId = new Map<string, string | null | undefined>();
  for (const id of uniqueOrderIds) escrowByOrderId.set(id, null);
  orderDocs.forEach((doc) => {
    if (!doc.exists) return;
    const order = (doc.data() || {}) as Record<string, any>;
    escrowByOrderId.set(doc.id, order.escrowStatus ?? null);
  });

  return splitEarningsByEscrow(entries, escrowByOrderId);
}

/**
 * Mark a sale ledger entry as refunded. Called by the refund flow so a refunded
 * order can never be counted as withdrawable even before escrow settles.
 */
export function ledgerRefundPatch(): Record<string, any> {
  return {
    status: ESCROW_REFUNDED,
    escrowStatus: ESCROW_REFUNDED,
    refundStatus: 'refunded',
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * The ledger entry as it should look the moment a buyer pays: earned, but NOT
 * withdrawable until escrow releases.
 */
export function pendingLedgerFields(): Record<string, any> {
  return {
    status: LEDGER_PENDING,
    escrowStatus: ESCROW_HELD,
    releasedAt: null,
  };
}
