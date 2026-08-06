> **ARCHIVED / HISTORICAL** � This document no longer matches the running codebase.
> Canonical migration status: `docs/firebase-market-core-exit.md` and `docs/architecture-boundaries.md`.
> Do not implement from this file.

---
> **ARCHIVED — historical snapshot.** Several "Done" items here reference UI files
> (`pinned-product-card`, `negotiation-timeline`, `deal-stage-bar`) that have since been
> deleted and replaced by `components/chat/deal-room/*`. The migration script name
> (`migrate:chat-firestore`) is current, but schema migrations overall now run via
> `npm run migrate` (see `docs/firebase-market-core-exit.md`). Do not use this file to judge
> current completion status — re-verify against code.

# Chat Redesign — Audit (What's Done vs What's Left)

> Last audit: after Phase 1–2 implementation + tightening pass.

## Done

| Area | Status |
|------|--------|
| Postgres schema (`002_chat_schema.sql`) | Applied to Neon |
| Feed Firestore → Neon | 9 scores, 10 likes, 53 interactions |
| Chat Firestore → Neon | 4 threads, 65 messages, 8 inbox rows |
| Firebase Storage → R2 | 36 objects → `https://media.chatcart.shop` |
| Cloud Run redeploy | Rev `chatcart-api-00005-8j5` with R2 + chat env |
| App env | `EXPO_PUBLIC_MEDIA_CDN_URL` + `EXPO_PUBLIC_CHAT_BACKEND=postgres` |
| Credential fix | `dotenv.config({ override: true })` in chatcart-api |
| REST API `/v1/chat/*` | Inbox, threads, messages, offers, read, report, search |
| UUID thread IDs (server-issued) | Client never constructs IDs |
| Active thread lookup | No `UNIQUE(post_id, buyer_id)` |
| `chat_offers` + `chat_attachments` tables | Separate from messages |
| Feature flag `EXPO_PUBLIC_CHAT_BACKEND` | `firestore` \| `postgres` |
| Postgres chat screen | `PostgresChatDetail` |
| Inbox UX | Single list, filters, product thumbs, badges |
| Pinned product card | In thread |
| Inline offer panel (seller) | Replaces modal |
| Bottom-sheet from feed | Postgres mode |
| Voice notes | Record + upload + playback |
| FCM + in-app notify | `chat-notify.mjs` |
| Migration script (conversations) | `migrate:chat-firestore` |
| Legacy Firestore path | Still works when flag = `firestore` |

## Gaps Fixed This Pass

- Quote card mapping from Postgres `payload`
- Structured offer cards + buyer Accept / Counter / Decline
- WS connect validates thread participant
- Poll fallback when WebSocket unavailable (Cloud Run)
- Inbox refresh on app foreground
- Seller-only `createOffer` (buyers use counter/accept/decline)
- Lowball hint on offers < 50% of list price
- Internal `POST /v1/chat/internal/system-event` for order milestones
- `marketChats` migration in script
- Negotiation timeline component

## Still Left (Priority Order)

### P0 — Before production cutover

1. **Restart Expo** after env changes (`EXPO_PUBLIC_CHAT_BACKEND=postgres`)
2. **Deploy Cloud Functions** — blocked by 12 orphan remote functions; run interactively:
   `firebase deploy --only functions` and confirm deletion, OR delete orphans listed in deploy output
3. **Orders need `dealThreadId`** on order docs for Postgres system-event wiring
4. **Delete legacy** after 2-week parallel run (Phase 3)
   - `lib/firebase/firestore/market-messages.ts`
   - `lib/api/market-messages.ts`
   - `use-chat-messages.ts` merge + 2.5s poll

### P1 — UX polish

6. CRM seller header (rating, response rate, completed orders)
7. Read receipts + typing indicators (Phase 4)
8. Offer → Order atomic transition on accept
9. `deal-room-header` presence subtitle ("Online" / "Last seen")
10. Report message action in thread UI (API exists)

### P2 — Scale & reliability

11. Redis pub/sub for WS across Cloud Run instances (in-memory only today)
12. Full `marketMessages` top-level collection migration
13. `legacy-thread-map.json` redirect for old deep links
14. Postgres FCM foreground handler test on iOS/Android

### P3 — Later

15. AI deal summary (Phase 5)
16. Full-text search UI (`GET /v1/chat/search` index ready)
17. Local SQLite cache (optional)

## Known Limitations

| Issue | Impact | Mitigation |
|-------|--------|------------|
| WS in-memory registry | Misses events on multi-instance Cloud Run | 4s poll fallback in `useChatThread` |
| `getOrCreateThread` buyer-only | Sellers cannot open thread first | By design — buyers initiate deals |
| Migration partial | Old `marketMessages` may be missing | Re-run script; manual spot-check |
| No offer→order yet | Accept doesn't create order | Phase 2.5 — Paystack flow |

## Env Checklist

**App (`.env`):**
```
EXPO_PUBLIC_CHAT_BACKEND=postgres
EXPO_PUBLIC_API_BASE_URL=https://chatcart-api-....run.app/v1
```

**API (`services/chatcart-api/.env`):**
```
DATABASE_URL=...
CHAT_INTERNAL_SECRET=<random>
```
