# Firebase Market Core Exit — runbook

> **Boundaries:** Admin + seller `(tabs)` intentionally remain on Firestore.
> See [`docs/architecture-boundaries.md`](./architecture-boundaries.md) before treating those as migration bugs.

Keep **Firebase Auth + FCM**. Market posts/social/chat/media/sounds live on **chatcart-api + Neon + R2**.

## Apply schema

Schema migrations are unified under one runner (`scripts/migrate.mjs`) that applies every
`services/chatcart-api/migrations/NNN_*.sql` file in ascending numeric order and tracks what
has been applied in a `schema_migrations` table. It is always safe to re-run — already-applied
migrations are skipped, and editing an applied migration's contents fails loudly instead of
silently drifting from what actually ran in prod.

```bash
cd services/chatcart-api
npm run migrate:dry-run   # list any pending migrations without applying them
npm run migrate           # apply all pending migrations, in order
```

New market APIs (auth required where noted):

- `GET /v1/posts/search?q=`
- `GET /v1/posts?soundId=` — posts using a sound (Neon)
- `GET /v1/sounds`, `GET /v1/sounds/:id`, `GET /v1/sounds/saved` — Neon sound catalog/saves
- `POST|DELETE /v1/sounds/:id/save`
- `GET /v1/trending-hashtags`
- `PATCH /v1/users/me` supports `marketBuyerLocation` / `marketBuyerPhone`

**Sounds:** Firestore `marketSounds` / `marketSoundSaves` are retired. Catalog rows are
materialized into Neon `sounds` (from `posts.sound_meta` on read, and on original-audio
extraction). Saves live in `sound_saves`.

## Migrate Firestore → Neon (one-time)

```bash
cd services/chatcart-api
npm run migrate:market-posts
npm run migrate:chat-firestore   # if chat not fully migrated
npm run migrate:storage          # remaining Firebase Storage → R2
```

Requires `DATABASE_URL` and Firebase Admin credentials.

## App env

```
EXPO_PUBLIC_API_BASE_URL=https://…/v1
EXPO_PUBLIC_MEDIA_CDN_URL=https://media.chatcart.shop
```

There is no `EXPO_PUBLIC_CHAT_BACKEND` or `EXPO_PUBLIC_ORDERS_BACKEND` switch —
chat and market order **reads** are Postgres-only in code (`isPostgresChatBackend()` always true).

## Deploy API

Redeploy Cloud Run `chatcart-api` after schema + code changes, **before** redeploying
Cloud Functions that call `/orders/internal/commit`.

## Orders — Neon write primary

Market **reads and writes** are Neon-primary.

```bash
cd services/chatcart-api
npm run migrate                  # includes 008 orders + 010 order_outbox
npm run migrate:orders-firestore # one-time Firestore -> Neon backfill (if needed)
```

Deploy order (required):

1. `npm run migrate` (apply `010_order_outbox.sql`)
2. Redeploy **chatcart-api** (commit + outbox routes)
3. Redeploy **Cloud Functions** (`finalizeMarketEscrowPayment`, orders, refunds, admin, `drainOrderOutboxToFirestore`)

Behavior:

- `finalizeMarketEscrowPayment` → `commitAndMirrorOrder` (Neon txn: order + timeline + outbox, then FS mirror)
- Status/refund mutations update business state then `dualWriteOrderToPostgres` (pushes FS snapshot to Neon; throws if Neon fails)
- Firestore remains the seller/admin mirror; pending rows drain via `drainOrderOutboxToFirestore`
  (HTTP, `x-chat-internal-secret`; legacy alias `resyncOrdersToPostgres`)
- Idempotent finalize by `mkt_{paystackReference}` + Neon `paystack_reference` uniqueness

Acceptance checks:

- Double finalize same Paystack ref → one Neon row, `alreadyExists`
- Neon down on finalize → error, retry succeeds; no FS-only order
- FS mirror fail after Neon commit → market UI correct; outbox drain restores seller tab
- Block list / deal room still independent of this path

## Still on Firebase (intentional)

- Auth / FCM
- Paystack checkout + fulfillment mutations (CF), seller `(tabs)`, admin
- Report sink (`marketReports`) until admin phase
- **Seller stories / statuses** (`marketStatuses`) — intentional short-term exception.
  Client module: `lib/firebase/stories/market-statuses.ts` (not under `firestore/market-*`).
  Neon migration deferred; do not "fix" stories by half-porting them into posts.

## Retired for market

- Client Firestore listeners for posts / comments / follows / saves / blocks / liked lists / sounds
- Post create/edit/search + trending hashtags (Postgres API)
- Sound catalog + saves (`sounds` / `sound_saves` in Neon; `GET /v1/sounds*`)
- Feed ranking Firestore fallbacks (Postgres-only); guest feed uses `getPublicFeed`
- Deprecated CF exports `feed-algorithm` + `market` removed from `functions/src/index.ts`
- Score dual-write on watch sessions
- Storage trigger sound extraction (no-op on CF; API updates Postgres `sound_meta` + `sounds`)
