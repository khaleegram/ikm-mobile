# Exiting Firebase — plan

Status: **plan, Phase 1 code complete.** This document exists to make the remaining
Firebase surface explicit and to sequence the exit so money keeps working
throughout.

## Why exit

Three real reasons, in order of urgency:

1. **The money layer is on Firebase and it is the layer that hurts.** Paystack
   init/finalize/refunds/payouts are Cloud Functions writing Firestore. Every
   escrow bug fixed so far has been a Firestore shape problem.
2. **Two backends means two truths.** Orders live in Neon (primary) and are
   mirrored to Firestore for seller/admin. Every mutation has to remember to
   dual-write; forgetting is silent divergence.
3. **Operational weight.** 86 Cloud Functions in `us-central1` are at the
   region's CPU quota ceiling, which is why deploys now fail in batches.

Not a reason: "Firebase is bad." Firebase Auth and FCM are fine and are the
last things that should move.

## What is already off Firebase

Done, from `docs/architecture-boundaries.md`:

- Posts / feed / search / likes / comments
- Social graph (follow / save / block)
- Sounds
- Chat and deal rooms
- Market order **reads** and **write primary**
- Buyer profile, identity avatars/names

## What is still on Firebase

### Shells (20 screens)

| Shell | Screens |
|-------|---------|
| Seller `app/(tabs)/` | analytics, customers, index, marketing, orders, payouts, products, reports, settings, shipping |
| Admin `app/(admin)/` | disputes, index, orders, products, reports, security, settings, users, users/* |

### Data (30+ collections still referenced)

Highest-traffic, hardest to move first:

`orders` (99 refs), `transactions` (57), `marketPosts` (28), `users` (27),
`products` (24), `payouts` (18)

Rest: `shipping_zones`, `parks`, `discount_codes`, `stores`, `messages`, `chat`,
`platform_settings`, `notifications`, `reviews`, `marketPostComments`,
`marketChats`, `payment_sessions`, `api_keys`, `access_logs`, `timeline`,
`refund_lookups`, `marketPostScores`, `marketPostInteractions`, `fcmTokens`,
`trendingHashtags`, `support_tickets`, `security_settings`,
`payment_verifications`, `payments`

### Functions (86)

Grouped roughly as: payments & escrow, orders, products, market, users,
settings/shipping/parks, reports, notifications, admin/security, support.

### Client surface

59 files under `lib/`, `app/`, `components/` still touch Firestore directly
(`onSnapshot` listeners or client SDK reads).

## Target

One backend: `chatcart-api` (Fastify + Neon) owns all writes and all reads.
Firestore disappears as a data store. Firebase Auth stays (device push stays on
FCM) unless there is a separate reason to move identity — moving auth is the
single highest-risk, lowest-reward part of this and is explicitly deferred.

Client rule after the exit: **no `firebase/firestore` import anywhere in
`lib/`, `app/`, or `components/`.**

## Sequencing

Order matters: money first, chrome last. Each phase should be independently
shippable and leave the app working.

### Phase 0 — Stop the bleeding
- Freeze new Firestore writes. Any new feature goes to Neon only.
- Inventory `dualWriteOrderToPostgres` call sites and confirm none are optional.

#### Phase 0 inventory (done)

`dualWriteOrderToPostgres` is defined once (`functions/src/order-chat.ts`) and has
16 call sites: 8 in `orders.ts`, 4 in `refunds.ts`, 2 in `admin.ts`, 1 in
`disputes.ts`, 1 in `market-checkout.ts`, and 1 internal drain loop.

Failure handling:

| Handling | Sites | Meaning |
|---|---|---|
| **Propagates** (awaited, no catch) | 14 | A Neon failure fails the request. No silent divergence |
| **Best-effort, logged** | 2 | Deliberate, on paths designed to retry |

The two best-effort sites are `market-checkout.ts:256` (legacy FS-order backfill —
a failed backfill must not block a checkout, and it is idempotent) and
`orders.ts:1092` (inside the per-order catch of `cancelIgnoredOrders`, which counts
the order as `skipped` and retries on the next sweep). Neither is silent: both log.

**Gap found and fixed.** The dual-write model mutates Firestore *first*, then
pushes to Neon. When the push failed, the error propagated and the two stores
diverged — but **nothing recorded the divergence**. The reverse drain queries
`orders.where('needsNeonSync', '==', true)`, and no code path ever *set* that field;
it was only ever deleted. So the marker the repair job looked for could never be
created, and a failed push left Firestore permanently ahead of the primary.

`dualWriteOrderToPostgres` now records `needsNeonSync`, `neonSyncError` and
`neonSyncFailedAt` on the order before rethrowing, so the existing drain repairs it.
The contract is unchanged — it still throws — and the drain already strips those
fields before sending to Neon.

Still to do in Phase 0:

- Decide and record the freeze rule in a form that is enforceable, not just written
  down. Today nothing prevents a new Firestore write from being added.
- **Confirm something actually invokes the drain.** `drainOrderOutboxToFirestore`
  is deployed as an `https` function, and the only scheduled functions in the
  project are `escrowMaintenance` and `remindUnshippedOrders`. If no external
  scheduler calls it, the repair marker is recorded and never acted on — which
  would make the fix above inert. Verify in Cloud Scheduler, or add a scheduled
  wrapper.

### Phase 1 — Payments and escrow (do this with the Paystack decision)

**Code complete. Not yet switched on.** Every module is written and the API boots
with the new routes registered. The deal checkout now uses them — that part *is*
switched on in the app — but the API cannot take a charge until the Paystack secret
exists in its environment, so nothing is live in production yet. The Cloud Functions
are untouched and still authoritative for the marketplace cart.

| Step | State |
|---|---|
| Paystack config on the API | **Done** — `config.mjs` (secret, base URL, fee constants), `isPaystackConfigured()` |
| Paystack client | **Done** — `src/paystack.mjs`: request helper, constant-time signature verification, charge/transfer/refund calls, fee + protection maths, payout cost helpers |
| Money schema | **Done** — `migrations/014_money_schema.sql`, applied. Adds `transactions`, `refund_lookups`, `payouts`, `users.payout_details` |
| Checkout session schema | **Done** — `migrations/015_payment_sessions.sql`, applied. Stores the cart server-side so a paid charge still becomes an order when the client dies |
| Escrow | **Done** — `src/escrow.mjs` |
| Payouts | **Done** — `src/payouts.mjs` |
| Refunds | **Done** — `src/refunds.mjs` |
| Charge endpoints | **Done** — `src/payments.mjs` |
| Route registration + raw-body webhook | **Done** — `src/index.mjs` (13 routes; webhook in its own scope so the HMAC sees the exact bytes Paystack sent) |
| Staff gate | **Done** — `requireAdmin()` in `auth.mjs`, reads `users.role` from the database rather than trusting the token |
| Deal checkout switched to the API | **Done** — the deal checkout sends the cart (never an amount), the API prices it, and the review sheet itemises the server's figures. `POST /v1/checkout/quote` for the breakdown, `/v1/payments/initialize` to charge, `/v1/payments/checkout/finalize` to build the orders. The legacy Cloud Function path is untouched and still serves the marketplace cart |
| Railway env + dashboard webhook switch | Not started — set `PAYSTACK_SECRET_KEY` (and `IDENTITY_HASH_SECRET` for the identity ladder), then point the Paystack webhook at `/v1/payments/webhook` |

Four design decisions taken during the port, all deliberate:

- **No sale ledger table.** The Cloud Functions version kept a separate
  `transactions` ledger written at payment time and promoted on release, and its
  `status` flag famously drifted from the order — it was written `completed` the
  moment the buyer paid, which let sellers withdraw for undelivered orders. In
  Neon the balance is derived from the `orders` row itself, so there is nothing to
  drift. `escrow.mjs` reads `orders.escrow_status` and nothing else.
- **Refunds in flight block withdrawal.** The ledger used to exclude in-flight
  refunds from earnings. Deriving from orders drops that guard unless it is
  restored explicitly, so `hasRefundInFlight()` puts it back: a released order with
  an unsettled refund counts as pending, not withdrawable.
- **One charge → N seller orders.** The old checkout refused a cart spanning two
  sellers outright. Now `createOrdersForCharge()` writes one order per seller, each
  with its own commission and its own escrow, all pointing at one
  `checkout_payments` row and one Paystack reference. Shipping is split across
  sellers by subtotal weight so no seller absorbs another's fee.
- **The cart is stored before the money moves.** `payment_sessions` is written at
  initialize time. Without it the `charge.success` webhook has a reference and an
  amount but no idea what was bought, so a buyer whose app died mid-checkout is
  charged and gets nothing. The webhook now rebuilds the order through the same
  `createOrdersForCharge()` the client path uses, and the idempotency key makes it
  safe for both to run.

Charge truth is also never downgraded: a late `charge.failed` webhook cannot
overwrite a reference already recorded `success`, because webhooks arrive out of
order and that row is the only record the buyer paid.

The verification that matters: `paystack.mjs`'s fee and protection functions
reproduce §4 and §4.1 of `docs/checkout-commission-promo-model.md` exactly,
including the ₦2,462.50 boundary and the ₦2,000 cap, with zero under-collections
across ~22,000 sampled item prices. The commission model's arithmetic is now
executable rather than asserted.

- Move Paystack initialize / finalize / refund / payout logic out of Cloud
  Functions into `chatcart-api` as its own module.
- Paystack webhook handler moves too — it becomes a Fastify route.
- This is Phase 1 because it is the layer that carries money and the layer that
  has been breaking. It also pays for the rest of the exit by removing the
  dual-write requirement for orders.
- Blocker: **Manual Payouts is not enabled.** Paystack settles this account's
  balance to its bank account daily, and the Transfers API is refused outright
  (`transfer_unavailable`, `can_transfer: False`) because the tier is still Starter
  Business with `compliance_status: SUBMITTED` and `reviewed_at: null`. Both are the
  same prerequisite: Paystack's *Manual Payouts* requires a registered, compliant
  business, and it is switched on by support, not self-serve. This does **not**
  block moving the code — only sending money, which is already blocked today.

### Phase 2 — Seller shell
- Products, shipping, discount codes, store settings → Neon tables.
- Replace `onSnapshot` listeners with TanStack Query + the existing SSE/poll
  path already used for chat.
- Media is **not** an open question: `chatcart-api` already stores media in
  **Cloudflare R2** (`services/chatcart-api/src/media.mjs`, presigned via
  `@aws-sdk/client-s3`), and `scripts/migrate-firebase-storage-to-r2.mjs` already
  exists. Phase 2 is pointing the seller shell at that path, not building one.

### Phase 3 — Admin shell
- Users, roles, moderation, platform settings, reports, security settings.
- `grantAdminRole` / `revokeAdminRole` move to Neon + the existing admin gate.
- Lowest urgency: low traffic, internal users only.

### Phase 4 — Destructive cleanup
- Delete the Cloud Functions that are now dead. Delete requires
  `firebase functions:delete <name> --force` **before** a deploy will succeed
  (a deploy aborts if a deployed function has no local source).
- Remove Firestore security rules and indexes once nothing reads them.
- Delete the Firestore database only after a full backup export.

## Risks

- **Divergence during transition.** Two stores, two truths. Any phase that
  leaves both readable must have one clear owner per field.
- **Region CPU quota.** 86 functions already exceed the `us-central1` ceiling, so
  function deploys fail in batches today. This blocks Phase 1 if it stays on
  Cloud Functions — another argument for moving payments to `chatcart-api`
  (Cloud Run / Railway) rather than editing functions further.
- **Media.** Firebase Storage is not Firestore; it is a separate migration and
  is deliberately excluded above.
- **Auth.** Do not scope-creep into it.

## Open questions

- Does `chatcart-api` run on Cloud Run or Railway? **Settled: Railway.**
  `functions/.env` points at `https://chatcart-production.up.railway.app/v1`,
  `services/chatcart-api/railway.json` holds the deploy config, and `/health`
  returns `{"ok":true,"service":"chatcart-api"}` in production. The Cloud Run
  references are stale — `docs/cloud-run-deploy.md` is marked archived.
- Does media move in Phase 2 or stay on Firebase Storage? **Settled: R2.**
  `chatcart-api` already reads and writes R2, and the Firebase→R2 migration script
  is written. Only the seller shell's references need repointing.
- Does the seller shell keep any Firestore reads during transition, or is it a
  hard cutover? **Still open.** This one is a genuine choice, not a lookup.

## Phase 1 surface — what actually moves

Inventory of the money layer, for when the Paystack prerequisite clears.

**HTTP endpoints (17)** — all in `functions/src/payments.ts` unless noted:

| # | Endpoint | Kind |
|---|---|---|
| 1 | `initializePaystackTransaction` | charge |
| 2 | `verifyPaystackTransaction` | charge |
| 3 | `verifyPaymentAndCreateOrder` | charge |
| 4 | `finalizeMarketEscrowPayment` | charge + escrow |
| 5 | `paystackWebhook` | webhook |
| 6 | `getTransactionTruth` | read |
| 7 | `findRecentTransactionByEmail` | read |
| 8 | `getBanksList` | reference |
| 9 | `resolveAccountNumber` | reference |
| 10 | `savePayoutDetails` | payout |
| 11 | `requestPayout` | payout |
| 12 | `cancelPayoutRequest` | payout |
| 13 | `finalizePayout` | payout |
| 14 | `getAllPayouts` | payout read |
| 15 | `calculateSellerEarnings` | read |
| 16 | `getSellerTransactions` | read |
| 17 | `retryOrderRefund` (`refunds.ts`) | refund |

**Internal logic to port** (not endpoints):

- `refunds.ts` — `processOrderRefund`, `handleRefundWebhookEvent`
- `escrow.ts` — `releaseOrderEscrow`, `getSellerReleasableEarnings`, status constants
- `payouts.ts` — `getOrCreateTransferRecipient`, `initiatePayoutTransfer`,
  `finalizePayoutTransfer`, `handleTransferWebhookEvent`

**Target shape in `chatcart-api`:** new modules `paystack.mjs` (client + signature),
`payments.mjs`, `escrow.mjs`, `refunds.mjs`, `payouts.mjs`, registered in
`index.mjs` alongside the existing routers.

### Phase 1 hazards

Three things that make this move riskier than moving a read path:

1. **The secret lives in Firebase only.** `PAYSTACK_SECRET_KEY` is a Firebase
   secret (`defineSecret`). It must also exist in the Railway environment, and for
   a cutover window both runtimes need it.
2. **Raw-body signature verification.** `paystackWebhook` verifies
   `x-paystack-signature` against the **raw** body. `chatcart-api` currently builds
   `Fastify({ logger: true })` with no `addContentTypeParser` and no raw-body
   capture (`src/index.mjs:112`), so JSON is parsed before any handler sees it. The
   route needs an explicit raw-body parser for its content type, kept scoped to that
   route so the rest of the API is unaffected. This fails closed — every webhook
   401s — and fails *silently* in the sense that nothing else breaks, so it must be
   tested with a real signed payload, not a hand-written one.
3. **Only one webhook should be live at a time.** The Paystack dashboard holds a
   single webhook URL. During cutover, either the old Cloud Function or the new
   Fastify route must receive each event — not both — or refunds and transfers get
   applied twice. Sequence it as: deploy the route, verify signature against a
   replay, then switch the dashboard URL in one step.

Note that `paystackWebhook` currently dispatches three event families
(`charge.*`, `refund.*`, `transfer.*`). That is one route in Fastify, not three.
