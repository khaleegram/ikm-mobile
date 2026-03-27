# Payments + Orders System Design (Pro Flow)

Last updated: 2026-03-04

## 1. Goals
- Never lose a successful payment.
- Never create duplicate orders for one payment.
- Show deterministic user state after checkout (no silent stalls).
- Keep seller payout release tied to order lifecycle.

## 2. Core Architecture

### 2.1 Client Responsibilities
- Start checkout by calling `initializePaystackTransaction`.
- Persist a local `pendingEscrowCheckout` record before opening checkout.
- Move to a dedicated confirmation route after user completes payment.
- Poll payment verification with retry/backoff while showing progress UI.
- Create order only after verified payment status is `success`.

### 2.2 Server Responsibilities (Cloud Functions)
- `initializePaystackTransaction`: issue Paystack checkout URL with server-side secret key.
- `verifyPaystackTransaction`: verify payment by reference from Paystack API.
- Webhook endpoint (recommended next): receive asynchronous Paystack events and write transaction truth to Firestore.

### 2.3 Data Boundaries
- `orders` collection stores:
  - `paymentReference`
  - `paystackReference`
  - `escrowStatus = held|released|refunded`
  - `status = Processing|Sent|Delivered|...`
- Idempotency rule:
  - Before order create, query by `paystackReference/paymentReference`.
  - If existing order found, return existing order instead of creating new.

## 3. Runtime State Machine

### 3.1 Checkout State
`idle -> initializing -> checkout_open -> payment_submitted -> confirming -> order_created -> redirected`

### 3.2 Failure States
- `checkout_cancelled`: user closed checkout before success.
- `confirmation_pending`: paid but gateway not yet confirmed (retry allowed).
- `confirmation_failed`: hard failure (invalid reference/auth/server).

### 3.3 Recovery
- Pending checkout data in AsyncStorage allows recovery after app close/restart.
- Confirmation route can resume with `reference` param + pending payload.

## 4. UX Contract
- On `I have completed payment`, app must always navigate to confirmation screen.
- Confirmation screen must always show one of:
  - `Confirming payment...`
  - `Creating your order...`
  - actionable error with `Retry Confirmation`.
- No silent close with no navigation.

## 5. Security Rules
- Paystack secret key only in backend runtime (Cloud Secret Manager).
- Client never verifies payment directly against Paystack secret.
- Order creation only after server-verified payment success.

## 6. Recommended Next Backend Upgrade
- Add Paystack webhook function and `transactions/{reference}` document.
- Confirmation route then reads transaction truth from Firestore first, then fallback polls verify endpoint.
- This removes timing races and reduces client polling.

## 7. What is implemented now
- Dedicated confirmation route with retry polling.
- Manual completion button now routes to confirmation flow.
- Expected Paystack `abandoned/pending` 400 states are treated as retryable states.
- Order create deduplicates by payment reference.
