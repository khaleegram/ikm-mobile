# Exiting Firebase — plan

Status: **plan, not started.** This document exists to make the remaining Firebase
surface explicit and to sequence the exit so money keeps working throughout.

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

### Phase 1 — Payments and escrow (do this with the Paystack decision)
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
  business, and it is switched on by support, not self-serve. Settle it first so
  this layer is only moved once.

### Phase 2 — Seller shell
- Products, shipping, discount codes, store settings → Neon tables.
- Replace `onSnapshot` listeners with TanStack Query + the existing SSE/poll
  path already used for chat.
- Bigger than it looks: product images live in Firebase Storage. Decide whether
  media moves to the existing CDN/S3 path at the same time or stays.

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

- Does `chatcart-api` run on Cloud Run or Railway as the target of record? Docs
  reference both (`docs/cloud-run-deploy.md`, `railway.json` present).
- Does media move in Phase 2 or stay on Firebase Storage longer?
- Does the seller shell keep any Firestore reads during transition, or is it a
  hard cutover?
