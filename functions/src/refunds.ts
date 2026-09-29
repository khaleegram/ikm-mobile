/**
 * Paystack escrow refunds — shared by cancel / dispute / auto-cancel / webhooks.
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
  getPaystackSecretKey,
  requireAdmin,
  sendError,
  sendResponse,
} from './utils';
import { isEscrowReleased } from './escrow';

export const paystackSecret = defineSecret('PAYSTACK_SECRET_KEY');

const corsHandler = cors({ origin: true });

/** Firestore forbids FieldValue.serverTimestamp() inside arrays — use a concrete Timestamp. */
function nowTimestamp() {
  return admin.firestore.Timestamp.now();
}

export type RefundActorRole = 'buyer' | 'seller' | 'admin' | 'system';

export type ProcessOrderRefundInput = {
  orderId: string;
  reason: string;
  /** NGN. Omit for full remaining refundable amount. */
  amountNgn?: number;
  actorId?: string;
  actorRole?: RefundActorRole;
  /** When true (default), set order status to Cancelled. */
  cancelOrder?: boolean;
  customerNote?: string;
  merchantNote?: string;
  /** Allow retry of a failed/pending refund without creating a duplicate claim when possible. */
  isRetry?: boolean;
};

export type ProcessOrderRefundResult = {
  success: boolean;
  escrowStatus: 'held' | 'released' | 'refund_pending' | 'refunded' | string;
  refundId?: string;
  mode: 'paystack' | 'manual' | 'zero' | 'idempotent' | 'rejected';
  message?: string;
  paystackRefundId?: string | number | null;
};

type OrderRefundEntry = {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  refundMethod: 'original_payment' | 'store_credit' | 'manual';
  status: 'pending' | 'processed' | 'failed';
  processedBy?: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | Date;
  processedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | Date;
  paystackRefundId?: string | number | null;
  paystackStatus?: string | null;
  transactionReference?: string | null;
  error?: string | null;
  sellerAmount?: number;
  commissionAmount?: number;
};

function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumRefundedOrPending(refunds: OrderRefundEntry[]): number {
  return roundMoney(
    (refunds || []).reduce((sum, r) => {
      if (r.status === 'processed' || r.status === 'pending') {
        return sum + (Number(r.amount) || 0);
      }
      return sum;
    }, 0)
  );
}

function buildOrderSummary(order: any): string {
  const item = order?.items?.[0]?.name || 'item';
  const total = Number(order?.total || 0);
  const extra = order?.items?.length > 1 ? ` +${order.items.length - 1} more` : '';
  return `${item}${extra} — NGN ${total.toLocaleString()}`;
}

