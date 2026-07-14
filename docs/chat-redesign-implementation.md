# Chat Redesign — Detailed Implementation Plan

> **Goal:** Move from 4/10 (11 Firestore listeners, client-side merge, generic DM UX) to 9/10 (Deal Thread model, Postgres + WebSocket, commerce-native UI).

> **Mental model:** *"I'm talking to Musa about buying this Samsung — show me everything about that deal in one place, instantly."*

> **Last updated:** Amendments applied — UUID threads, separate offers/attachments tables, voice in Phase 2, presence in Phase 4.

---

## Table of Contents

1. [Prerequisites & Constraints](#0-prerequisites--constraints)
2. [Target Architecture](#1-target-architecture)
3. [Data Model (Postgres)](#2-data-model-postgres)
4. [API Specification](#3-api-specification)
5. [Phase-by-Phase Execution](#4-phase-by-phase-execution)
6. [File Change Matrix](#5-file-change-matrix)
7. [Testing Plan](#6-testing-plan)
8. [Rollback Plan](#7-rollback-plan)
9. [Timeline & Dependencies](#8-timeline--dependencies)
10. [Success Metrics](#9-success-metrics)
11. [Immediate Next Steps](#10-immediate-next-steps)
12. [Amendment Summary](#11-amendment-summary)

---

## 0. Prerequisites & Constraints

### What stays unchanged

| System | Reason |
|--------|--------|
| Firebase Auth | Token verification already works in `chatcart-api/src/auth.mjs` |
| Firestore `marketPosts` | Post hydration stays client-side or server-side read |
| Firestore `orders` | Order state machine (`functions/src/orders.ts`) stays; order events **emit into** deal threads |
| Cloud Functions for Paystack / order status | Out of scope |
| `EXPO_PUBLIC_API_BASE_URL` | Already wired via `lib/api/api-base.ts` |
| `chat_inbox` table | Kept for denormalized inbox reads (not replaced) |

### What gets replaced

| Current | Replacement |
|---------|-------------|
| `lib/firebase/firestore/market-messages.ts` (1,425 lines) | `lib/hooks/use-chat-inbox.ts` + `use-chat-thread.ts` |
| `lib/api/market-messages.ts` (direct Firestore writes) | `lib/api/chat.ts` → `chatcart-api` |
| `use-chat-messages.ts` merge + 2.5s poll | Single WebSocket + optimistic UI |
| `legacyChatId` / `peerId` / `direct_*` routing | Server-issued UUID `threadId` only |
| General / Orders inbox tabs | Single inbox + status badges |
| Client-constructed thread IDs | Server returns UUID on thread creation |

### Feature flag (required for safe rollout)

Add to `.env`:

```
EXPO_PUBLIC_CHAT_BACKEND=firestore   # firestore | postgres
```

Default `firestore` until cutover. All new chat entry points check the flag. Old paths remain until Phase 3 deletion.

---

## 1. Target Architecture

```
React Native
├── lib/api/chat.ts              REST + WS client
├── lib/hooks/use-chat-inbox.ts  GET /v1/chat/inbox
├── lib/hooks/use-chat-thread.ts WS /v1/chat/threads/:id/stream
├── components/chat/             Deal Room UI
└── app/(market)/messages/       Inbox + thread screens (simplified)

chatcart-api (Cloud Run)
├── src/chat.mjs                 Business logic
├── src/chat-ws.mjs              WebSocket handler
├── src/chat-presence.mjs        Redis + Postgres presence
├── migrations/002_chat_schema.sql
└── scripts/migrate-firestore-chat-to-neon.mjs

Neon Postgres              Upstash Redis              Firestore (read-only)
chat_threads (UUID)        pub/sub fan-out            marketPosts (hydrate)
chat_inbox                 presence:user:{id}         users (profiles)
chat_messages              typing indicators          orders (state → events)
chat_offers
chat_attachments
user_presence
chat_reports
```

### Non-negotiables (from agreed synthesis)

1. One **active** thread per buyer-seller-post — product is center of gravity; closed threads remain in history
2. All writes through `chatcart-api` — no direct Firestore message writes
3. Offers as first-class rows in `chat_offers` — messages reference offer IDs, not duplicated payloads
4. One inbox query via `chat_inbox` — no 6-query client merge
5. WebSocket realtime — no 11 Firestore listeners, no 2.5s poll
6. Thread IDs are UUIDs issued by the server — client never constructs them

---

## 2. Data Model (Postgres)

### Migration file: `services/chatcart-api/migrations/002_chat_schema.sql`

```sql
-- ChatCart — Deal Thread schema
-- Run after 001_feed_schema.sql
-- Requires: CREATE EXTENSION IF NOT EXISTS pgcrypto; (for gen_random_uuid)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Threads ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         TEXT NOT NULL,
  buyer_id        TEXT NOT NULL,
  seller_id       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'browsing',
  -- browsing | negotiating | offer_sent | accepted | in_order | completed | closed
  post_snapshot   JSONB NOT NULL DEFAULT '{}',
  -- { title, price, currency, imageUrl, location }
  linked_order_id TEXT,
  last_message    TEXT,
  last_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NO UNIQUE(post_id, buyer_id) — multiple threads allowed over time
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_active
  ON chat_threads (post_id, buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_threads_seller
  ON chat_threads (seller_id, last_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chat_threads_buyer
  ON chat_threads (buyer_id, last_at DESC NULLS LAST);

-- ─── Inbox (denormalized, kept) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_inbox (
  user_id         TEXT NOT NULL REFERENCES users(id),
  thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  peer_id         TEXT NOT NULL,
  unread_count    INT NOT NULL DEFAULT 0,
  last_preview    TEXT,
  last_at         TIMESTAMPTZ,
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_inbox_user
  ON chat_inbox (user_id, last_at DESC NULLS LAST);

-- ─── Messages ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id       TEXT,                       -- NULL for system events
  type            TEXT NOT NULL,
  -- text | image | voice | quote | offer | counter | accept | decline
  -- system | order_created | order_shipped | order_delivered | ...
  body            TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  -- offer events:  { "offer_id": "<uuid>" }
  -- media events:  { "attachment_id": "<uuid>" }
  client_msg_id   TEXT UNIQUE,
  search_vector   tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(body, ''))
  ) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON chat_messages (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_search
  ON chat_messages USING GIN (search_vector);

-- ─── Offers (separate from messages) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  buyer_id        TEXT NOT NULL,
  seller_id       TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'NGN',
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | accepted | countered | declined | expired
  parent_offer_id UUID REFERENCES chat_offers(id),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_offers_thread
  ON chat_offers (thread_id, created_at DESC);

-- ─── Attachments (separate from message payload) ───────────────────────────

CREATE TABLE IF NOT EXISTS chat_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,  -- image | voice | video | pdf | invoice
  url          TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   INT,
  duration_sec INT,           -- voice/video only
  width        INT,           -- image/video only
  height       INT,           -- image/video only
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
  ON chat_attachments (message_id);

-- ─── Presence (Postgres fallback; live state in Redis) ───────────────────────

CREATE TABLE IF NOT EXISTS user_presence (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Moderation ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL,
  reported_id TEXT NOT NULL,
  thread_id   UUID REFERENCES chat_threads(id),
  message_id  UUID REFERENCES chat_messages(id),
  reason      TEXT NOT NULL,
  -- spam | fraud | harassment | inappropriate | scam
  status      TEXT NOT NULL DEFAULT 'open',
  -- open | reviewed | actioned | dismissed
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_reports_status
  ON chat_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_reports_reported
  ON chat_reports (reported_id, created_at DESC);
```

### Thread ID convention

**Client never constructs thread IDs.** The server returns a UUID on `POST /v1/chat/threads`.

```ts
// types/chat.ts
export interface ChatThread {
  id: string;  // UUID from server
  postId: string;
  buyerId: string;
  sellerId: string;
  status: ChatThreadStatus;
  // ...
}
```

There is **no** `lib/chat/thread-id.ts` — delete if created during scaffolding.

### Active thread lookup

Multiple threads per buyer per post are allowed over time. Application logic defines the **active** thread:

```js
// getOrCreateThread in chat.mjs
const existing = await pool.query(`
  SELECT * FROM chat_threads
  WHERE post_id = $1
    AND buyer_id = $2
    AND status NOT IN ('closed', 'completed')
  ORDER BY created_at DESC
  LIMIT 1
`, [postId, buyerId]);

if (existing.rows[0]) return existing.rows[0];

// No active thread → INSERT new row (gen_random_uuid())
// Old closed threads remain in history — never deleted
```

Returning buyers who completed a deal and want to negotiate again get a **new** thread UUID.

### Offer state machine

```
pending → accepted | countered | declined | expired
```

- State lives in `chat_offers.status`
- `counter` inserts a new `chat_offers` row with `parent_offer_id` pointing to the previous offer
- Messages of type `offer | counter | accept | decline` reference `payload.offer_id`
- Full offer data is joined from `chat_offers` on read — not duplicated in `payload`

### Presence (hybrid Redis + Postgres)

Do **not** add `last_seen_at` to the `users` table — it's a hot-write column.

```
On app foreground      → SET Redis presence:user:{id} EX 300
                       → UPDATE user_presence SET last_seen_at = now()

On WS connect          → SET Redis presence:user:{id} EX 300
On WS heartbeat (30s)  → EXPIRE presence:user:{id} 300

Reading presence:
  1. Redis presence:user:{id} exists     → "Online"
  2. Else user_presence.last_seen_at     → "Last seen X ago"
  3. Else                                → "Offline"
```

---

## 3. API Specification

### New modules

- `services/chatcart-api/src/chat.mjs` — core logic
- `services/chatcart-api/src/chat-ws.mjs` — WebSocket
- `services/chatcart-api/src/chat-presence.mjs` — presence read/write

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/chat/inbox` | ✅ | Unified inbox via `chat_inbox`, one query |
| `POST` | `/v1/chat/threads` | ✅ | Get or create **active** thread for post |
| `GET` | `/v1/chat/threads/:id` | ✅ | Thread meta + post snapshot + peer profile + presence |
| `GET` | `/v1/chat/threads/:id/messages` | ✅ | Cursor pagination; joins offers + attachments |
| `POST` | `/v1/chat/threads/:id/messages` | ✅ | Send text/quote; creates attachment row for media |
| `POST` | `/v1/chat/threads/:id/offers` | ✅ | Create offer row + reference message |
| `PATCH` | `/v1/chat/threads/:id/offers/:offerId` | ✅ | `accept` \| `counter` \| `decline` |
| `POST` | `/v1/chat/threads/:id/read` | ✅ | Mark read, zero `chat_inbox.unread_count` |
| `POST` | `/v1/chat/threads/:id/messages/:msgId/report` | ✅ | Create `chat_reports` row |
| `GET` | `/v1/chat/search` | ✅ | Full-text search (index ready; ship when needed) |
| `WS` | `/v1/chat/threads/:id/stream` | ✅ | Realtime events |

### Request/response shapes

**GET `/v1/chat/inbox`**

```json
{
  "success": true,
  "threads": [
    {
      "threadId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "peerId": "seller789",
      "peerName": "Musa",
      "peerAvatar": "https://...",
      "peerPresence": "online",
      "postId": "post123",
      "postSnapshot": { "title": "Samsung S24", "price": 850000, "imageUrl": "..." },
      "status": "negotiating",
      "statusBadge": "offer_sent",
      "lastPreview": "Counter: ₦820,000",
      "unreadCount": 2,
      "lastAt": "2026-06-12T19:44:00Z"
    }
  ]
}
```

**POST `/v1/chat/threads`**

```json
// Request
{ "postId": "post123", "sellerId": "seller789" }

// Response — server issues UUID
{
  "success": true,
  "thread": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "postId": "post123",
    "status": "browsing",
    "isNew": true
  }
}
```

**GET `/v1/chat/threads/:id/messages?before=<uuid>&limit=50`**

```json
{
  "success": true,
  "messages": [
    {
      "id": "uuid",
      "type": "offer",
      "body": null,
      "payload": { "offer_id": "uuid" },
      "offer": { "id": "uuid", "amount": 790000, "status": "pending" },
      "attachment": null,
      "createdAt": "..."
    },
    {
      "id": "uuid",
      "type": "voice",
      "payload": { "attachment_id": "uuid" },
      "attachment": { "url": "...", "durationSec": 45, "mimeType": "audio/aac" }
    }
  ],
  "nextCursor": "uuid",
  "hasMore": true
}
```

**POST `/v1/chat/threads/:id/offers`**

```json
// Request
{ "amount": 790000, "currency": "NGN", "note": "Can pick up today", "clientMsgId": "cm_..." }

// Response
{
  "success": true,
  "offer": { "id": "uuid", "amount": 790000, "status": "pending", "currency": "NGN" },
  "message": { "id": "uuid", "type": "offer", "payload": { "offer_id": "uuid" } }
}
```

**PATCH `/v1/chat/threads/:id/offers/:offerId`**

```json
// Request — action: accept | counter | decline
{ "action": "counter", "amount": 820000, "note": "Best I can do", "clientMsgId": "cm_..." }

// Server:
// 1. Updates chat_offers.status on original
// 2. If counter: inserts new chat_offers row with parent_offer_id
// 3. Inserts message referencing offer_id
// 4. Updates chat_threads.status
```

**POST `/v1/chat/threads/:id/messages/:msgId/report`**

```json
{ "reason": "fraud" }
```

**GET `/v1/chat/search?q=samsung&threadId=<uuid>&limit=20`**

Index exists from day one. Implementation optional in Phase 2 — no migration cost when shipping later.

**WebSocket events** (server → client)

```json
{ "event": "message", "message": {} }
{ "event": "offer_updated", "offerId": "uuid", "status": "countered" }
{ "event": "thread_status", "status": "in_order" }
{ "event": "typing", "userId": "...", "active": true }
{ "event": "read", "userId": "...", "readAt": "..." }
{ "event": "presence", "userId": "...", "status": "online" }
```

### Server-side write pipeline (every POST)

1. `requireAuth` — verify Firebase JWT
2. Validate participant (buyer or seller on thread)
3. Block check — read Firestore blocks collection
4. Idempotency — `ON CONFLICT (client_msg_id) DO NOTHING RETURNING *`
5. Transaction:
   - Insert `chat_messages` (and `chat_attachments` / `chat_offers` as needed)
   - Update `chat_threads` (`last_message`, `last_at`, `status`)
   - Update both `chat_inbox` rows
6. Side effects (async, non-blocking):
   - `recordAction(userId, postId, 'chat')` via `social.mjs`
   - FCM push via Firebase Admin
   - Redis pub/sub → WebSocket subscribers
7. Return joined response (message + offer/attachment if applicable)

### Dependencies to add

```json
// services/chatcart-api/package.json
"@fastify/websocket": "^11.x"
```

Add `npm run migrate:chat` pointing to `002_chat_schema.sql`.

---

## 4. Phase-by-Phase Execution

### Phase 1 — UX Surgery (Week 1–2)

*Visible wins on current Firestore backend. No Postgres dependency yet.*

#### 1.1 Unified inbox

**Files:** `app/(market)/messages/index.tsx`

| Task | Detail |
|------|--------|
| Remove General / Orders tabs | Filter chips: All · Active Deals · Unread |
| Product thumbnail on rows | Read `postId` / `lastContextPostId`; hydrate thumb from post or snapshot |
| Status badges | `💰 Offer Sent`, `📦 Order Active`, `🏪 Seller` |
| Simplify navigation | Navigate with `threadId` only; stop appending `legacyChatId` in new navigations |

#### 1.2 Deal Room layout (Firestore-backed)

**New files:**

```
components/chat/deal-room-header.tsx
components/chat/pinned-product-card.tsx
components/chat/negotiation-timeline.tsx
components/chat/smart-composer.tsx
components/chat/offer-inline-panel.tsx
```

#### 1.3 Bottom-sheet entry from feed

**New:** `components/chat/chat-bottom-sheet.tsx`

Modify `post-overlay.tsx`, `market-ask-price-chat.ts`.

#### 1.4 Types prep

**File:** `types/chat.ts` — thread `id` is UUID string from server.

---

### Phase 2 — Postgres Backend + Voice Notes (Week 2–5)

*New threads use Postgres. Voice notes ship in this phase (Nigeria-critical).*

#### 2.1 Database & migration runner

- `002_chat_schema.sql` — full schema per Section 2
- `npm run migrate:chat`

#### 2.2 Core chat module

**New:** `services/chatcart-api/src/chat.mjs`

```js
export async function getInbox(userId)
export async function getOrCreateThread(userId, { postId, sellerId })  // active thread lookup
export async function getThread(userId, threadId)
export async function getMessages(userId, threadId, { before, limit })  // joins offers + attachments
export async function sendMessage(userId, threadId, payload)
export async function createOffer(userId, threadId, payload)           // chat_offers + message
export async function respondToOffer(userId, threadId, offerId, action, payload)
export async function markThreadRead(userId, threadId)
export async function reportMessage(userId, threadId, messageId, reason)
export async function appendSystemEvent(threadId, { type, payload })
export async function searchMessages(userId, { q, threadId, limit })    // optional; index ready
```

**Thread creation logic:**

1. Load post from Firestore `marketPosts/{postId}`
2. Validate `userId !== posterId`
3. Active thread lookup (status NOT IN `closed`, `completed`)
4. If none: `INSERT` new thread with `gen_random_uuid()`
5. Upsert `chat_inbox` for buyer and seller

#### 2.3 WebSocket layer

**New:** `services/chatcart-api/src/chat-ws.mjs`

Redis channel: `chat:thread:{threadId}`. Heartbeat every 30s.

#### 2.4 Presence (basic)

**New:** `services/chatcart-api/src/chat-presence.mjs`

- Redis `presence:user:{id}` with 5-min TTL
- Postgres `user_presence` fallback
- Expose in `GET /v1/chat/threads/:id` peer object

Full typing indicators and read receipts → Phase 4.

#### 2.5 Voice notes (Phase 2 — not deferred)

| Task | File |
|------|------|
| Presign prefix | `services/chatcart-api/src/media.mjs` — add `chatVoice/` to `ALLOWED_PREFIXES` |
| Hold-to-record | `components/chat/smart-composer.tsx` — `expo-av` |
| Playback bubble | `components/chat/voice-message-bubble.tsx` |
| Attachment row | `chat_attachments` on send; message `payload.attachment_id` |

**Encoding spec:** AAC via `expo-av`, 32kbps, max 120s (~480KB). Server enforces via `Content-Length` check on presign.

#### 2.6 Client API + hooks

**New:** `lib/api/chat.ts`, `use-chat-inbox.ts`, `use-chat-thread.ts`

Feature flag: `EXPO_PUBLIC_CHAT_BACKEND`.

#### 2.7 Notifications + feed scoring

FCM on send. `recordAction(uid, postId, 'chat')` on every message/offer.

**Acceptance criteria (Phase 2):**

- New DM creates Postgres thread with server-issued UUID
- Active thread reused for same buyer+post if not closed/completed
- New thread created for returning buyer after completed deal
- Inbox returns in 1 API call
- Offers stored in `chat_offers`; messages reference `offer_id`
- Media stored in `chat_attachments`; messages reference `attachment_id`
- Voice note record → upload → playback works
- WebSocket delivery <500ms p95

---

### Phase 3 — Migration & Delete Old World (Week 5–6)

#### 3.1 Firestore → Neon migration script

**New:** `services/chatcart-api/scripts/migrate-firestore-chat-to-neon.mjs`

| Source | Maps to |
|--------|---------|
| `conversations/{direct_*}` + `messages` | New UUID per thread group; map legacy ID → UUID lookup table |
| `marketChats/{buyer}_{seller}_{postId}` + `messages` | Active thread per buyer+post; closed if order completed |
| `marketMessages` (top-level) | Merge by `postId` + participants |
| Legacy offers (`paymentLink`) | Parse into `chat_offers` rows |

Migration outputs a `legacy_thread_map` JSON file (`oldId → uuid`) for deep-link redirects during transition.

#### 3.2 Order events → deal thread

`functions/src/order-chat.ts` → `POST /v1/chat/internal/system-event`

Resolves thread via `chat_threads.linked_order_id`.

#### 3.3 Cutover + deletion

Set `EXPO_PUBLIC_CHAT_BACKEND=postgres`. Delete:

- `lib/firebase/firestore/market-messages.ts`
- `lib/api/market-messages.ts`
- `use-chat-messages.ts`, `offer-modal.tsx`
- `legacyChatId` routing, 2.5s polling, offline queue

---

### Phase 4 — Read Receipts, Typing, Presence, Reactions (Week 7–8)

| Feature | Implementation |
|---------|----------------|
| Read receipts | `chat_inbox` last-read cursor per user; WS `read` event |
| Typing indicators | Redis `typing:thread:{id}:{userId}` EX 5 |
| Presence polish | "Recording audio…" state in composer |
| Message reactions | `chat_message_reactions` table (add in `003_chat_reactions.sql` if needed) or defer |

---

### Phase 5 — AI Layer (Week 10–14)

*Ships after Phase 4 is stable.*

| Feature | Endpoint | Notes |
|---------|----------|-------|
| Deal summary | `GET /v1/chat/threads/:id/summary` | Joins `chat_offers` + `post_snapshot` |
| Suggested replies | `GET /v1/chat/threads/:id/suggestions` | Seller templates |
| Price guidance | Inline on offer receive | Postgres `post_scores` + `interactions` |
| Lowball flag | Server on `createOffer` | `amount < post_snapshot.price * 0.5` |
| Voice transcription | Optional on `chat_attachments` | Enables search across voice notes |

---

## 5. File Change Matrix

### New files

```
services/chatcart-api/migrations/002_chat_schema.sql
services/chatcart-api/src/chat.mjs
services/chatcart-api/src/chat-ws.mjs
services/chatcart-api/src/chat-presence.mjs
services/chatcart-api/scripts/migrate-firestore-chat-to-neon.mjs

lib/api/chat.ts
lib/hooks/use-chat-inbox.ts
lib/hooks/use-chat-thread.ts
types/chat.ts

components/chat/deal-room-header.tsx
components/chat/pinned-product-card.tsx
components/chat/negotiation-timeline.tsx
components/chat/smart-composer.tsx
components/chat/offer-inline-panel.tsx
components/chat/chat-bottom-sheet.tsx
components/chat/milestone-card.tsx
components/chat/voice-message-bubble.tsx        (Phase 2)
components/chat/deal-summary-card.tsx           (Phase 5)
```

**Do NOT create:** `lib/chat/thread-id.ts`

### Modified files

```
services/chatcart-api/src/index.mjs
services/chatcart-api/src/media.mjs               (chatVoice/ prefix)
services/chatcart-api/package.json
services/chatcart-api/.env.example

app/(market)/messages/index.tsx
app/(market)/messages/[chatId].tsx
app/(market)/messages/_chat-detail/*
app/(market)/_layout.tsx

components/market/post-overlay.tsx
components/market/message-bubble.tsx

lib/utils/market-ask-price-chat.ts
lib/hooks/use-market-chat-notifications.ts
app/notifications.tsx

functions/src/order-chat.ts
.env.example
```

### Deleted files (Phase 3)

```
lib/firebase/firestore/market-messages.ts
lib/api/market-messages.ts
app/(market)/messages/_chat-detail/use-chat-messages.ts
app/(market)/messages/_chat-detail/offer-modal.tsx
```

---

## 6. Testing Plan

### Unit tests (chatcart-api)

| Test | Coverage |
|------|----------|
| Active thread lookup | Returns open thread; creates new if closed/completed |
| UUID issuance | Server generates UUID; client never sends thread id on create |
| Idempotent send | Same `client_msg_id` → one row |
| Offer state machine | Invalid transitions rejected; counter creates `parent_offer_id` |
| Offer/message join | Message `payload.offer_id` resolves full offer on read |
| Attachment join | Message `payload.attachment_id` resolves attachment on read |
| Inbox unread | `markThreadRead` zeros `chat_inbox.unread_count` |
| Participant guard | Third party cannot read/send |
| Voice presign | Rejects `Content-Length` > 512KB |
| Report creation | `chat_reports` row with correct reason |

### Integration tests

| Scenario | Steps |
|----------|-------|
| New deal from feed | Ask price → UUID thread → quote message → inbox row |
| Returning buyer | Completed thread exists → new UUID thread created |
| Offer flow | Offer → counter (new row) → accept → `chat_threads.status = accepted` |
| Voice note | Record → presign → send → playback |
| Realtime | User A sends → User B WS receives <1s |
| Migration | Legacy Firestore → Postgres with UUID map |
| Search index | `search_vector` populated on text messages |

### Manual QA checklist

- [ ] Open chat from feed (bottom sheet)
- [ ] Thread ID is UUID in URL/state
- [ ] Inbox shows product thumb + badge
- [ ] Send text, image, voice note, offer
- [ ] Offer card shows amount from `chat_offers` join
- [ ] Accept/counter/decline offer
- [ ] Report message lands in `chat_reports`
- [ ] Notification tap opens correct UUID thread
- [ ] No duplicate messages on reconnect
- [ ] No 2.5s polling in profiler

---

## 7. Rollback Plan

| Stage | Rollback |
|-------|----------|
| Phase 1 only | Revert UI PRs; no data risk |
| Phase 2 parallel | Set `EXPO_PUBLIC_CHAT_BACKEND=firestore` |
| Post-migration | Keep Firestore read-only 30 days; `legacy_thread_map` for redirects |
| Postgres corruption | Restore Neon point-in-time snapshot |

---

## 8. Timeline & Dependencies

```
Week 1–2    Phase 1 (UX Surgery)              ─────────────────────────►
Week 2–5    Phase 2 (Postgres + Voice)        ─────────────────────────────────►
Week 5–6    Phase 3 (Migration & Delete)                 ──────────────►
Week 7–8    Phase 4 (Receipts, Typing, Presence)              ────────►
Week 10–14  Phase 5 (AI Layer)                                    ──────────────►
```

**Critical path:** Phase 2 schema + `chat.mjs` + voice → Phase 3 migration → cutover.

**Parallelizable:** Phase 1 UI ships while Phase 2 backend is built.

---

## 9. Success Metrics

| Metric | Baseline (est.) | Target |
|--------|-----------------|--------|
| Firestore listeners per chat open | 11 | 0 |
| Inbox load queries | 6 client | 1 API (`chat_inbox`) |
| Chat open time (p95) | 2–4s | <800ms |
| Message delivery (p95) | ~2.5s (poll) | <500ms (WS) |
| Duplicate message reports | Unknown | 0 |
| Offer → checkout conversion | Baseline TBD | +15% after Phase 1–2 |
| Offer conversion tracking | Not specified | Queryable via `chat_offers` analytics |
| Voice note send rate | N/A | Measurable from Phase 2 |
| Reported messages resolved | Not in plan | <48h review target |
| Returning buyer (new thread) | Would break with UNIQUE | Handled by active thread lookup |
| Full-text search | Not in plan | Index ready at schema creation; ship when needed |

---

## 10. Immediate Next Steps

1. Add `002_chat_schema.sql` (full schema with UUID, offers, attachments, presence, reports, search index)
2. Run `npm run migrate:chat` against Neon dev
3. Scaffold `chat.mjs` with `getOrCreateThread` (active lookup) + `createOffer` (separate table)
4. Add `chatVoice/` to `media.mjs` `ALLOWED_PREFIXES`
5. Start Phase 1 UI — `pinned-product-card.tsx` + inbox badges
6. Add feature flag `EXPO_PUBLIC_CHAT_BACKEND`
7. Add `@fastify/websocket` to `chatcart-api`

---

## 11. Amendment Summary

| # | Change | Rationale |
|---|--------|-----------|
| 1 | UUID thread IDs (server-issued) | No client construction; no collision risk |
| 2 | No `UNIQUE(post_id, buyer_id)`; active thread lookup | Returning buyers get new threads; history preserved |
| 3 | `chat_offers` separate table | Analytics, state machine, no payload duplication |
| 4 | `chat_attachments` separate table | Media metadata normalized; voice/image/video unified |
| 5 | All FKs updated to UUID | Cascades from #1 |
| 6 | `user_presence` + Redis hybrid | Avoid hot-writes on `users` table |
| 7 | `search_vector` GIN index at creation | Zero migration cost when search ships |
| 8 | `chat_reports` moderation table | Reports stored now; UI later |
| 9 | Voice notes → Phase 2; AI → Phase 5+ | Nigeria voice-first; AI after stable foundation |
| 10 | `chat_inbox` kept | Denormalized inbox; not replaced by thread queries |

---

## Reference: Agreed Synthesis

- **Mental model:** Deal Thread (product-centered, not person-centered)
- **Backend:** Postgres in `chatcart-api` (same path as feed migration)
- **Realtime:** WebSocket + Redis pub/sub + FCM background
- **UX:** Deal Room + CRM header + negotiation timeline + single inbox with badges
- **Delete:** `market-messages.ts` (1,425 lines), 11-listener merge, 2.5s polling
- **Voice:** Phase 2 (Nigeria-critical)
- **AI:** Phase 5+ (after presence/receipts stable)

> **The foundation is: one active thread, one query, one stream. Everything else is context inside it.**
