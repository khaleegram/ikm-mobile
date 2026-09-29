/**
 * One Paystack charge → parent checkout_payment + N seller child orders.
 * Platform-held escrow (no Paystack subaccount split).
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { pendingLedgerFields } from './escrow';

function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}

export type EscrowLineItem = {
  postId: string;
  quantity: number;
  unitPrice: number;
  title?: string;
};

export type SellerCheckoutGroup = {
  sellerId: string;
  lines: EscrowLineItem[];
  items: { productId: string; name: string; price: number; quantity: number }[];
  total: number;
  primaryPostId: string;
  unitPrice: number;
  listedPrice: number | null;
  itemName: string;
};

export function marketOrderIdFromPaystackReference(reference: string, sellerId: string): string {
  const clean = String(reference || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  const seller = String(sellerId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 28);
  return `mkt_${clean || 'unknown'}__${seller || 'seller'}`;
}

export function checkoutPaymentIdFromReference(reference: string): string {
  const clean = String(reference || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 680);
  return `chk_${clean || 'unknown'}`;
}

export function childIdempotencyKey(reference: string, sellerId: string): string {
  return `${asNonEmptyString(reference)}__${asNonEmptyString(sellerId)}`;
}

/**
 * Load market posts and group cart lines (or single-item checkout) by seller.
 */
export async function buildSellerCheckoutGroups(input: {
  firestore: admin.firestore.Firestore;
  cartLineItems: EscrowLineItem[] | null;
  postId?: string;
  quantity?: number;
  unitPrice?: number;
  itemTitle?: string | null;
  bodySellerId?: string | null;
}): Promise<{ groups: SellerCheckoutGroup[]; checkoutTotal: number; error?: string }> {
  const firestore = input.firestore;
  const groupsMap = new Map<string, SellerCheckoutGroup>();

  if (input.cartLineItems && input.cartLineItems.length > 0) {
    for (const line of input.cartLineItems) {
      const linePostSnap = await firestore.collection('marketPosts').doc(line.postId).get();
      const linePost = linePostSnap.exists ? linePostSnap.data()! : null;
      const lineStatus = String(linePost?.status || 'active').toLowerCase();
      if (linePost && (lineStatus === 'hidden' || lineStatus === 'deleted')) {
        return { groups: [], checkoutTotal: 0, error: 'One or more cart items are no longer available' };
      }
      const sellerId = asNonEmptyString(
        linePost?.posterId || input.bodySellerId
      );
      if (!sellerId) {
        return { groups: [], checkoutTotal: 0, error: 'Seller ID missing from post' };
      }
      const name = String(
        line.title || linePost?.title || linePost?.description || 'Item'
      ).slice(0, 70);
      const listedPrice = linePostSnap.exists ? Number(linePost?.price || 0) : null;
      let group = groupsMap.get(sellerId);
      if (!group) {
        group = {
          sellerId,
          lines: [],
          items: [],
          total: 0,
          primaryPostId: line.postId,
          unitPrice: line.unitPrice,
          listedPrice,
          itemName: name,
        };
        groupsMap.set(sellerId, group);
      }
      group.lines.push(line);
      group.items.push({
        productId: `market_post_${line.postId}`,
        name,
        price: line.unitPrice,
        quantity: line.quantity,
      });
      group.total += line.unitPrice * line.quantity;
      if (group.lines.length > 1) {
        group.itemName = `${group.lines.length} items`.slice(0, 70);
      }
    }
  } else {
    const postId = asNonEmptyString(input.postId);
    if (!postId) {
      return { groups: [], checkoutTotal: 0, error: 'Missing product for this payment' };
    }
    const postSnap = await firestore.collection('marketPosts').doc(postId).get();
    const postData = postSnap.exists ? postSnap.data()! : null;
    const postStatus = String(postData?.status || 'active').toLowerCase();
    if (postData && (postStatus === 'hidden' || postStatus === 'deleted')) {
      return { groups: [], checkoutTotal: 0, error: 'This item is no longer available' };
    }
    const unitPrice = Number(input.unitPrice || 0);
    const quantity = Math.max(1, Math.floor(Number(input.quantity || 1)) || 1);
    if (!(unitPrice > 0)) {
      return {
        groups: [],
        checkoutTotal: 0,
        error: 'Checkout price missing. Reopen Complete purchase from the deal.',
      };
    }
    const sellerId = asNonEmptyString(postData?.posterId || input.bodySellerId);
    if (!sellerId) {
      return { groups: [], checkoutTotal: 0, error: 'Seller ID missing from post' };
    }
    const itemName = String(
      input.itemTitle || postData?.title || postData?.description || 'Marketplace Item'
    ).slice(0, 70);
    groupsMap.set(sellerId, {
      sellerId,
      lines: [{ postId, quantity, unitPrice, title: itemName }],
      items: [
        {
          productId: `market_post_${postId}`,
          name: itemName,
          price: unitPrice,
          quantity,
        },
      ],
      total: unitPrice * quantity,
      primaryPostId: postId,
      unitPrice,
      listedPrice: Number(postData?.price || 0) || null,
      itemName,
    });
  }

  const groups = [...groupsMap.values()];
  const checkoutTotal = groups.reduce((sum, g) => sum + g.total, 0);
  return { groups, checkoutTotal };
}

