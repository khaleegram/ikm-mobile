# ChatCart — Version One (Hybrid Feed Migration)

**Chosen stack.** Cheaper than full AWS. Fixes feed, likes, and ranking without rewriting checkout, chat, or orders.

| Decision | Choice |
|----------|--------|
| Feed + social state | **Neon Postgres** + **Upstash Redis** |
| API | **GCP Cloud Run** (one monolith) |
| Post content | **Firestore** `marketPosts` (hydrate by ID) |
| Chat | **Firestore** `marketChats` (unchanged) |
| Orders / Paystack | **Cloud Functions** (unchanged) |
| Auth | **Firebase Auth** |
| Media | **Firebase Storage** (unchanged) |
| Retired | `getPersonalizedMarketFeed` CF, feed AsyncStorage cache, `likedBy[]` for exclusions |

**Not in scope (version one):** AWS, RDS, ECS, S3 migration, WebSocket chat rewrite, full Firestore retirement.

---

## 1. Why this version

| | Full AWS doc | **Version one (this doc)** |
|--|--------------|---------------------------|
| Monthly cost early | ~$150–400+ | **~$0–30** (Neon free, Upstash free tier, Cloud Run min instances 0) |
| Time to ship | ~8 weeks | **~2–3 weeks** |
| Risk | Full platform cutover | **Feed layer only** |
| Fixes liked-post bug | Yes | **Yes** |
| Fixes feed ranking | Yes | **Yes** |
| Touch orders/chat | Yes | **No** |

---

## 2. Architecture

```
React Native App
    │
    ├── Firebase Auth (unchanged)
    │
    ├── GET /v1/feed          ──► Cloud Run chatcart-api
    ├── POST /v1/social/like  ──►       │
    ├── POST /v1/social/watch ──►       │
    │                                   ├── Neon Postgres
    │                                   │     user_liked_posts
    │                                   │     user_seen_posts
    │                                   │     post_scores
    │                                   │     interactions
    │                                   │
    │                                   └── Upstash Redis
    │                                         feed:user:{uid}
    │
    ├── Hydrate posts         ──► Firestore marketPosts (batch by ID)
    ├── Chat                  ──► Firestore (unchanged)
    ├── Orders / Paystack     ──► Cloud Functions (unchanged)
    └── Media                 ──► Firebase Storage (unchanged)
```

---

## 3. What version one fixes

- Liked posts **never** return (Postgres `user_liked_posts`, not `likedBy[]` scans)
- One feed API call instead of 8 Firestore queries
- No stale AsyncStorage feed cache
- Fair photo vs video scoring (dwell-based, no auto-loop inflation)
- Optimistic remove from feed on like

---

