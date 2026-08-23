# Production Verification Status

Generated after Feed Query + Chat cache collapse + Redis WS fan-out implementation.

## Code verification (local)

| Check | Result |
|-------|--------|
| `npm run lint` (Expo app) | Pass — 0 errors, pre-existing warnings only |
| `chat-ws.mjs` module load | Pass |
| Legacy chat MMKV stores removed | Pass — `chat-thread-cache-v1`, `chat-inbox-cache-v2` cleared on boot |
| Feed on TanStack Query | Pass — `useClipFeed` → `useInfiniteQuery`, key `feed.infinite` |
| Chat single Query cache | Pass — thread + inbox via `CHATCART_REACT_QUERY` only |

## Database migrations

```bash
cd services/chatcart-api
npm run migrate:dry-run
npm run migrate
```

**Result (fixed):** All migrations **001–010** applied and checksums verified.

**Root cause:** Windows CRLF line endings in local `.sql` files produced different SHA-256 checksums than Linux/Neon where migrations originally ran. Fixed by LF-normalizing SQL in `scripts/migrate.mjs` and adding `services/chatcart-api/.gitattributes` (`migrations/*.sql text eol=lf`).

## Deploy order (required)

1. `npm run migrate` (schema already at 010 — safe to re-run anytime)
2. Redeploy **chatcart-api** with:
   - `DATABASE_URL`, Upstash REST vars
   - **`REDIS_URL`** (Upstash TCP URL — same DB as REST) for WS fan-out
   - Firebase admin secret
3. Redeploy **Cloud Functions** (payments, orders, refunds, `drainOrderOutboxToFirestore`)
4. EAS **`market-production`** build with live Paystack public key

## API health

Prod URL: `https://chatcart-api-q3rjv54uka-uc.a.run.app/health`

Expected: `{"ok":true,"service":"chatcart-api"}`

**Verified 2026-08-18:** revision `chatcart-api-00025-tfd`, health 200, Redis pub/sub enabled in logs.

Automated suite: `cd services/chatcart-api && node scripts/smoke-prod.mjs`

## Smoke flows (manual — post deploy)

- [x] Guest feed → public `/v1/feed/public` returns clips (5+ posts)
- [ ] Guest feed → cached clips on cold start → login → like *(verify in app — TanStack Query persist)*
- [x] Ask-for-price → deal room seed via internal `ensure-deal-thread` (thread created, no 500)
- [ ] Send message on two devices → realtime without 12s poll wait *(skipped here — Firebase Identity Toolkit blocked from CI network; verify on two phones)*
- [ ] Escrow checkout → Neon order + seller Firestore mirror *(needs live Paystack payment)*
- [ ] Seller ship → buyer confirm/dispute *(manual in app)*
- [ ] Push on new message *(manual — FCM)*

## Order acceptance (from exit runbook)

- [x] Double finalize same Paystack ref → one Neon row (`/v1/orders/internal/commit` idempotency smoke)
- [x] No duplicate `paystack_reference` rows in Neon (unique index)
- [ ] Neon down on finalize → error, no FS-only order *(needs controlled outage test)*
- [ ] FS mirror fail after Neon commit → market UI correct; outbox drain restores seller tab *(4 pending outbox items — monitor drain)*
- [x] `sellerAcceptOrder` + `finalizeMarketEscrowPayment` Cloud Functions reachable (auth required)
- [x] Order outbox pending endpoint live (`/v1/orders/internal/outbox/pending`)