export type CommitCheckoutResult = {
  checkoutPaymentId: string;
  orderIds: string[];
  primaryOrderId: string;
  dealThreadId: string | null;
  alreadyExists: boolean;
  orders: Record<string, any>[];
};

/**
 * Upsert parent checkout payment and commit one child order per seller group.
 * Idempotent: skips sellers that already have an order for this Paystack reference.
 */
export async function commitMarketCheckoutOrders(input: {
  orderChat: typeof import('./order-chat.js');
  firestore: admin.firestore.Firestore;
  reference: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  deliveryAddress: string;
  commissionRate: number;
  paidAmount: number;
  groups: SellerCheckoutGroup[];
  cartLineItems: EscrowLineItem[] | null;
  cartSessionId?: string | null;
  requestedDealThreadId?: string | null;
  finalizedBy: 'client' | 'paystack-webhook';
  notify?: boolean;
}): Promise<CommitCheckoutResult> {
  const {
    orderChat,
    firestore,
    reference,
    buyerId,
    groups,
    commissionRate,
    paidAmount,
    cartLineItems,
    cartSessionId,
    requestedDealThreadId,
    finalizedBy,
    notify = false,
  } = input;

  if (!groups.length) {
    throw new Error('No seller groups to commit');
  }

  for (const group of groups) {
    if (group.sellerId === buyerId) {
      throw Object.assign(new Error('You cannot purchase your own item'), { statusCode: 403 });
    }
  }

  const existing = await orderChat.fetchNeonOrdersByReference(reference);
  const existingBySeller = new Map<string, Record<string, any>>();
  for (const order of existing.orders) {
    const sid = asNonEmptyString(order.sellerId || order.seller_id);
    if (sid) existingBySeller.set(sid, order);
  }

  const checkoutPaymentId = checkoutPaymentIdFromReference(reference);
  const checkout = await orderChat.upsertNeonCheckoutPayment({
    id: checkoutPaymentId,
    buyerId,
    paystackReference: reference,
    amount: paidAmount,
    currency: 'NGN',
    status: 'paid',
    cartSessionId: cartSessionId || null,
    lineItems: cartLineItems || groups.flatMap((g) => g.lines),
  });

  const nowIso = new Date().toISOString();
  const committedOrders: Record<string, any>[] = [];
  let createdAny = false;

  for (const group of groups) {
    const existingOrder = existingBySeller.get(group.sellerId);
    if (existingOrder?.id) {
      committedOrders.push(existingOrder);
      continue;
    }

    // Also skip if FS doc already exists (legacy / race)
    const orderId = marketOrderIdFromPaystackReference(reference, group.sellerId);
    const fsSnap = await firestore.collection('orders').doc(orderId).get();
    if (fsSnap.exists) {
      try {
        await orderChat.dualWriteOrderToPostgres(orderId, { bumpPurchaseCount: true });
      } catch (syncErr) {
        console.warn('Legacy FS order Neon backfill failed', orderId, syncErr);
      }
      const neon = await orderChat.fetchNeonOrderById(orderId);
      committedOrders.push(neon || { id: orderId, ...(fsSnap.data() || {}), sellerId: group.sellerId });
      continue;
    }

    let dealThreadId: string | null =
      groups.length === 1 ? requestedDealThreadId || null : null;
    try {
      dealThreadId = await orderChat.ensureDealThreadForOrder({
        buyerId,
        postId: group.primaryPostId,
        sellerId: group.sellerId,
        threadId: dealThreadId,
      });
    } catch (linkError) {
      console.error('Failed to ensure deal thread before order commit:', linkError);
    }

    const childTotal = group.total;
    const commission = childTotal * commissionRate;
    const sellerEarning = childTotal - commission;

    const orderPayload: Record<string, any> = {
      id: orderId,
      customerId: buyerId,
      sellerId: group.sellerId,
      postId: group.primaryPostId,
      idempotencyKey: childIdempotencyKey(reference, group.sellerId),
      checkoutPaymentId: checkout?.id || checkoutPaymentId,
      items: group.items,
      total: childTotal,
      shippingPrice: 0,
      shippingType: 'pickup',
      status: 'Processing',
      deliveryAddress: input.deliveryAddress.trim(),
      customerInfo: {
        name: input.buyerName,
        email: input.buyerEmail,
        phone: input.buyerPhone.trim(),
      },
      paymentMethod: 'Paystack Escrow',
      paymentReference: reference,
      paystackReference: reference,
      escrowStatus: 'held',
      commissionRate,
      dealThreadId: dealThreadId || null,
      chatThreadId: dealThreadId || null,
      marketMeta: {
        fromChatId: dealThreadId || requestedDealThreadId || null,
        postId: group.primaryPostId,
        agreedUnitPrice: group.unitPrice,
        listedPrice: group.listedPrice || null,
        cartSessionId: cartSessionId || null,
        lineItems: group.lines,
        checkoutPaymentId: checkout?.id || checkoutPaymentId,
        siblingSellerCount: groups.length,
        finalizedBy,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      paymentVerifiedAt: nowIso,
      sellerUnreadCount: 1,
      buyerUnreadCount: 0,
    };

    try {
      await orderChat.commitAndMirrorOrder(orderPayload, {
        bumpPurchaseCount: true,
        timeline: [
          {
            event: 'order_paid',
            status: 'Processing',
            text: 'Payment verified',
            actorId: buyerId,
            actorRole: 'buyer',
            createdAt: nowIso,
          },
        ],
      });
    } catch (commitError) {
      const raced = await orderChat.fetchNeonOrdersByReference(reference);
      const racedOrder = raced.orders.find(
        (o) => asNonEmptyString(o.sellerId || o.seller_id) === group.sellerId
      );
      if (racedOrder?.id) {
        committedOrders.push(racedOrder);
        continue;
      }
      throw commitError;
    }

    createdAny = true;

    try {
      await firestore.collection('transactions').doc(`ledger_${orderId}`).set(
        {
          id: `ledger_${orderId}`,
          type: 'sale',
          amount: sellerEarning,
          commission,
          commissionRate,
          orderId,
          sellerId: group.sellerId,
          customerId: buyerId,
          paymentReference: reference,
          checkoutPaymentId: checkout?.id || checkoutPaymentId,
          description: `Sale from order #${orderId.slice(0, 7)}`,
          // Earned by the seller, but NOT withdrawable until escrow releases.
          // Writing 'completed' here was how sellers could withdraw money for
          // orders that had never been delivered.
          ...pendingLedgerFields(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      // Backward-compat alias for single-seller refunds that still look up ledger_${ref}
      if (groups.length === 1) {
        await firestore.collection('transactions').doc(`ledger_${reference}`).set(
          {
            id: `ledger_${reference}`,
            type: 'sale',
            amount: sellerEarning,
            commission,
            commissionRate,
            orderId,
            sellerId: group.sellerId,
            customerId: buyerId,
            paymentReference: reference,
            aliasOf: `ledger_${orderId}`,
            ...pendingLedgerFields(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      for (const line of group.lines) {
        await firestore.collection('marketPosts').doc(line.postId).set(
          {
            lastBuyerId: buyerId,
            purchaseCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (ledgerError) {
      console.warn('Ledger/post mirror after Neon commit failed', orderId, ledgerError);
    }

    try {
      await orderChat.createSystemMessage({
        orderId,
        event: 'order_paid',
        dealThreadId,
        customText: `Money held safely — NGN ${Number(childTotal).toLocaleString()} received.`,
      });
    } catch {
      // non-fatal
    }

    if (notify) {
      import('./notifications.js')
        .then((mod) => {
          mod
            .notifyBuyer({
              buyerId,
              event: 'payment_success',
              orderId,
              orderSummary: `${group.itemName} — NGN ${Number(childTotal).toLocaleString()}`,
              chatRoomId: dealThreadId,
            })
            .catch((e: any) => console.error('Failed to notify buyer:', e));
          mod
            .notifySeller({
              sellerId: group.sellerId,
              event: 'new_order',
              orderId,
              orderSummary: `${group.itemName} — NGN ${Number(childTotal).toLocaleString()}`,
              chatRoomId: dealThreadId,
            })
            .catch((e: any) => console.error('Failed to notify seller:', e));
        })
        .catch(() => {});
    }

    committedOrders.push({
      id: orderId,
      sellerId: group.sellerId,
      dealThreadId,
      total: childTotal,
    });
  }

  const orderIds = committedOrders.map((o) => String(o.id || '')).filter(Boolean);
  const primary = committedOrders[0] || {};
  const primaryOrderId = String(primary.id || orderIds[0] || '');
  const dealThreadId =
    asNonEmptyString(primary.dealThreadId || primary.chatThreadId) || null;

  await firestore.collection('payment_sessions').doc(reference).set(
    {
      status: 'finalized',
      orderId: primaryOrderId,
      orderIds,
      checkoutPaymentId: checkout?.id || checkoutPaymentId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    checkoutPaymentId: checkout?.id || checkoutPaymentId,
    orderIds,
    primaryOrderId,
    dealThreadId,
    alreadyExists: !createdAny && orderIds.length > 0,
    orders: committedOrders,
  };
}