async function callPaystackRefund(params: {
  secretKey: string;
  transactionRef: string;
  amountKobo?: number;
  customerNote?: string;
  merchantNote?: string;
}): Promise<{
  ok: boolean;
  alreadyRefunded: boolean;
  data: any;
  message: string;
  httpStatus: number;
}> {
  const body: Record<string, unknown> = {
    transaction: params.transactionRef,
    currency: 'NGN',
  };
  if (params.amountKobo != null && Number.isFinite(params.amountKobo) && params.amountKobo > 0) {
    body.amount = Math.round(params.amountKobo);
  }
  if (params.customerNote) body.customer_note = params.customerNote.slice(0, 500);
  if (params.merchantNote) body.merchant_note = params.merchantNote.slice(0, 500);

  const res = await fetch('https://api.paystack.co/refund', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  const message = asNonEmptyString(payload?.message || payload?.data?.message || res.statusText);
  const lower = message.toLowerCase();
  const alreadyRefunded =
    res.status === 400 || res.status === 422
      ? lower.includes('already') || lower.includes('refunded') || lower.includes('has been refunded')
      : false;

  return {
    ok: Boolean(payload?.status) && res.ok,
    alreadyRefunded,
    data: payload?.data || null,
    message: message || `Paystack refund failed (${res.status})`,
    httpStatus: res.status,
  };
}

/**
 * Initiate (or idempotently resume) a Paystack refund for an escrow order.
 */
export async function processOrderRefund(
  input: ProcessOrderRefundInput,
  options?: { secretKey?: string }
): Promise<ProcessOrderRefundResult> {
  const orderId = asNonEmptyString(input.orderId);
  if (!orderId) {
    throw new Error('orderId is required');
  }

  const firestore = admin.firestore();
  const orderRef = firestore.collection('orders').doc(orderId);
  const cancelOrder = input.cancelOrder !== false;
  const reason = asNonEmptyString(input.reason) || 'Order cancelled';

  const claim = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      throw new Error('Order not found');
    }
    const order = snap.data() || {};
    const escrowStatus = asNonEmptyString(order.escrowStatus) || 'held';
    const refunds: OrderRefundEntry[] = Array.isArray(order.refunds) ? [...order.refunds] : [];
    const paymentRef =
      asNonEmptyString(order.paymentReference) || asNonEmptyString(order.paystackReference);
    const total = roundMoney(Number(order.total) || 0);
    const commissionRate = Number(order.commissionRate);
    const rate = Number.isFinite(commissionRate) && commissionRate >= 0 ? commissionRate : 0.05;

    // isEscrowReleased also covers the legacy 'completed' value free orders used.
    if (isEscrowReleased(escrowStatus)) {
      const err: any = new Error(
        'Cannot refund: escrow already released to the seller. Open a dispute or contact support.'
      );
      err.code = 'ESCROW_RELEASED';
      throw err;
    }

    if (escrowStatus === 'refunded') {
      return {
        kind: 'idempotent' as const,
        order,
        escrowStatus,
        paymentRef,
        refundId: refunds.find((r) => r.status === 'processed')?.id,
      };
    }

    const pending = refunds.find((r) => r.status === 'pending');
    if (escrowStatus === 'refund_pending' && pending && !input.isRetry) {
      return {
        kind: 'idempotent' as const,
        order,
        escrowStatus,
        paymentRef,
        refundId: pending.id,
        paystackRefundId: pending.paystackRefundId,
      };
    }

    // On retry: don't count failed (or pending-without-Paystack-id) toward committed
    const reusableIdx = input.isRetry
      ? [...refunds]
          .map((r, i) => ({ r, i }))
          .reverse()
          .find(
            ({ r }) =>
              r.status === 'failed' || (r.status === 'pending' && !r.paystackRefundId)
          )?.i ?? -1
      : -1;

    const committed = sumRefundedOrPending(
      refunds.filter((r, i) => {
        if (input.isRetry && i === reusableIdx) return false;
        return r.status === 'processed' || r.status === 'pending';
      })
    );
    const remaining = roundMoney(Math.max(0, total - committed));

    if (remaining <= 0 && total > 0) {
      return {
        kind: 'idempotent' as const,
        order,
        escrowStatus: escrowStatus === 'refund_pending' ? 'refund_pending' : 'refunded',
        paymentRef,
        refundId: pending?.id,
      };
    }

    let amount = input.amountNgn != null ? roundMoney(Number(input.amountNgn)) : remaining;
    if (!(amount > 0) && total > 0) {
      throw new Error('Refund amount must be greater than zero');
    }
    if (amount > remaining) amount = remaining;

    const refundId =
      reusableIdx >= 0 ? refunds[reusableIdx].id : `rf_${orderId.slice(0, 8)}_${Date.now().toString(36)}`;
    const sellerAmount = roundMoney(amount * (1 - rate));
    const commissionAmount = roundMoney(amount - sellerAmount);

    const entry: OrderRefundEntry = {
      id: refundId,
      orderId,
      amount,
      reason,
      refundMethod: paymentRef ? 'original_payment' : 'manual',
      status: 'pending',
      processedBy: input.actorId || undefined,
      createdAt: reusableIdx >= 0 ? refunds[reusableIdx].createdAt : nowTimestamp(),
      transactionReference: paymentRef || null,
      paystackRefundId: null,
      paystackStatus: total <= 0 || !paymentRef ? 'skipped' : 'initiating',
      sellerAmount,
      commissionAmount,
      error: null,
    };

    const nextRefunds =
      reusableIdx >= 0
        ? refunds.map((r, i) => (i === reusableIdx ? entry : r))
        : [...refunds, entry];
    const patch: Record<string, any> = {
      refunds: nextRefunds,
      refundStatus: 'pending',
      lastRefundAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (cancelOrder) {
      patch.status = 'Cancelled';
    }

    if (total <= 0) {
      patch.escrowStatus = 'refunded';
      patch.refundStatus = 'processed';
      entry.status = 'processed';
      entry.processedAt = nowTimestamp();
      entry.refundMethod = 'manual';
      patch.refunds =
        reusableIdx >= 0
          ? nextRefunds.map((r, i) => (i === reusableIdx ? entry : r))
          : [...refunds, entry];
    } else if (!paymentRef) {
      patch.escrowStatus = 'refund_pending';
      entry.refundMethod = 'manual';
      entry.error = 'Missing payment reference — manual refund required';
      patch.refunds = nextRefunds.map((r) => (r.id === refundId ? entry : r));
    } else {
      patch.escrowStatus = 'refund_pending';
    }

    tx.update(orderRef, patch);

    const ledgerRef = firestore.collection('transactions').doc(`refund_${orderId}_${refundId}`);
    tx.set(ledgerRef, {
      id: `refund_${orderId}_${refundId}`,
      type: 'refund',
      amount: sellerAmount,
      commission: commissionAmount,
      orderId,
      sellerId: order.sellerId || null,
      customerId: order.customerId || null,
      description: `Refund for order #${orderId.slice(0, 7)}`,
      status: total <= 0 ? 'completed' : 'pending',
      paymentReference: paymentRef || null,
      refundId,
      reason,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (paymentRef) {
      const lookupRef = firestore.collection('refund_lookups').doc(`${paymentRef}__${orderId}`);
      tx.set(
        lookupRef,
        {
          orderId,
          refundId,
          paymentReference: paymentRef,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      // Also keep a pointer on the parent ref for webhook discovery (last refund wins for lookup;
      // webhook also matches by orderId in refund entry / order-scoped docs).
      tx.set(
        firestore.collection('refund_lookups').doc(paymentRef),
        {
          orderId,
          refundId,
          paymentReference: paymentRef,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const saleRef = firestore.collection('transactions').doc(`ledger_${orderId}`);
      const legacySaleRef = firestore.collection('transactions').doc(`ledger_${paymentRef}`);
      tx.set(
        saleRef,
        {
          refundStatus: 'pending',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(
        legacySaleRef,
        {
          refundStatus: 'pending',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return {
      kind: 'new' as const,
      order,
      escrowStatus: patch.escrowStatus as string,
      paymentRef,
      refundId,
      amount,
      sellerAmount,
      commissionAmount,
      total,
      entry,
    };
  });

  if (claim.kind === 'idempotent') {
    return {
      success: true,
      escrowStatus: claim.escrowStatus,
      refundId: claim.refundId,
      mode: 'idempotent',
      message: 'Refund already in progress or completed',
      paystackRefundId: claim.paystackRefundId ?? null,
    };
  }

  // Zero-amount / free order
  if (claim.total <= 0) {
    await finalizeLocalRefundEffects({
      orderId,
      refundId: claim.refundId!,
      paymentRef: claim.paymentRef || '',
      markSaleFullyRefunded: true,
      notify: true,
      order: claim.order,
    });
    return {
      success: true,
      escrowStatus: 'refunded',
      refundId: claim.refundId,
      mode: 'zero',
      message: 'Zero-amount order closed without Paystack refund',
    };
  }

  // Missing payment reference → manual
  if (!claim.paymentRef) {
    try {
      const { createSystemMessage } = await import('./order-chat.js');
      await createSystemMessage({
        orderId,
        event: 'order_cancelled',
        dealThreadId: claim.order.dealThreadId || claim.order.chatThreadId || null,
        customText:
          'Order cancelled. Refund needs manual processing (missing payment reference). Support has been flagged.',
      });
    } catch {
      // non-blocking
    }
    return {
      success: true,
      escrowStatus: 'refund_pending',
      refundId: claim.refundId,
      mode: 'manual',
      message: 'Missing payment reference — marked for manual refund',
    };
  }

  let secretKey: string;
  try {
    secretKey = getPaystackSecretKey(options?.secretKey);
  } catch (e: any) {
    await markRefundFailed(orderId, claim.refundId!, e?.message || 'Paystack secret not configured');
    throw e;
  }

  const amountKobo = Math.round(claim.amount * 100);
  const isPartial = claim.amount + 0.001 < claim.total;

  let paystackResult: Awaited<ReturnType<typeof callPaystackRefund>>;
  try {
    paystackResult = await callPaystackRefund({
      secretKey,
      transactionRef: claim.paymentRef,
      amountKobo: isPartial ? amountKobo : undefined, // full refund when remaining == total path uses omit for clarity when amount === total
      customerNote:
        input.customerNote ||
        `Refund for ChatCart order ${orderId.slice(0, 8)}`,
      merchantNote:
        input.merchantNote ||
        `orderId=${orderId};refundId=${claim.refundId};reason=${reason}`,
    });
  } catch (e: any) {
    await markRefundFailed(orderId, claim.refundId!, e?.message || 'Paystack network error');
    return {
      success: true,
      escrowStatus: 'refund_pending',
      refundId: claim.refundId,
      mode: 'paystack',
      message: 'Refund queued locally; Paystack call failed — retry available',
    };
  }

  // Prefer explicit amount when partial; if we omitted for full but amount < original due to prior refunds, re-call with amount
  if (paystackResult.ok === false && isPartial === false && claim.amount < claim.total) {
    try {
      paystackResult = await callPaystackRefund({
        secretKey,
        transactionRef: claim.paymentRef,
        amountKobo,
        customerNote: input.customerNote || `Refund for ChatCart order ${orderId.slice(0, 8)}`,
        merchantNote: input.merchantNote || `orderId=${orderId};refundId=${claim.refundId}`,
      });
    } catch {
      // keep previous result
    }
  }

  if (paystackResult.alreadyRefunded) {
    await applyRefundProcessedState({
      orderId,
      refundId: claim.refundId!,
      paymentRef: claim.paymentRef,
      paystackRefundId: paystackResult.data?.id ?? 'already_refunded',
      paystackStatus: 'processed',
      order: claim.order,
      amount: claim.amount,
      sellerAmount: claim.sellerAmount,
    });
    return {
      success: true,
      escrowStatus: 'refunded',
      refundId: claim.refundId,
      mode: 'paystack',
      message: 'Transaction already refunded at Paystack',
      paystackRefundId: paystackResult.data?.id ?? null,
    };
  }

  if (!paystackResult.ok) {
    // Keep pending for retry on 5xx; mark failed on hard 4xx
    if (paystackResult.httpStatus >= 500 || paystackResult.httpStatus === 0) {
      await patchRefundEntry(orderId, claim.refundId!, {
        status: 'pending',
        paystackStatus: 'error',
        error: paystackResult.message,
      });
      return {
        success: true,
        escrowStatus: 'refund_pending',
        refundId: claim.refundId,
        mode: 'paystack',
        message: paystackResult.message,
      };
    }
    await markRefundFailed(orderId, claim.refundId!, paystackResult.message);
    return {
      success: true,
      escrowStatus: 'refund_pending',
      refundId: claim.refundId,
      mode: 'paystack',
      message: paystackResult.message,
    };
  }

  const paystackRefundId = paystackResult.data?.id ?? null;
  const paystackStatus = asNonEmptyString(paystackResult.data?.status) || 'pending';

  await patchRefundEntry(orderId, claim.refundId!, {
    status: 'pending',
    paystackRefundId,
    paystackStatus,
    error: null,
  });

  try {
    const { createSystemMessage, createOrderTimelineEvent } = await import('./order-chat.js');
    await createSystemMessage({
      orderId,
      event: 'order_cancelled',
      dealThreadId: claim.order.dealThreadId || claim.order.chatThreadId || null,
      customText: `Order cancelled. Refund of NGN ${claim.amount.toLocaleString()} is processing to the original payment method.`,
    });
    await createOrderTimelineEvent({
      orderId,
      event: 'refund_requested',
      status: cancelOrder ? 'Cancelled' : asNonEmptyString(claim.order.status),
      text: `Refund pending — NGN ${claim.amount.toLocaleString()}`,
      actorId: input.actorId || 'system',
      actorRole: input.actorRole === 'buyer' || input.actorRole === 'seller' ? input.actorRole : 'system',
    });
  } catch (e) {
    console.error('Refund chat/timeline side effects failed', orderId, e);
  }

  // Neon is write primary — must succeed after FS refund claim.
  const { dualWriteOrderToPostgres } = await import('./order-chat.js');
  await dualWriteOrderToPostgres(orderId);

  return {
    success: true,
    escrowStatus: 'refund_pending',
    refundId: claim.refundId,
    mode: 'paystack',
    message: 'Refund queued with Paystack',
    paystackRefundId,
  };
}

async function patchRefundEntry(
  orderId: string,
  refundId: string,
  patch: Partial<OrderRefundEntry>
): Promise<void> {
  const orderRef = admin.firestore().collection('orders').doc(orderId);
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const order = snap.data() || {};
    const refunds: OrderRefundEntry[] = Array.isArray(order.refunds) ? [...order.refunds] : [];
    const idx = refunds.findIndex((r) => r.id === refundId);
    if (idx < 0) return;
    refunds[idx] = { ...refunds[idx], ...patch };
    tx.update(orderRef, {
      refunds,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function markRefundFailed(orderId: string, refundId: string, error: string): Promise<void> {
  await patchRefundEntry(orderId, refundId, {
    status: 'failed',
    paystackStatus: 'failed',
    error,
  });
  await admin.firestore().collection('orders').doc(orderId).update({
    refundStatus: 'failed',
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    const orderSnap = await admin.firestore().collection('orders').doc(orderId).get();
    const order = orderSnap.data() || {};
    const { createSystemMessage } = await import('./order-chat.js');
    const { notifyBuyer, notifySeller } = await import('./notifications.js');
    await createSystemMessage({
      orderId,
      event: 'order_cancelled',
      dealThreadId: order.dealThreadId || order.chatThreadId || null,
      customText: `Refund needs attention: ${error}. Support can retry the refund.`,
    });
    const summary = buildOrderSummary(order);
    notifyBuyer({
      buyerId: String(order.customerId || ''),
      event: 'order_cancelled',
      orderId,
      orderSummary: summary,
      extra: 'Refund needs attention — we will retry.',
      chatRoomId: order.dealThreadId || order.chatThreadId || null,
    }).catch(() => undefined);
    notifySeller({
      sellerId: String(order.sellerId || ''),
      event: 'refund_requested',
      orderId,
      orderSummary: summary,
      chatRoomId: order.dealThreadId || order.chatThreadId || null,
    }).catch(() => undefined);
  } catch {
    // non-blocking
  }
}

async function finalizeLocalRefundEffects(params: {
  orderId: string;
  refundId: string;
  paymentRef: string;
  markSaleFullyRefunded: boolean;
  notify: boolean;
  order: any;
}): Promise<void> {
  await applyRefundProcessedState({
    orderId: params.orderId,
    refundId: params.refundId,
    paymentRef: params.paymentRef,
    paystackRefundId: null,
    paystackStatus: 'processed',
    order: params.order,
    amount: Number(params.order?.total) || 0,
    sellerAmount: 0,
  });
}

async function applyRefundProcessedState(params: {
  orderId: string;
  refundId: string;
  paymentRef: string;
  paystackRefundId: string | number | null;
  paystackStatus: string;
  order: any;
  amount: number;
  sellerAmount: number;
}): Promise<void> {
  const firestore = admin.firestore();
  const orderRef = firestore.collection('orders').doc(params.orderId);

  let processedOnly = 0;
  let sellerAmtForLedger = params.sellerAmount;
  let orderAfter: any = params.order;

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const order = snap.data() || {};
    orderAfter = order;
    const refunds: OrderRefundEntry[] = Array.isArray(order.refunds) ? [...order.refunds] : [];
    const idx = refunds.findIndex((r) => r.id === params.refundId);
    if (idx >= 0) {
      if (refunds[idx].status === 'processed') {
        processedOnly = roundMoney(
          refunds.filter((r) => r.status === 'processed').reduce((s, r) => s + (Number(r.amount) || 0), 0)
        );
        return;
      }
      sellerAmtForLedger = Number(refunds[idx].sellerAmount) || params.sellerAmount || 0;
      refunds[idx] = {
        ...refunds[idx],
        status: 'processed',
        paystackRefundId: params.paystackRefundId,
        paystackStatus: params.paystackStatus,
        processedAt: nowTimestamp(),
        error: null,
      };
    }

    processedOnly = roundMoney(
      refunds.filter((r) => r.status === 'processed').reduce((s, r) => s + (Number(r.amount) || 0), 0)
    );
    const total = roundMoney(Number(order.total) || 0);
    const fullyRefunded = total <= 0 || processedOnly + 0.001 >= total;

    tx.update(orderRef, {
      refunds,
      escrowStatus: fullyRefunded || order.status === 'Cancelled' ? 'refunded' : 'held',
      refundStatus: fullyRefunded ? 'processed' : 'partial',
      lastRefundAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const ledgerRef = firestore
    .collection('transactions')
    .doc(`refund_${params.orderId}_${params.refundId}`);
  await ledgerRef.set(
    {
      status: 'completed',
      paystackRefundId: params.paystackRefundId,
      updatedAt: FieldValue.serverTimestamp(),
      processedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (params.paymentRef) {
    const orderLedgerId = `ledger_${params.orderId}`;
    const saleRefs = [
      firestore.collection('transactions').doc(orderLedgerId),
      firestore.collection('transactions').doc(`ledger_${params.paymentRef}`),
    ];
    for (const saleRef of saleRefs) {
      const saleSnap = await saleRef.get();
      if (!saleSnap.exists) continue;
      const sale = saleSnap.data() || {};
      const prevRefunded = Number(sale.refundedSellerAmount) || 0;
      const nextRefunded = roundMoney(prevRefunded + (sellerAmtForLedger || 0));
      const saleAmount = Number(sale.amount) || 0;
      await saleRef.set(
        {
          refundedSellerAmount: nextRefunded,
          refundStatus: nextRefunded + 0.001 >= saleAmount ? 'refunded' : 'partial',
          status: nextRefunded + 0.001 >= saleAmount ? 'refunded' : sale.status,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  try {
    const { createSystemMessage, createOrderTimelineEvent } = await import('./order-chat.js');
    const { notifyBuyer } = await import('./notifications.js');
    await createSystemMessage({
      orderId: params.orderId,
      event: 'refund_processed',
      dealThreadId: orderAfter.dealThreadId || orderAfter.chatThreadId || null,
      customText: `Refund of NGN ${processedOnly.toLocaleString()} processed to the original payment method.`,
    });
    await createOrderTimelineEvent({
      orderId: params.orderId,
      event: 'refund_processed',
      status: asNonEmptyString(orderAfter.status) || 'Cancelled',
      text: 'Refund processed',
      actorId: 'system',
      actorRole: 'system',
    });
    await notifyBuyer({
      buyerId: String(orderAfter.customerId || ''),
      event: 'refund_processed',
      orderId: params.orderId,
      orderSummary: buildOrderSummary(orderAfter),
      chatRoomId: orderAfter.dealThreadId || orderAfter.chatThreadId || null,
    });
  } catch (e) {
    console.error('Post-refund notify failed', e);
  }

  const { dualWriteOrderToPostgres } = await import('./order-chat.js');
  await dualWriteOrderToPostgres(params.orderId);
}

/**
 * Apply Paystack refund.* webhook payloads to the matching order.
 */
export async function handleRefundWebhookEvent(event: string, data: any): Promise<void> {
  const paymentRef =
    asNonEmptyString(data?.transaction_reference) ||
    asNonEmptyString(data?.transaction?.reference) ||
    asNonEmptyString(data?.reference);

  if (!paymentRef) {
    console.warn('Refund webhook missing transaction reference', event);
    return;
  }

  const firestore = admin.firestore();
  let orderId = '';
  let refundId = '';

  const lookup = await firestore.collection('refund_lookups').doc(paymentRef).get();
  if (lookup.exists) {
    orderId = asNonEmptyString(lookup.data()?.orderId);
    refundId = asNonEmptyString(lookup.data()?.refundId);
  }

  if (!orderId) {
    const byRef = await firestore
      .collection('orders')
      .where('paymentReference', '==', paymentRef)
      .limit(1)
      .get();
    if (!byRef.empty) {
      orderId = byRef.docs[0].id;
    } else {
      const byRef2 = await firestore
        .collection('orders')
        .where('paystackReference', '==', paymentRef)
        .limit(1)
        .get();
      if (!byRef2.empty) orderId = byRef2.docs[0].id;
    }
  }

  if (!orderId) {
    console.warn('Refund webhook: no order for ref', paymentRef);
    return;
  }

  const orderSnap = await firestore.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return;
  const order = orderSnap.data() || {};
  const refunds: OrderRefundEntry[] = Array.isArray(order.refunds) ? order.refunds : [];

  if (!refundId) {
    const pending = [...refunds].reverse().find((r) => r.status === 'pending' || r.status === 'failed');
    refundId = pending?.id || '';
  }
  if (!refundId) {
    console.warn('Refund webhook: no refund entry for order', orderId);
    return;
  }

  const paystackRefundId = data?.id ?? data?.refund_reference ?? null;
  const status = asNonEmptyString(data?.status).toLowerCase() || event.replace('refund.', '');

  if (event === 'refund.processed' || status === 'processed') {
    const entry = refunds.find((r) => r.id === refundId);
    await applyRefundProcessedState({
      orderId,
      refundId,
      paymentRef,
      paystackRefundId,
      paystackStatus: 'processed',
      order,
      amount: Number(entry?.amount) || 0,
      sellerAmount: Number(entry?.sellerAmount) || 0,
    });
    return;
  }

  if (event === 'refund.failed' || status === 'failed' || event === 'refund.needs-attention') {
    await markRefundFailed(
      orderId,
      refundId,
      event === 'refund.needs-attention'
        ? 'Refund needs attention (bank details may be required)'
        : asNonEmptyString(data?.message) || 'Paystack refund failed'
    );
    const { dualWriteOrderToPostgres } = await import('./order-chat.js');
    await dualWriteOrderToPostgres(orderId);
    return;
  }

  // pending / processing
  await patchRefundEntry(orderId, refundId, {
    status: 'pending',
    paystackRefundId,
    paystackStatus: status || event.replace('refund.', ''),
    error: null,
  });
  await firestore.collection('orders').doc(orderId).update({
    escrowStatus: 'refund_pending',
    refundStatus: 'pending',
    updatedAt: FieldValue.serverTimestamp(),
  });
  const { dualWriteOrderToPostgres } = await import('./order-chat.js');
  await dualWriteOrderToPostgres(orderId);
}

/**
 * Admin / ops retry for failed or stuck refunds.
 */
export const retryOrderRefund = onRequest(
  { secrets: [paystackSecret], invoker: 'public' },
  async (request, response) => {
    return corsHandler(request, response, async () => {
      try {
        if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
        await requireAdmin(request.headers.authorization || null);
        const orderId = asNonEmptyString(request.body?.orderId);
        if (!orderId) return sendError(response, 'orderId is required', 400);

        const result = await processOrderRefund(
          {
            orderId,
            reason: asNonEmptyString(request.body?.reason) || 'Admin retry refund',
            amountNgn:
              request.body?.amountNgn != null ? Number(request.body.amountNgn) : undefined,
            actorId: 'admin',
            actorRole: 'admin',
            cancelOrder: false,
            isRetry: true,
          },
          { secretKey: paystackSecret.value() }
        );
        return sendResponse(response, { success: true, refund: result });
      } catch (error: any) {
        const status = error?.code === 'ESCROW_RELEASED' ? 400 : 500;
        return sendError(response, error?.message || 'Internal server error', status);
      }
    });
  }
);
