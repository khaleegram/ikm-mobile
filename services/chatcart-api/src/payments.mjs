import { randomBytes } from 'node:crypto';
import { pool } from './db.mjs';
import {
  fromKobo,
  initializeTransaction as paystackInitialize,
  listBanks as paystackListBanks,
  resolveBankAccount,
  toKobo,
  verifyTransaction as paystackVerify,
  verifyWebhookSignature,
} from './paystack.mjs';
import {
  getSellerPayableBalance,
  getSellerReleasableEarnings,
  roundMoney,
} from './escrow.mjs';
import {
  PAYOUT_CANCELLED,
  PAYOUT_FAILED,
  PAYOUT_IN_FLIGHT,
  PAYOUT_PENDING,
  finalizePayoutTransfer,
  handleTransferWebhookEvent,
  initiatePayoutTransfer,
  savePayoutDetails as savePayoutDetailsCore,
} from './payouts.mjs';
import { handleRefundWebhookEvent } from './refunds.mjs';
import { appendTimelineEvent } from './orders.mjs';
import { quoteCheckout, lineSubtotalKobo } from './checkout-quote.mjs';
import {
  consumeTicketForOrder,
  recordRedemption,
} from './promo.mjs';

/**
 * Money in (Paystack charges) and money out (seller payouts).
 *
 * The Cloud Functions version wrote charge truth to Firestore `transactions`,
 * created one order per *checkout* and leaned on the client to tell it what was
 * bought. Three things change here:
 *
 *  1. The cart is stored server-side at initialize time, so a client crash after
 *     payment still produces the order.
 *  2. Charge truth is one row per reference in Neon, written from the webhook and
 *     from verify — never from the client's word alone.
 *  3. One charge becomes N seller orders. A cart spanning two sellers is two
 *     orders, each with its own commission and its own escrow, all pointing at one
 *     charge. The old model rejected cross-seller carts outright.
 */

const DEFAULT_COMMISSION_RATE = 0.05;
const DEFAULT_AUTO_RELEASE_DAYS = 7;