## 4. PostgreSQL schema (feed-only)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_liked_posts (
  user_id  TEXT NOT NULL REFERENCES users(id),
  post_id  TEXT NOT NULL,
  liked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE user_seen_posts (
  user_id   TEXT NOT NULL REFERENCES users(id),
  post_id   TEXT NOT NULL,
  seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  dwell_sec NUMERIC,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE post_scores (
  post_id       TEXT PRIMARY KEY,
  poster_id     TEXT NOT NULL,
  hashtags      TEXT[] DEFAULT '{}',
  media_type    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  total_points  NUMERIC NOT NULL DEFAULT 0,
  score         NUMERIC NOT NULL DEFAULT 0,
  breakdown     JSONB NOT NULL DEFAULT '{}',
  views_count   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scores_rank ON post_scores (status, score DESC);
CREATE INDEX idx_scores_hashtags ON post_scores USING GIN (hashtags);

CREATE TABLE interactions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  post_id    TEXT NOT NULL,
  action     TEXT NOT NULL,
  dwell_sec  NUMERIC,
  media_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_interactions_user ON interactions (user_id, created_at DESC);
```

Post bodies stay in Firestore. `post_id` in Postgres = Firestore `marketPosts` doc ID.

---

## 5. Redis keys

```
feed:user:{uid}    → JSON [25 postIds]   TTL 600s
trending:global    → ZSET postId→score
user:liked:{uid}   → SET postIds         TTL 86400s
```

---

## 6. API (Cloud Run monolith — feed module only for v1)

Base: `https://api.chatcart.app/v1` (or Cloud Run URL until custom domain)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/feed` | 25 ranked post IDs, exclusions applied |
| POST | `/feed/seen` | Mark seen on swipe-away |
| POST | `/social/like` | Like → Postgres + invalidate Redis + dual-write Firestore `likedBy` |
| DELETE | `/social/like/:postId` | Unlike |
| POST | `/social/watch` | Dwell → queue score update |

**App still uses:**
- Firestore batch read for post hydration
- Existing `likeMarketPost` CF can be retired once `/social/like` is live
- Existing Cloud Functions for orders, chat, payments

### Feed logic (same 3 buckets)

- **A (13):** taste hashtags from last 10 interactions
- **B (7):** global trending by `post_scores.score`
- **C (5):** new posts &lt; 6h, views &lt; 100
- Exclude: `user_liked_posts` + `user_seen_posts` + client cursor
- Interleave + shuffle → 25 IDs

### Scoring

```
score = total_points / (age_hours + 2)^1.5

full_completion +10 | dwell +2/4s (max 5) | chat +15 | like +2 | skip -12 | loop 0
```

Worker: Cloud Run job or existing `scheduledRefreshMarketPostScores` until moved.

---

## 7. Required env vars

### Mobile (`.env` — you already have most)

```env
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_API_BASE_URL=https://YOUR-CLOUD-RUN-URL/v1
EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY=
```

### API (`services/chatcart-api/.env`)

```env
NODE_ENV=production
PORT=8080
DATABASE_URL=              # Neon pooler URL (free tier OK)
UPSTASH_REDIS_REST_URL=    # From Upstash database → REST API
UPSTASH_REDIS_REST_TOKEN=
FIREBASE_PROJECT_ID=ikm-marketplace
GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-admin.json
FEED_CACHE_TTL_SEC=600
```

**Not required for version one:** AWS keys, S3, R2, Paystack secret on feed API (payments stay on CF).

### One-time migration script

```env
DATABASE_URL=
FIREBASE_PROJECT_ID=ikm-marketplace
GOOGLE_APPLICATION_CREDENTIALS=./firebase-admin.json
```

Script copies:
- `marketPostScores` → `post_scores`
- Explode `likedBy[]` → `user_liked_posts`
- `marketPostInteractions` (90 days) → `interactions`

---

## 8. What to create in Upstash

You only need **one thing**: a **Redis database** (you already did this).

1. [console.upstash.com](https://console.upstash.com) → **Create Database**
2. Name it e.g. `chatcart-feed` — region close to your API (US-East is fine with Neon us-east-1)
3. Type: **Regional** (free tier)
4. After create, open the database → **REST API** section

Copy these two (not AWS, not Kafka):

```env
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxx...
```

That is correct for version one. The API uses `@upstash/redis` with these REST vars (works on Cloud Run without persistent TCP).

**Optional:** Under **Connect** → **Redis URL** you’ll see `rediss://...` — only needed if using `ioredis` instead of REST.

**You do NOT need:** Upstash Kafka, QStash, or Vector for version one.

---

## 9. Neon connection string

Use the **pooler** host for the API (better for serverless):

```
postgresql://neondb_owner:PASSWORD@ep-xxx-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require
```

Direct host (non-pooler) is fine for one-off migration scripts.

Run schema once:

```bash
psql "$DATABASE_URL" -f services/chatcart-api/migrations/001_feed_schema.sql
```

---

## 10. Cloud Run deploy

Full step-by-step: **[docs/cloud-run-deploy.md](./cloud-run-deploy.md)**

---

## 11. What you get manually

| # | Service | Free tier? | What you copy |
|---|---------|------------|---------------|
| 1 | [Neon](https://neon.tech) | Yes | `DATABASE_URL` (pooler URL) |
| 2 | [Upstash](https://upstash.com) | Yes | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` |
| 3 | Firebase Console | — | Admin service account JSON |
| 4 | GCP Cloud Run | Pay per use | Deploy URL → `EXPO_PUBLIC_API_BASE_URL` |

**Already have:** all Firebase client keys, Paystack public key.

---

## 9. App changes (minimal)

### Change
| File | Change |
|------|--------|
| `lib/firebase/firestore/market-posts.ts` | Feed hook: API IDs → Firestore hydrate |
| `lib/api/market-feed.ts` | Point to Cloud Run `/v1/feed` |
| `components/market/feed-card.tsx` | Like → `/social/like` + optimistic remove |
| `lib/hooks/use-feed-watch-session.ts` | Watch → `/social/watch` (already exists, retarget) |

### Remove
- AsyncStorage personalized feed cache
- Client-side `buildExcludeIds` / `useUserLikedPostIds` for feed exclusion
- Dependency on `getPersonalizedMarketFeed` Cloud Function

### Keep unchanged
- `app/(market)/messages/*`
- `app/(market)/orders/*`
- `app/(market)/create-post.tsx` (Firestore + Storage)
- All order/payment Cloud Functions
- Firestore chat listeners

---

## 10. Cutover (feed only — half day)

```
1. Run migration script (scores, likes, interactions → Neon)
2. Deploy chatcart-api to Cloud Run
3. Ship app update with new EXPO_PUBLIC_API_BASE_URL
4. Disable getPersonalizedMarketFeed + logMarketPostInteraction CF (optional: keep as fallback 24h)
5. Verify: like → refresh → post gone
```

**No maintenance window for orders or chat.**

---

## 11. Success criteria

- [ ] Liked post never on refresh (100 cycles)
- [ ] Feed = 1 HTTP call + 1 Firestore batch hydrate
- [ ] p95 feed &lt; 400ms (Redis hit)
- [ ] Orders and chat still work unchanged
- [ ] Neon + Upstash bill &lt; $30/mo at early traffic

---

## 12. When to upgrade (version two)

Move to `docs/chatcart-aws-migration.md` when:

- 50k+ DAU and Neon/Upstash limits bite
- You want chat on WebSocket + Postgres
- Firebase Storage egress gets expensive
- Team has AWS ops capacity

Version one is designed so **only the feed API and Postgres tables grow** — you don’t throw away this work.

---

## One sentence

> Fix the feed with **Neon Postgres + Upstash Redis + Cloud Run API** for ranking and exclusions; keep **Firestore for posts, chat, orders, and Storage**; ship in **2–3 weeks** for **~$0–30/mo**.
