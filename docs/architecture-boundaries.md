# Architectural boundaries — Firebase vs Neon

This doc exists so future audits do **not** treat intentional Firestore surfaces as incomplete Neon migration.

## Market core (Neon / chatcart-api) — must stay Neon-only

| Domain | Client | Notes |
|--------|--------|-------|
| Posts / feed / search / likes / comments | `lib/hooks/use-market-post*`, `lib/api/market-*`, Query keys | No Firestore listeners |
| Social (follow / save / block) | `lib/hooks/use-social.ts` | Neon |
| Sounds | `lib/hooks/use-market-sounds.ts` | Neon `sounds` / `sound_saves` |
| Chat / deal rooms | `components/chat/deal-room/*`, Postgres API | `isPostgresChatBackend()` always true |
| Orders **reads** (market) | `lib/hooks/use-order.ts` | Neon |
| Orders **writes** (market escrow) | Cloud Functions → `commitOrderPrimary` / outbox | Neon primary; Firestore seller/admin mirror |
| Buyer phone / location | `useMyMarketProfile` / `saveMarketBuyerProfile` | Neon |
| Identity avatars/names | `lib/hooks/use-user-identity.ts` | Neon batch |

## Intentional Firebase (do not “migrate as a bug”)

### Auth + FCM
Firebase Auth and device push tokens (Neon stores FCM token list; Auth remains Firebase).

### Seller shell — `app/(tabs)/*`
Seller commerce UI (products, orders, shipping, payouts, marketing, analytics, customers, reports) remains on **Firestore listeners + Cloud Functions**. Market consumer app does not share these screens. Order docs are mirrored from Neon via `order_outbox`.

### Admin shell — `app/(admin)/*`
Admin moderation, users, security, platform settings remain on **Firestore**. Report sink (`marketReports`) stays CF/Firestore until an admin Neon phase.

### Seller stories / statuses
`lib/firebase/stories/market-statuses.ts` — intentional short-term Firestore exception (see `docs/firebase-market-core-exit.md`).

### Payments / escrow mutations
Paystack initialize/finalize/refunds are Cloud Functions. Order **write primary is Neon** (`POST /v1/orders/internal/commit` + `order_outbox`). Firestore is a durable secondary mirror for seller/admin; drain with `drainOrderOutboxToFirestore` (alias: `resyncOrdersToPostgres`).

## Feature ownership matrix (seller tabs vs market)

| Feature | Market app `app/(market)` | Seller `app/(tabs)` | Notes |
|---------|---------------------------|---------------------|-------|
| Payouts | `/(market)/payouts` (seller view in market) | `/(tabs)/payouts` | Same CF APIs; two shells |
| Delivery prefs | `/(market)/delivery-settings` | — | Neon buyer profile |
| Profile / photo | `/(market)/profile`, settings | Store settings / storefront | Market uses Neon identity |
| Inventory / products | Feed posts (Neon) | `/(tabs)/products` (Firestore products) | Different product models |
| Orders | Market escrow orders (Neon read+write primary) | Seller order board (Firestore mirror) | Outbox keeps FS in sync |
| Domain / storefront | — | `/domain`, `/storefront` | Seller-only |

When adding a feature, pick **one** shell as owner. If both must show it short-term, share one API/hook module — do not fork business logic.

## Offline persistence

| Kind | Store |
|------|-------|
| Server-state cache | TanStack Query → MMKV (`lib/query/*`) |
| Offline write queue | MMKV (`lib/utils/offline.ts`) — queue only, not a read cache |
| Pending escrow checkout | MMKV (`lib/utils/pending-escrow-checkout.ts`) |
| Theme / UI prefs | Existing Zustand/MMKV paths |

Do not add AsyncStorage TTL caches for API responses.

## Chat realtime (WebSocket + poll fallback)

Primary delivery is the chat WebSocket (`chat-ws.mjs` + client stream in `use-chat-thread`).

**Constraint:** Cloud Run can run multiple instances; in-memory WS registries do not fan out across instances. Until Redis pub/sub (or sticky single-instance) is production-hardened, the client keeps a **quiet poll fallback**:

| Surface | Behavior |
|---------|----------|
| Open thread | Poll every **12s** only when no WS event for **~30s** (`use-chat-thread`) |
| Inbox | Query refetch interval **60s** as reconnect safety net (`use-chat-inbox`) — not the primary path |

When WS is healthy, polls should no-op / skip. Do not add a second always-on poller.

## Order timeline vs order messages

| Surface | Source |
|---------|--------|
| Market order timeline | Neon via `useOrder` (`order_timeline_events`) |
| Market order chat | Deal-room Postgres thread (`dealThreadId` / `chatThreadId`) — not `orders/{id}/messages` |
| Seller shell `app/orders/[id]` messages | Firestore `orders/{id}/messages` (intentional seller-shell exception until seller cutover) |

## Order write primary + Firestore outbox

| Step | Owner |
|------|--------|
| Money create (`finalizeMarketEscrowPayment`) | Neon `POST /orders/internal/commit` then FS mirror |
| Status / refund / admin mutations | CF business rules → FS doc update → `dualWriteOrderToPostgres` (Neon commit, throws on failure) |
| Seller/admin listeners | Firestore `orders` (fed by immediate mirror + `order_outbox` drain) |
| Drain | CF `drainOrderOutboxToFirestore` / alias `resyncOrdersToPostgres` |

Do not reintroduce Firestore-as-primary for market escrow orders.

## Chat block enforcement

Client block list writes Neon `user_blocks`. Server chat send/open checks the same table (`isBlockedEither` in `social-graph.mjs`). Do not reintroduce Firestore `marketBlocks` for authorization.