function str(value) {
  return String(value ?? '').trim();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Firestore-style ids, because the rest of the system already assumes that shape. */
function newOrderId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function httpError(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

/**
 * Platform commission rate for new orders.
 *
 * Flat for now — the tiered model in docs/checkout-commission-promo-model.md is not
 * live yet, so orders are stamped with the rate they were actually charged at and
 * old orders keep costing what they cost.
 */
function commissionRate() {
  const raw = Number(process.env.PLATFORM_COMMISSION_RATE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_COMMISSION_RATE;
}

// ─── Charge truth ──────────────────────────────────────────────────────────

/**
 * Record what the gateway says happened, keyed by reference.
 *
 * Deliberately never downgrades a `success` row: webhooks can arrive out of order,
 * and a late `charge.failed` for a reference that already succeeded would otherwise
 * erase the only record that the buyer paid.
 */
export async function recordChargeTruth({
  reference,
  status,
  amountNgn = null,
  currency = 'NGN',
  channel = null,
  customerEmail = null,
  paidAt = null,
  metadata = null,
  gatewayEvent = null,
  gatewayId = null,
  source = 'paystack-verify',
}) {
  const ref = str(reference);
  if (!ref) return;

  const nextStatus = str(status).toLowerCase() || 'unknown';

  await pool.query(
    `INSERT INTO transactions (
       reference, gateway, status, uid, amount, currency, channel,
       customer_email, paid_at, metadata, gateway_event, gateway_id, source
     ) VALUES ($1,'paystack',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
     ON CONFLICT (reference) DO UPDATE SET
       status         = CASE WHEN transactions.status = 'success' THEN 'success' ELSE EXCLUDED.status END,
       uid            = COALESCE(EXCLUDED.uid, transactions.uid),
       amount         = COALESCE(EXCLUDED.amount, transactions.amount),
       currency       = COALESCE(EXCLUDED.currency, transactions.currency),
       channel        = COALESCE(EXCLUDED.channel, transactions.channel),
       customer_email = COALESCE(EXCLUDED.customer_email, transactions.customer_email),
       paid_at        = COALESCE(EXCLUDED.paid_at, transactions.paid_at),
       metadata       = COALESCE(EXCLUDED.metadata, transactions.metadata),
       gateway_event  = COALESCE(EXCLUDED.gateway_event, transactions.gateway_event),
       gateway_id     = COALESCE(EXCLUDED.gateway_id, transactions.gateway_id),
       source         = EXCLUDED.source,
       updated_at     = now()`,
    [
      ref,
      nextStatus,
      str(metadata?.firebaseUid || metadata?.firebase_uid || metadata?.userId) || null,
      amountNgn != null && Number.isFinite(Number(amountNgn)) ? Number(amountNgn) : null,
      str(currency) || 'NGN',
      str(channel) || null,
      str(customerEmail).toLowerCase() || null,
      paidAt || null,
      metadata ? JSON.stringify(metadata) : null,
      str(gatewayEvent) || null,
      str(gatewayId) || null,
      source,
    ]
  );
}

export async function getChargeTruth(reference) {
  const ref = str(reference);
  if (!ref) return null;
  const { rows } = await pool.query(`SELECT * FROM transactions WHERE reference = $1`, [ref]);
  return rows[0] || null;
}

// ─── Initialize ────────────────────────────────────────────────────────────

export async function initializeTransaction({
  uid,
  email,
  amountNgn,
  callbackUrl,
  metadata = {},
  reference,
  cartItems,
  deliveryAddress,
  customerInfo,
  shippingType,
  shippingPrice,
  deliveryFeePaidBy,
  discountCode,
  promoCode = null,
  dealThreadId = null,
  idempotencyKey,
  callerEmail,
}) {
  const payerEmail = str(email || callerEmail).toLowerCase();
  if (!payerEmail) throw httpError('An email address is required', 400);

  const ref = str(reference) || `ikm_escrow_${str(uid).slice(0, 8)}_${Date.now()}`;

  // When the cart is present, the server prices the charge. The client's `amount` is
  // ignored on purpose: it is the only number a buyer can edit, and letting it decide
  // the price is how a discount becomes a free order.
  let priced = null;
  if (Array.isArray(cartItems) && cartItems.length) {
    const groups = groupCartBySeller(cartItems);
    priced = await quoteCheckout({
      buyerId: uid,
      groups,
      shippingKobo: Math.round(asNumber(shippingPrice) * 100),
      deliveryFeePaidBy,
      code: str(promoCode) || str(discountCode) || null,
    });

    if (!priced.ok) {
      // Refused before a charge exists, so the buyer is told why and nothing moves.
      throw httpError(priced.promo?.message || 'That code cannot be used on this order', 400, priced.promo?.code || 'PROMO_INELIGIBLE');
    }

    if (!priced.budget?.ok) {
      // A campaign that cannot fund the order is refused rather than honoured and
      // reconciled later, because the platform would be promising money it does not
      // have (spec §6.3).
      throw httpError('This offer is not available right now', 409, priced.budget.reason);
    }
  }

  const amount = priced
    ? roundMoney(priced.totals.buyerTotalKobo / 100)
    : roundMoney(asNumber(amountNgn));
  const amountKobo = priced ? priced.totals.buyerTotalKobo : toKobo(amount);
  if (!(amountKobo > 0)) throw httpError('Invalid payment amount', 400);

  const sessionMeta = {
    ...metadata,
    // The cart is the whole point of this row: it is what the webhook rebuilds the
    // order from if the client never comes back.
    ...(Array.isArray(cartItems) ? { cartItems } : {}),
    ...(deliveryAddress ? { deliveryAddress } : {}),
    ...(customerInfo ? { customerInfo } : {}),
    ...(shippingType ? { shippingType } : {}),
    ...(shippingPrice != null ? { shippingPrice } : {}),
    ...(deliveryFeePaidBy ? { deliveryFeePaidBy } : {}),
    ...(discountCode ? { discountCode } : {}),
    ...(dealThreadId ? { dealThreadId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    // The code travels with the session so the webhook rebuilds the order at the
    // discounted price even if the client never returns.
    ...(priced?.promo?.campaign ? { promoCode: priced.promo.campaign.code } : {}),
    ...(priced ? { pricing: priced.display } : {}),
  };

  const initialized = await paystackInitialize({
    email: payerEmail,
    amountKobo,
    callbackUrl,
    reference: ref,
    metadata: {
      ...sessionMeta,
      source: str(metadata?.source) || 'ikm-mobile',
      firebaseUid: uid,
      buyerId: str(metadata?.buyerId) || uid,
    },
  });

  const finalReference = str(initialized?.reference) || ref;

  await pool.query(
    `INSERT INTO payment_sessions (
       reference, uid, email, amount, amount_kobo, callback_url, metadata, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'initialized')
     ON CONFLICT (reference) DO UPDATE SET
       uid          = EXCLUDED.uid,
       email        = EXCLUDED.email,
       amount       = EXCLUDED.amount,
       amount_kobo  = EXCLUDED.amount_kobo,
       callback_url = EXCLUDED.callback_url,
       metadata     = EXCLUDED.metadata,
       updated_at   = now()`,
    [
      finalReference,
      uid,
      payerEmail,
      amount,
      amountKobo,
      str(callbackUrl) || null,
      JSON.stringify(sessionMeta),
    ]
  );

  return {
    success: true,
    authorizationUrl: initialized?.authorization_url,
    accessCode: initialized?.access_code,
    reference: finalReference,
    // Echoed so the client renders the server's numbers rather than its own.
    amount: priced ? priced.totals.buyerTotalKobo / 100 : amount,
    amountKobo: priced ? priced.totals.buyerTotalKobo : amountKobo,
    pricing: priced ? priced.display : null,
    promo: priced ? priced.promo : null,
  };
}

// ─── Verify ────────────────────────────────────────────────────────────────

export async function verifyTransaction({ uid, isAdmin, reference, expectedAmount, expectedEmail }) {
  const ref = str(reference);
  if (!ref) throw httpError('A payment reference is required', 400);

  const expectedEmailClean = str(expectedEmail).toLowerCase();

  // Trusted path: a charge already recorded as successful is final. No second
  // gateway call, no window for a mismatch to be argued about.
  const existing = await getChargeTruth(ref);
  if (existing && str(existing.status).toLowerCase() === 'success') {
    if (existing.uid && existing.uid !== uid && !isAdmin) {
      throw httpError('Forbidden: Payment belongs to another user', 403, 'FORBIDDEN');
    }
    const recorded = asNumber(existing.amount);
    if (expectedAmount != null && Math.abs(recorded - asNumber(expectedAmount)) > 0.01) {
      throw httpError(
        `Amount mismatch. Expected: ₦${asNumber(expectedAmount)}, received: ₦${recorded}`,
        400,
        'AMOUNT_MISMATCH'
      );
    }
    if (expectedEmailClean && str(existing.customer_email) && str(existing.customer_email) !== expectedEmailClean) {
      throw httpError('Payment email mismatch', 400, 'EMAIL_MISMATCH');
    }
    return toPaidResponse(existing);
  }

  const tx = await paystackVerify(ref);
  const status = str(tx?.status).toLowerCase();
  if (status !== 'success') {
    throw httpError(`Payment not successful. Status: ${status || 'unknown'}`, 400, 'NOT_PAID');
  }

  const amountNgn = fromKobo(tx?.amount);
  if (expectedAmount != null && Math.abs(amountNgn - asNumber(expectedAmount)) > 0.01) {
    throw httpError(
      `Amount mismatch. Expected: ₦${asNumber(expectedAmount)}, received: ₦${amountNgn}`,
      400,
      'AMOUNT_MISMATCH'
    );
  }

  const customerEmail = str(tx?.customer?.email || tx?.customer_email).toLowerCase();
  if (expectedEmailClean && customerEmail !== expectedEmailClean) {
    throw httpError('Payment email mismatch', 400, 'EMAIL_MISMATCH');
  }

  const metadataUid = str(
    tx?.metadata?.firebaseUid || tx?.metadata?.firebase_uid || tx?.metadata?.userId
  );
  if (metadataUid && metadataUid !== uid && !isAdmin) {
    throw httpError('Forbidden: Payment belongs to another user', 403, 'FORBIDDEN');
  }

  await recordChargeTruth({
    reference: str(tx?.reference) || ref,
    status,
    amountNgn,
    currency: str(tx?.currency) || 'NGN',
    channel: str(tx?.channel),
    customerEmail,
    paidAt: tx?.paid_at || null,
    metadata: tx?.metadata || null,
    gatewayId: str(tx?.id),
    source: 'paystack-verify',
  });

  return {
    success: true,
    paid: true,
    reference: str(tx?.reference) || ref,
    status,
    amount: amountNgn,
    currency: str(tx?.currency) || 'NGN',
    channel: str(tx?.channel) || '',
    paidAt: tx?.paid_at || null,
    customerEmail: customerEmail || null,
    metadata: tx?.metadata || null,
  };
}

function toPaidResponse(row) {
  return {
    success: true,
    paid: true,
    reference: row.reference,
    status: 'success',
    amount: asNumber(row.amount) || undefined,
    currency: row.currency || 'NGN',
    channel: row.channel || '',
    paidAt: row.paid_at,
    customerEmail: row.customer_email || null,
    metadata: row.metadata || null,
  };
}

// ─── Checkout → orders ─────────────────────────────────────────────────────

/**
 * Group cart lines by seller.
 *
 * A cart may span sellers; each seller gets their own order, and each order gets
 * its own commission and escrow. This is the reason `checkout_payments` exists —
 * the charge is shared, the orders are not.
 */
export function groupCartBySeller(cartItems) {
  const groups = new Map();
  for (const item of Array.isArray(cartItems) ? cartItems : []) {
    const sellerId = str(item?.sellerId);
    if (!sellerId) throw httpError('Every cart item needs a seller', 400, 'CART_INVALID');

    const quantity = asNumber(item?.quantity) || 1;
    const price = asNumber(item?.price);
    if (!(quantity > 0)) throw httpError('Every cart item needs a positive quantity', 400, 'CART_INVALID');

    if (!groups.has(sellerId)) groups.set(sellerId, { sellerId, items: [], subtotal: 0 });
    const group = groups.get(sellerId);
    group.items.push({
      productId: str(item?.id || item?.productId),
      name: str(item?.name),
      price,
      quantity,
    });
    group.subtotal = roundMoney(group.subtotal + price * quantity);
  }
  return [...groups.values()];
}

/**
 * Turn a verified charge into one order per seller.
 *
 * Idempotent per (charge, seller): a webhook and a client retry can both land, and
 * the buyer must not end up with two of everything. The guard is the unique index
 * on `idempotency_key`, written as `${idempotencyKey}__${sellerId}`.
 */
export async function createOrdersForCharge({
  buyerId,
  reference,
  chargeAmount,
  cartItems,
  deliveryAddress,
  customerInfo,
  shippingType,
  shippingPrice,
  deliveryFeePaidBy,
  discountCode,
  promoCode = null,
  dealThreadId = null,
  idempotencyKey,
  checkoutPaymentId = null,
  buyerEmail = null,
  source = 'checkout',
}) {
  const buyer = str(buyerId);
  if (!buyer) throw httpError('A buyer is required', 400);
  const ref = str(reference);
  if (!ref) throw httpError('A payment reference is required', 400);

  const groups = groupCartBySeller(cartItems);
  if (!groups.length) throw httpError('Invalid cart: Cart is empty', 400);

  // The price is recomputed here from the cart, never taken from the caller. This is
  // the same function `initializeTransaction` priced the charge with, so the amount
  // charged and the orders written cannot disagree — and a client cannot invent a
  // discount by editing a payload.
  const code = str(promoCode) || str(discountCode) || null;
  const pricing = await quoteCheckout({
    buyerId: buyer,
    groups,
    shippingKobo: Math.round(asNumber(shippingPrice) * 100),
    deliveryFeePaidBy,
    code,
  });

  if (!pricing.ok) {
    // A campaign that stopped being valid between paying and finalizing must not
    // silently become a full-price order. The money is already captured, so the order
    // is built at the price the buyer was charged and the difference is recorded.
    console.error(
      `Promo ${code} no longer valid on ${ref} (${pricing.promo?.code}): ` +
        `building orders without the discount`
    );
  }

  const quotesBySeller = new Map(
    (pricing.ok ? pricing.perSeller : []).map((entry) => [entry.sellerId, entry.quote])
  );
  const campaign = pricing.ok ? pricing.promo?.campaign || null : null;
  const releaseWindowDays = campaign?.releaseWindowDays ?? DEFAULT_AUTO_RELEASE_DAYS;

  const rate = commissionRate();
  // A checkout fee paid by the buyer is spread across the sellers' orders in
  // proportion to what each seller is owed, so no seller absorbs someone else's fee.
  const shipping = roundMoney(asNumber(shippingPrice));
  const cartTotal = roundMoney(groups.reduce((sum, group) => sum + group.subtotal, 0));
  const expectedCharge = pricing.ok
    ? roundMoney(pricing.totals.buyerTotalKobo / 100)
    : roundMoney(cartTotal + shipping);

  const client = await pool.connect();
  const created = [];
  let ticketAttempted = false;
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
      [
        buyer,
        str(buyerEmail) || null,
        str(customerInfo?.name) ||
          `${str(customerInfo?.firstName)} ${str(customerInfo?.lastName)}`.trim() ||
          null,
      ]
    );

    const checkoutId = checkoutPaymentId || `cp_${ref}`.slice(0, 64);
    if (!checkoutPaymentId) {
      await client.query(
        `INSERT INTO checkout_payments (
           id, buyer_id, paystack_reference, amount, status, line_items
         ) VALUES ($1,$2,$3,$4,'paid',$5::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [checkoutId, buyer, ref, chargeAmount, JSON.stringify(cartItems || [])]
      );
    }

    for (const group of groups) {
      // Share the shipping across sellers by subtotal weight.
      const share = cartTotal > 0 ? roundMoney((group.subtotal / cartTotal) * shipping) : 0;
      const orderTotal = roundMoney(group.subtotal + share);
      const commission = roundMoney(group.subtotal * rate);
      const priced = quotesBySeller.get(group.sellerId) || null;

      const childKey = idempotencyKey
        ? `${idempotencyKey}__${group.sellerId}`
        : `${ref}__${group.sellerId}`;

      const { rows: existingRows } = await client.query(
        `SELECT id FROM orders WHERE idempotency_key = $1 LIMIT 1`,
        [childKey]
      );
      if (existingRows.length) {
        created.push({ orderId: existingRows[0].id, sellerId: group.sellerId, alreadyExists: true });
        continue;
      }

      const orderId = newOrderId();

      // `total` is what the buyer paid for this order, and the refund path derives
      // how much is left to refund from it. So for a priced order it must be the
      // buyer's real total — discounted, and including the protection they paid —
      // or a full refund would try to return more than was ever charged.
      const buyerTotalNaira = priced ? roundMoney(priced.buyerTotalKobo / 100) : orderTotal;

      // Paid money is held, always. An order only leaves `held` through release
      // (buyer confirms / auto-release) or refund (cancel / dispute).
      await client.query(
        `INSERT INTO orders (
           id, customer_id, seller_id, status, items, total, shipping_price, shipping_type,
           delivery_address, customer_info, payment_reference, paystack_reference,
           payment_method, discount_code, escrow_status, commission_rate,
           auto_release_date, checkout_payment_id, payment_verified_at,
           seller_unread_count, buyer_unread_count, market_meta,
           items_subtotal_kobo, discount_kobo, protection_kobo, commission_kobo,
           commission_bps, seller_payout_kobo, buyer_total_kobo, platform_liability_kobo,
           funding_source, promo_type, promo_code, release_window_days,
           idempotency_key, deal_thread_id
         ) VALUES (
           $1,$2,$3,'Paid',$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10,$11,'Paystack',$12,'held',$13,
           now() + ($14 || ' days')::interval,$15, now(), 0, 0, $16::jsonb,
           $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
         )`,
        [
          orderId,
          buyer,
          group.sellerId,
          JSON.stringify(group.items),
          buyerTotalNaira,
          share,
          str(shippingType) || 'delivery',
          str(deliveryAddress) || null,
          JSON.stringify(customerInfo || {}),
          ref,
          ref,
          str(campaign?.code || discountCode) || null,
          priced ? priced.commissionBps / 10000 : rate,
          String(releaseWindowDays),
          checkoutId,
          JSON.stringify({
            source,
            commissionAmount: commission,
            sellerSubtotal: group.subtotal,
            // The kobo figures, so the order explains its own price without
            // re-deriving it from floats later.
            pricedInKobo: Boolean(priced),
          }),
          priced ? priced.itemsSubtotalKobo : Math.round(group.subtotal * 100),
          priced ? priced.discountKobo : 0,
          priced ? priced.protectionKobo : 0,
          priced ? priced.commissionKobo : Math.round(commission * 100),
          priced ? priced.commissionBps : null,
          priced ? priced.sellerPayoutKobo : Math.round((group.subtotal - commission + share) * 100),
          priced ? priced.buyerTotalKobo : Math.round(orderTotal * 100),
          priced ? priced.platformLiabilityKobo : 0,
          priced ? priced.fundingSource : 'buyer',
          priced && priced.isSubsidised ? (campaign ? 'awoof' : 'referral') : null,
          priced && priced.isSubsidised ? str(campaign?.code) || null : null,
          releaseWindowDays,
          // Written at last. The guard above reads this column, and until it was
          // written the check could never match — so a webhook and a client retry both
          // created orders and only the unique index stopped them, by erroring rather
          // than reporting `alreadyExists`.
          childKey,
          // The deal room an order belongs to. Without it a purchase made inside a
          // chat no longer links back to that chat, and the room shows no order.
          str(dealThreadId) || null,
        ]
      );

      // The ledger row and the liability are written in the same transaction as the
      // order, so an order can never exist with a subsidy that nothing recorded.
      if (priced?.isSubsidised) {
        await recordRedemption(client, {
          orderId,
          buyerId: buyer,
          sellerId: group.sellerId,
          quote: priced,
          promo: { campaign },
        });

        // One ticket covers the checkout, so it is attempted exactly once — not once
        // per seller, which would spend a ticket per order for one cart.
        if (pricing.promo?.requiresTicket && !ticketAttempted) {
          ticketAttempted = true;
          const ticketId = await consumeTicketForOrder(client, { userId: buyer, orderId });
          if (!ticketId) {
            // The quote said a ticket was available and it was gone by the time the
            // order was written. The charge is already captured, so the buyer gets
            // their order — but this order is discounted without one, and that is
            // exactly the abuse the ticket exists to stop. Loud, not silent.
            console.error(
              `Promo ${code} needed a ticket on ${ref} and none could be spent; ` +
                `order ${orderId} was discounted without one`
            );
          }
        }
      }

      created.push({
        orderId,
        sellerId: group.sellerId,
        total: buyerTotalNaira,
        commission,
        alreadyExists: false,
      });
    }

    await client.query(
      `UPDATE checkout_payments SET amount = $2, updated_at = now() WHERE id = $1`,
      [checkoutId, chargeAmount]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (expectedCharge > 0 && chargeAmount > 0 && chargeAmount + 0.01 < expectedCharge) {
    // The charge is already captured; refusing to build orders would strand the
    // money. Record the shortfall loudly instead and let support reconcile.
    console.error(
      `Charge shortfall on ${ref}: charged ₦${chargeAmount}, cart expects ₦${expectedCharge}`
    );
  }

  for (const order of created.filter((o) => !o.alreadyExists)) {
    appendTimelineEvent({
      orderId: order.orderId,
      event: 'order_paid',
      status: 'Paid',
      text: 'Payment verified',
      actorId: buyer,
      actorRole: 'buyer',
    }).catch((error) => console.error('Order paid timeline failed', order.orderId, error?.message));
  }

  return {
    created,
    checkoutPaymentId: checkoutPaymentId || `cp_${ref}`.slice(0, 64),
    pricing: pricing.ok
      ? { display: pricing.display, promo: pricing.promo, totals: pricing.totals }
      : { display: null, promo: pricing.promo, totals: null },
  };
}

/**
 * Client-facing checkout finalize: verify the charge, then build the orders.
 */
export async function finalizeCheckout({ uid, email, body = {} }) {
  const reference = str(body.reference);
  if (!reference) throw httpError('A payment reference is required', 400);

  const cartItems = body.cartItems;
  if (!Array.isArray(cartItems) || !cartItems.length) {
    throw httpError('Invalid cart: Cart is empty', 400);
  }

  const total = roundMoney(asNumber(body.total));

  if (total <= 0) {
    return {
      ...(await createOrdersForCharge({
        buyerId: uid,
        reference,
        chargeAmount: 0,
        cartItems,
        deliveryAddress: body.deliveryAddress,
        customerInfo: body.customerInfo,
        shippingType: body.shippingType,
        shippingPrice: body.shippingPrice,
        deliveryFeePaidBy: body.deliveryFeePaidBy,
        discountCode: body.discountCode,
        idempotencyKey: str(body.idempotencyKey) || null,
        buyerEmail: email,
        source: 'free-order',
      })),
      message: 'Free order created successfully',
      free: true,
    };
  }

  const truth = await verifyTransaction({
    uid,
    isAdmin: false,
    reference,
    expectedAmount: total,
  });

  const result = await createOrdersForCharge({
    buyerId: uid,
    reference: truth.reference || reference,
    chargeAmount: asNumber(truth.amount),
    cartItems,
    deliveryAddress: body.deliveryAddress,
    customerInfo: body.customerInfo,
    shippingType: body.shippingType,
    shippingPrice: body.shippingPrice,
    deliveryFeePaidBy: body.deliveryFeePaidBy,
    discountCode: body.discountCode,
    // What the session recorded when the charge was priced, so a finalize from the
    // client or from the webhook links the order to the same deal room.
    dealThreadId: str(body.dealThreadId) || (await dealThreadForReference(reference)),
    promoCode: await promoCodeForReference(truth.reference || reference),
    idempotencyKey: str(body.idempotencyKey) || null,
    buyerEmail: email,
    source: 'checkout',
  });

  return {
    ...result,
    orderId: result.created[0]?.orderId || null,
    orderIds: result.created.map((order) => order.orderId),
    alreadyExists: result.created.every((order) => order.alreadyExists),
    pricing: result.pricing,
    message: 'Order created successfully',
  };
}

/** The promo code a charge was initialized under, if any. */
async function promoCodeForReference(reference) {
  const ref = str(reference);
  if (!ref) return null;
  const { rows } = await pool.query(
    `SELECT metadata FROM payment_sessions WHERE reference = $1`,
    [ref]
  );
  const meta = rows[0]?.metadata;
  if (!meta || typeof meta !== 'object') return null;
  return str(meta.promoCode) || str(meta.discountCode) || null;
}

/** The deal room a charge was initialized from, so the order links back to its chat. */
async function dealThreadForReference(reference) {
  const ref = str(reference);
  if (!ref) return null;
  const { rows } = await pool.query(
    `SELECT metadata FROM payment_sessions WHERE reference = $1`,
    [ref]
  );
  const meta = rows[0]?.metadata;
  if (!meta || typeof meta !== 'object') return null;
  return str(meta.dealThreadId || meta.chatId) || null;
}

// ─── Webhook ───────────────────────────────────────────────────────────────

/**
 * Paystack webhook entry point.
 *
 * The body must be the raw bytes: the signature is an HMAC over exactly what
 * Paystack sent, so a parsed-and-reserialised body will never match.
 */
export async function handlePaystackWebhook({ rawBody, signature, payload }) {
  const header = str(signature);
  if (!rawBody || !header || !verifyWebhookSignature(rawBody, header)) {
    throw httpError('Invalid webhook signature', 401, 'BAD_SIGNATURE');
  }

  const event = str(payload?.event);
  const data = payload?.data || {};

  if (event.startsWith('refund.')) {
    const result = await handleRefundWebhookEvent(event, data).catch((error) => {
      console.error('Refund webhook handling failed:', error);
      return { handled: false, error: error?.message };
    });
    return { success: true, handled: event, result };
  }

  if (event.startsWith('transfer.')) {
    const result = await handleTransferWebhookEvent(event, data).catch((error) => {
      console.error('Transfer webhook handling failed:', error);
      return { handled: false, error: error?.message };
    });
    return { success: true, handled: event, result };
  }

  const reference = str(data?.reference);
  const status = str(data?.status).toLowerCase() || 'unknown';
  const amountNgn = fromKobo(data?.amount);
  const customerEmail = str(data?.customer?.email || data?.customer_email).toLowerCase() || null;

  if (!reference) throw httpError('Missing transaction reference', 400, 'NO_REFERENCE');

  await recordChargeTruth({
    reference,
    status,
    amountNgn: amountNgn > 0 ? amountNgn : null,
    currency: str(data?.currency) || 'NGN',
    channel: str(data?.channel),
    customerEmail,
    paidAt: data?.paid_at || null,
    metadata: data?.metadata || null,
    gatewayEvent: event || null,
    gatewayId: str(data?.id),
    source: 'paystack-webhook',
  });

  // The safety net: a buyer whose app died between paying and confirming still
  // gets their order. Everything needed is in payment_sessions.
  if (status === 'success') {
    await autoFinalizeFromCharge({ reference, amountNgn, customerEmail }).catch((error) => {
      console.error('Webhook auto-finalize failed (charge truth is saved):', reference, error);
    });
  }

  return { success: true };
}

/**
 * Rebuild the checkout from the stored session when the client never did.
 *
 * Runs through the same `createOrdersForCharge` as the client path, so the
 * idempotency guard makes it safe for both to run.
 */
export async function autoFinalizeFromCharge({ reference, amountNgn, customerEmail }) {
  const ref = str(reference);
  const { rows } = await pool.query(`SELECT * FROM payment_sessions WHERE reference = $1`, [ref]);
  const session = rows[0];

  if (!session) return { skipped: 'no-session' };
  if (session.status === 'finalized') return { skipped: 'already-finalized' };

  const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const cartItems = meta.cartItems;
  if (!Array.isArray(cartItems) || !cartItems.length) return { skipped: 'no-cart' };

  const buyerId = str(meta.buyerId) || str(session.uid);
  if (!buyerId) return { skipped: 'no-buyer' };

  const result = await createOrdersForCharge({
    buyerId,
    reference: ref,
    chargeAmount: asNumber(amountNgn),
    cartItems,
    deliveryAddress: meta.deliveryAddress,
    customerInfo: meta.customerInfo,
    shippingType: meta.shippingType,
    shippingPrice: meta.shippingPrice,
    deliveryFeePaidBy: meta.deliveryFeePaidBy,
    discountCode: meta.discountCode,
    // The session recorded the code when the charge was priced, so the webhook
    // rebuilds the same order — discount included — without the client.
    promoCode: str(meta.promoCode) || str(meta.discountCode) || null,
    dealThreadId: str(meta.dealThreadId || meta.chatId) || null,
    idempotencyKey: str(meta.idempotencyKey) || null,
    buyerEmail: str(session.email) || customerEmail,
    source: 'webhook-auto-finalize',
  });

  await pool.query(
    `UPDATE payment_sessions
        SET status = 'finalized', finalized_at = now(), updated_at = now()
      WHERE reference = $1`,
    [ref]
  );

  return { finalized: result.created.length, checkoutPaymentId: result.checkoutPaymentId };
}

// ─── Banks & payout details ────────────────────────────────────────────────

export async function listBanks(country = 'nigeria') {
  return paystackListBanks(country);
}

export async function resolveAccount(accountNumber, bankCode) {
  const account = str(accountNumber);
  const bank = str(bankCode);
  if (!account || !bank) throw httpError('Account number and bank code are required', 400);

  const resolved = await resolveBankAccount(account, bank);
  const accountName = str(resolved?.account_name);
  if (!accountName) throw httpError('Could not resolve that account number', 400);

  return { accountName, accountNumber: account, bankCode: bank };
}

export async function savePayoutDetails(userId, body) {
  return savePayoutDetailsCore(userId, body);
}

// ─── Payouts ───────────────────────────────────────────────────────────────

/**
 * Request a withdrawal.
 *
 * The payout row is written before the transfer is attempted, so a gateway failure
 * leaves a record to retry rather than a request that vanished. The balance check
 * happens inside the same transaction as the insert, so two requests firing at once
 * cannot both pass.
 */
export async function requestPayout({ sellerId, amountNgn }) {
  const amount = roundMoney(asNumber(amountNgn));
  if (!(amount > 0)) throw httpError('Payout amount must be greater than zero', 400);

  const { rows: userRows } = await pool.query(
    `SELECT payout_details FROM users WHERE id = $1`,
    [sellerId]
  );
  if (!userRows.length) throw httpError('Seller not found', 404);
  const bankDetails = userRows[0].payout_details || {};
  if (!str(bankDetails.accountNumber) || !str(bankDetails.bankCode)) {
    throw httpError('Add your bank details before requesting a payout', 400, 'NO_BANK_DETAILS');
  }

  const payable = await getSellerPayableBalance(sellerId);
  if (amount > payable + 0.001) {
    throw httpError(
      `You can withdraw up to ₦${payable.toLocaleString()} right now`,
      400,
      'INSUFFICIENT_BALANCE'
    );
  }

  const payoutId = `po_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the seller's payouts so two concurrent requests cannot both spend the
    // same balance.
    await client.query(`SELECT id FROM payouts WHERE seller_id = $1 FOR UPDATE`, [sellerId]);

    const { rows: inFlight } = await client.query(
      `SELECT id FROM payouts
        WHERE seller_id = $1 AND status = ANY($2::text[])
        LIMIT 1`,
      [sellerId, PAYOUT_IN_FLIGHT]
    );
    if (inFlight.length) {
      await client.query('ROLLBACK');
      throw httpError(
        'You already have a payout in progress. Wait for it to finish.',
        409,
        'PAYOUT_IN_FLIGHT'
      );
    }

    await client.query(
      `INSERT INTO payouts (
         id, seller_id, amount, status, bank_name, bank_code, account_number, account_name
       ) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7)`,
      [
        payoutId,
        sellerId,
        amount,
        str(bankDetails.bankName) || null,
        str(bankDetails.bankCode) || null,
        str(bankDetails.accountNumber) || null,
        str(bankDetails.accountName) || null,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const result = await initiatePayoutTransfer({ payoutId, sellerId, amountNgn: amount });

  return {
    success: true,
    payoutId,
    status: result.status,
    message: result.ok
      ? result.status === 'pending_otp'
        ? 'Transfer created — Paystack is waiting for an OTP'
        : 'Payout on its way'
      : result.message || 'Payout could not be sent',
  };
}

export async function cancelPayout({ sellerId, payoutId }) {
  const id = str(payoutId);
  if (!id) throw httpError('A payout id is required', 400);

  const { rows } = await pool.query(
    `UPDATE payouts
        SET status = $3, cancelled_at = now(), updated_at = now()
      WHERE id = $1 AND seller_id = $2 AND status = $4
      RETURNING *`,
    [id, sellerId, PAYOUT_CANCELLED, PAYOUT_PENDING]
  );

  if (!rows.length) {
    throw httpError('That payout can no longer be cancelled', 409, 'NOT_CANCELLABLE');
  }
  return { success: true, payoutId: id };
}

export async function finalizePayout({ payoutId, otp }) {
  return finalizePayoutTransfer({ payoutId: str(payoutId), otp: str(otp) });
}

export async function listPayouts({ sellerId = null, limit = 50 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  // Staff can list across sellers; a seller only ever sees their own.
  const { rows } = sellerId
    ? await pool.query(
        `SELECT * FROM payouts WHERE seller_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [sellerId, capped]
      )
    : await pool.query(`SELECT * FROM payouts ORDER BY created_at DESC LIMIT $1`, [capped]);
  return { payouts: rows };
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * What the seller is owed, and what they can withdraw today.
 *
 * Both numbers come from order escrow state; nothing is accumulated in a counter
 * that could drift from the orders themselves.
 */
export async function getSellerEarnings(sellerId) {
  const [releasable, payable, payoutRows, txRows] = await Promise.all([
    getSellerReleasableEarnings(sellerId),
    getSellerPayableBalance(sellerId),
    pool.query(
      `SELECT * FROM payouts WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [sellerId]
    ),
    pool.query(
      `SELECT id, status, escrow_status, total, commission_rate, funds_released_at, created_at
         FROM orders
        WHERE seller_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [sellerId]
    ),
  ]);

  const rate = commissionRate();
  const orders = txRows.rows.map((row) => {
    const orderRate = Number.isFinite(Number(row.commission_rate))
      ? Number(row.commission_rate)
      : rate;
    const total = asNumber(row.total);
    const commission = roundMoney(total * orderRate);
    return {
      orderId: row.id,
      status: row.status,
      escrowStatus: row.escrow_status,
      total,
      commission,
      net: roundMoney(total - commission),
      fundsReleasedAt: row.funds_released_at,
      createdAt: row.created_at,
    };
  });

  return {
    releasable,
    payable,
    pending: roundMoney(Math.max(0, releasable - payable)),
    payouts: payoutRows.rows,
    orders,
  };
}
