# Paystack Refunds (Escrow)

Real money refunds for ChatCart escrow cancellations and dispute resolutions.

## Deploy

```bash
cd functions
npm run build
firebase deploy --only functions:updateOrderStatus,functions:respondToAvailabilityCheck,functions:autoAcceptExpiredOrders,functions:resolveDispute,functions:paystackWebhook,functions:retryOrderRefund,functions:calculateSellerEarnings
```

Ensure `PAYSTACK_SECRET_KEY` is set as a Firebase secret and bound to these functions.

## Paystack Dashboard

Webhook URL must point at `paystackWebhook` and include:

- `refund.pending`
- `refund.processing`
- `refund.processed`
- `refund.failed`
- `refund.needs-attention`

## Flow

1. Cancel / dispute refund → `processOrderRefund` → `POST /refund`
2. Order `escrowStatus` = `refund_pending`, `refunds[]` entry `pending`
3. Webhook `refund.processed` → `escrowStatus` = `refunded`, ledger sale marked refunded, buyer notified

## Admin retry

`POST retryOrderRefund` with `{ orderId }` (admin auth) for failed / stuck refunds.

## Guards

- No refund if escrow already `released`
- Idempotent if already `refunded` / pending with Paystack id
- Missing payment reference → manual path (order cancelled, flagged in chat)
- Seller earnings exclude refunded and refund-pending sales
