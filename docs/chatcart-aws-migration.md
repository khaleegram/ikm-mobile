# ChatCart — Full Migration Architecture (AWS + CDN)

**Single cutover. One stack. No alternatives.**

| Decision | Choice |
|----------|--------|
| Backend | **AWS** (ECS Fargate, RDS, ElastiCache, S3, SQS) |
| Media delivery | **Cloudflare CDN** in front of S3 |
| Auth | **Firebase Auth** (sign-in only) |
| Push | **FCM** (via Firebase Admin from API) |
| Payments | **Paystack** |
| Source of truth | **RDS PostgreSQL** |
| Retired on cutover | Firestore, Firebase Storage, all Cloud Functions |

---

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REACT NATIVE APP (Expo)                               │
│   Feed │ Market │ Chat │ Seller Dashboard │ Auth/Profile               │
│   All data via HTTPS + WSS — zero Firestore reads in production         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
              Firebase Auth (sign-in) + FCM token registration
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              AWS APPLICATION LOAD BALANCER (ALB)                         │
│              api.chatcart.app → TLS termination                          │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│         ECS FARGATE — chatcart-api (Node.js monolith)                    │
│                                                                          │
│   /v1/feed          Ranking, exclusions, personalization               │
│   /v1/posts         CRUD, S3 presign, batch hydrate                      │
│   /v1/social        Likes, saves, follows, watch events, blocks          │
│   /v1/commerce      Orders, Paystack init + webhook                      │
│   /v1/chat          REST history + WebSocket gateway                     │
│   /v1/notifications In-app inbox + FCM fan-out                           │
│   /v1/sellers       Dashboard, analytics, post management                │
│   /v1/users         Profile, preferences, FCM tokens                    │
└───────┬─────────────┬──────────────┬────────────────────────────────────┘
        │             │              │
        ▼             ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ RDS Postgres │ │ ElastiCache  │ │  S3 Bucket   │
│ Multi-AZ     │ │ Redis        │ │  (origin)    │
│ Source of    │ │ Feed cache   │ │  uploads     │
│ truth        │ │ Trending     │ └──────┬───────┘
└──────────────┘ └──────────────┘        │
        │                                  ▼
        │                    ┌──────────────────────────┐
        │                    │ Cloudflare CDN             │
        │                    │ media.chatcart.app         │
        │                    │ (videos, images, thumbs) │
        │                    └──────────────────────────┘
        ▼
┌──────────────┐
│ SQS          │  score-worker, notification-worker, media-worker
└──────────────┘

RETIRED:
  ✗ Firestore (all collections)
  ✗ Firebase Storage
  ✗ Cloud Functions (market, feed, orders, payments)
  ✗ Client Firestore hooks
  ✗ AsyncStorage feed cache
  ✗ Hardcoded *.a.run.app URLs
```

---

## 2. Design rules

| Rule | Implementation |
|------|----------------|
| One feed call | `GET /v1/feed` → 25 IDs → `GET /v1/posts/batch?ids=` |
| Liked posts never return | `user_liked_posts` PRIMARY KEY `(user_id, post_id)` |
| Ranking off hot path | Watch/like → SQS → worker updates `post_scores` |
| Auth | Firebase ID token verified on every API request |
| Media URLs | Always `https://media.chatcart.app/...` (CDN), never raw S3 |
| Payments | Paystack secret server-only; webhook on API |
| Chat | WebSocket on same API + Postgres persistence |

---

## 3. AWS services (provision checklist)

| Service | Purpose | Notes |
|---------|---------|-------|
| **ECS Fargate** | Run `chatcart-api` + workers | 2+ tasks prod, auto-scale on CPU |
| **ALB** | HTTPS ingress | Attach ACM cert for `api.chatcart.app` |
| **RDS PostgreSQL 15+** | All relational data | `db.t4g.medium` start; Multi-AZ prod |
| **ElastiCache Redis 7** | Feed cache, trending, rate limits | `cache.t4g.micro` start |
| **S3** | Media origin bucket | Private bucket; CDN pulls from origin |
| **SQS** | Async jobs | 3 queues: scores, notifications, media |
| **ECR** | Docker image registry | CI pushes `chatcart-api` image |
| **Secrets Manager** | All secrets | No secrets in task definition plaintext |
| **IAM** | Task roles | ECS tasks use roles, not access keys |
| **ACM** | TLS certs | ALB + optional Cloudflare origin cert |
| **CloudWatch** | Logs + alarms | API errors, RDS CPU, queue depth |
| **VPC** | Private subnets | RDS + Redis not public |

| Cloudflare | Purpose |
|------------|---------|
| **CDN** | `media.chatcart.app` → S3 origin |
| **DNS** | `api.chatcart.app`, `media.chatcart.app` |

| Keep (Google) | Purpose |
|---------------|---------|
| **Firebase Auth** | Mobile sign-in |
| **FCM** | Push notifications |

---

## 4. PostgreSQL schema

```sql
-- USERS
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT,
  display_name    TEXT,
  store_name      TEXT,
  avatar_url      TEXT,
  role            TEXT NOT NULL DEFAULT 'buyer',
  market_location JSONB,
  follower_count  INT NOT NULL DEFAULT 0,
  following_count INT NOT NULL DEFAULT 0,
  fcm_tokens      TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- POSTS
CREATE TABLE posts (
  id                TEXT PRIMARY KEY,
  poster_id         TEXT NOT NULL REFERENCES users(id),
  media_type        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  description       TEXT,
  price             NUMERIC,
  is_negotiable     BOOLEAN DEFAULT false,
  hashtags          TEXT[] DEFAULT '{}',
  location          JSONB,
  contact_method    TEXT DEFAULT 'in-app',
  cover_url         TEXT,
  video_url         TEXT,
  video_duration_ms INT,
  video_meta        JSONB,
  sound_meta        JSONB,
  likes_count       INT NOT NULL DEFAULT 0,
  views_count       INT NOT NULL DEFAULT 0,
  comments_count    INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE post_images (
  id          BIGSERIAL PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
);

-- RANKING
CREATE TABLE post_scores (
  post_id       TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
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

-- FEED EXCLUSIONS
CREATE TABLE user_liked_posts (
  user_id   TEXT NOT NULL REFERENCES users(id),
  post_id   TEXT NOT NULL REFERENCES posts(id),
  liked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE user_saved_posts (
  user_id   TEXT NOT NULL REFERENCES users(id),
  post_id   TEXT NOT NULL REFERENCES posts(id),
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE user_seen_posts (
  user_id   TEXT NOT NULL REFERENCES users(id),
  post_id   TEXT NOT NULL REFERENCES posts(id),
  seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  dwell_sec NUMERIC,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE user_blocks (
  blocker_id  TEXT NOT NULL REFERENCES users(id),
  blocked_id  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- SOCIAL
CREATE TABLE follows (
  follower_id  TEXT NOT NULL REFERENCES users(id),
  followed_id  TEXT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id)
);

CREATE TABLE interactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  post_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  dwell_sec   NUMERIC,
  media_type  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_interactions_user ON interactions (user_id, created_at DESC);

-- COMMENTS
CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHAT
CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  post_id         TEXT REFERENCES posts(id),
  buyer_id        TEXT NOT NULL REFERENCES users(id),
  seller_id       TEXT NOT NULL REFERENCES users(id),
  last_message    TEXT,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         TEXT NOT NULL REFERENCES users(id),
  type              TEXT NOT NULL DEFAULT 'text',
  body              TEXT,
  image_url         TEXT,
  quote_card        JSONB,
  read_at           TIMESTAMPTZ,
  client_message_id TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conv ON messages (conversation_id, created_at ASC);

-- COMMERCE
CREATE TABLE orders (
  id            TEXT PRIMARY KEY,
  post_id       TEXT REFERENCES posts(id),
  buyer_id      TEXT NOT NULL REFERENCES users(id),
  seller_id     TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL,
  amount        NUMERIC NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'NGN',
  paystack_ref  TEXT,
  shipping      JSONB,
  timeline      JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE order_messages (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  sender_id   TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  body        TEXT,
  image_url   TEXT,
  is_system   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTIFICATIONS
CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  data        JSONB,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
```

---

## 5. Redis keys (ElastiCache)

```
feed:user:{uid}         → JSON [25 postIds]     TTL 600s
trending:global         → ZSET postId → score
user:liked:{uid}        → SET postIds            TTL 86400s
chat:presence:{convId}  → SET userIds            TTL 300s
rate:{uid}:{endpoint}   → COUNTER                TTL 60s
```

---

## 6. S3 + Cloudflare CDN

```
Upload flow:
  1. POST /v1/posts/presign → API returns S3 presigned PUT URL
  2. Client uploads to S3 directly
  3. POST /v1/posts with CDN URLs (not S3 URLs)

URL format in database:
  https://media.chatcart.app/posts/{userId}/{postId}/video.mp4
  https://media.chatcart.app/posts/{userId}/{postId}/cover.jpg

Cloudflare setup:
  - Origin: S3 bucket (private, OAI or signed origin)
  - Custom hostname: media.chatcart.app
  - Cache video/images aggressively (long TTL)
```

---

## 7. API surface

Base: `https://api.chatcart.app/v1`  
Auth: `Authorization: Bearer <firebase_id_token>`

### Feed
| Method | Path | Description |
|--------|------|-------------|
| GET | `/feed` | 25 ranked post IDs |
| POST | `/feed/seen` | Batch mark seen on swipe-away |
| GET | `/feed/following` | Posts from followed sellers |

### Posts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/posts/batch?ids=` | Hydrate feed cards |
| GET | `/posts/:id` | Single post |
| POST | `/posts` | Create |
| PATCH | `/posts/:id` | Edit |
| DELETE | `/posts/:id` | Soft delete |
| POST | `/posts/presign` | S3 presigned upload URL |

### Social
| Method | Path | Description |
|--------|------|-------------|
| POST | `/social/like` | Like + invalidate feed cache |
| DELETE | `/social/like/:postId` | Unlike |
| POST | `/social/save` | Bookmark |
| POST | `/social/watch` | Dwell event → SQS |
| POST | `/social/follow` | Follow seller |
| DELETE | `/social/follow/:userId` | Unfollow |
| POST | `/social/block` | Block user |

### Chat
| Method | Path | Description |
|--------|------|-------------|
| GET | `/conversations` | Inbox |
| POST | `/conversations` | Open chat for post |
| GET | `/conversations/:id/messages` | History |
| POST | `/conversations/:id/messages` | Send |
| WSS | `/ws/chat` | Real-time messages |

### Commerce
| Method | Path | Description |
|--------|------|-------------|
| POST | `/orders` | Create order |
| GET | `/orders` | List |
| GET | `/orders/:id` | Detail |
| POST | `/payments/paystack/init` | Start payment |
| POST | `/payments/paystack/webhook` | Webhook (no auth) |

### Users & notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Profile |
| PATCH | `/users/me` | Update + FCM token |
| GET | `/notifications` | Inbox |
| PATCH | `/notifications/:id/read` | Mark read |

---

## 8. Feed logic

```
GET /v1/feed:

1. Verify Firebase token → userId
2. Redis feed:user:{userId} → HIT? return postIds
3. MISS:
   a. Exclusions: user_liked_posts ∪ user_seen_posts ∪ blocked posters
   b. Taste tags from last 10 interactions (completion + chat)
   c. Bucket A (13): post_scores WHERE hashtags && tasteTags ORDER BY score DESC
   d. Bucket B (7):  global trending ORDER BY score DESC
   e. Bucket C (5):  posts < 6h old, views < 100
   f. Interleave + shuffle → 25 IDs
4. Cache Redis TTL 10 min
5. Return { postIds, meta }

App → GET /v1/posts/batch?ids=... → full post objects
```

### Scoring (SQS worker, every 5 min + on event)

```
score = total_points / (age_hours + 2)^1.5

 full_completion  +10
 dwell (per 4s, max 5 blocks)  +2 each
 chat             +15
 like / favorite  +2
 skip < 2s          -12
 auto-loop          0
```

---

## 9. WebSocket chat

```
Connect: WSS wss://api.chatcart.app/v1/ws/chat?token=<firebase_jwt>

→ subscribe { conversationId }
← message { id, senderId, body, type, createdAt }
→ send { conversationId, body, clientMessageId }
← read { conversationId, messageId }
```

Persistence: `messages` table. Broadcast via Redis pub/sub across ECS tasks.

---

## 10. Required environment variables

### Mobile app (`.env` — public only)

```env
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_API_BASE_URL=https://api.chatcart.app/v1
EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY=
```

### API (AWS Secrets Manager — never in app)

```env
# Core
NODE_ENV=production
PORT=8080

# RDS
DATABASE_URL=postgresql://user:pass@your-rds-endpoint:5432/chatcart?sslmode=require

# Redis
REDIS_URL=redis://your-elasticache-endpoint:6379

# S3 + CDN
AWS_REGION=af-south-1
S3_BUCKET=chatcart-media-prod
MEDIA_CDN_URL=https://media.chatcart.app

# Firebase (auth verify + FCM only)
FIREBASE_PROJECT_ID=ikm-marketplace
FIREBASE_SERVICE_ACCOUNT_JSON=<from Secrets Manager>

# Paystack
PAYSTACK_SECRET_KEY=
PAYSTACK_WEBHOOK_SECRET=

# App
API_BASE_URL=https://api.chatcart.app
APP_URL=https://chatcart.app
CORS_ORIGINS=*
```

**ECS tasks use IAM roles for S3/SQS access — do not put `AWS_ACCESS_KEY_ID` in production tasks.**

### Migration script (one-time)

```env
DATABASE_URL=
FIREBASE_PROJECT_ID=ikm-marketplace
GOOGLE_APPLICATION_CREDENTIALS=./firebase-admin.json
FIREBASE_STORAGE_BUCKET=ikm-marketplace.firebasestorage.app
AWS_REGION=
S3_BUCKET=
MEDIA_CDN_URL=
```

---

## 11. What you get manually (dashboard checklist)

| # | Where | What you copy |
|---|-------|---------------|
| 1 | Firebase Console → Service accounts | Admin JSON → Secrets Manager |
| 2 | AWS RDS | `DATABASE_URL` endpoint |
| 3 | AWS ElastiCache | `REDIS_URL` endpoint |
| 4 | AWS S3 | Bucket name + IAM role (no keys in prod) |
| 5 | Cloudflare | CDN hostname `media.chatcart.app` → S3 origin |
| 6 | AWS ACM + Route53 or Cloudflare DNS | `api.chatcart.app` → ALB |
| 7 | Paystack Dashboard | Secret key + webhook secret |
| 8 | AWS ECR + ECS | Deploy pipeline |

**Already in your `.env`:** all `EXPO_PUBLIC_FIREBASE_*` and Paystack public key.

---

## 12. Backend repo structure

```
services/chatcart-api/
├── Dockerfile
├── package.json
├── src/
│   ├── main.ts
│   ├── config.ts
│   ├── auth/firebase.ts
│   ├── db/migrations/
│   ├── redis/client.ts
│   ├── sqs/
│   │   ├── client.ts
│   │   └── processors/
│   ├── modules/
│   │   ├── feed/
│   │   ├── posts/
│   │   ├── social/
│   │   ├── chat/
│   │   ├── commerce/
│   │   ├── notifications/
│   │   ├── sellers/
│   │   └── users/
│   └── workers/
│       ├── score.worker.ts
│       ├── notification.worker.ts
│       └── media.worker.ts
└── scripts/migrate-firestore-to-rds.ts
```

**Stack:** Node 20, Fastify, `pg`, Drizzle ORM, `ioredis`, `@aws-sdk/client-s3`, `@aws-sdk/client-sqs`, `firebase-admin`, `ws`, Paystack SDK.

---

## 13. App migration

### Delete
```
lib/firebase/firestore/market-posts.ts
lib/firebase/firestore/market-messages.ts
lib/firebase/firestore/orders.ts
lib/firebase/firestore/order-chat.ts
lib/firebase/firestore/notifications.ts
lib/api/market-posts.ts (Cloud Function URLs)
lib/api/market-feed.ts (Cloud Function URLs)
All *.a.run.app URL constants
AsyncStorage feed cache
```

### Add
```
lib/api/client.ts           Firebase token interceptor
lib/api/feed.ts
lib/api/posts.ts
lib/api/social.ts
lib/api/chat.ts
lib/api/commerce.ts
lib/hooks/use-feed.ts
lib/hooks/use-chat-socket.ts
```

### Keep
```
lib/firebase/auth/*
lib/hooks/use-fcm-token.ts
```

---

## 14. Firestore → RDS migration (one-time)

Run in order:

```
1.  users              ← Firestore users
2.  posts              ← marketPosts
3.  post_images        ← explode images array
4.  post_scores        ← marketPostScores
5.  user_liked_posts   ← explode marketPosts.likedBy
6.  user_saved_posts   ← market saves
7.  follows            ← marketFollows
8.  interactions       ← marketPostInteractions (90 days)
9.  comments           ← marketPostComments
10. conversations      ← marketChats
11. messages           ← marketChats/*/messages
12. orders             ← orders
13. order_messages     ← orders/*/chat
14. notifications      ← notifications

Media: Firebase Storage → S3 (aws s3 sync or script)
URLs:  rewrite all to https://media.chatcart.app/...
```

Validate row counts match Firestore export.

---

## 15. Cutover (single weekend)

### T-7 days
- [ ] API on staging ECS
- [ ] RDS + Redis + S3 + Cloudflare CDN staging
- [ ] Migration dry-run on staging snapshot
- [ ] Internal app build pointing at staging API

### Cutover day
```
1.  Maintenance mode ON
2.  Final Firestore → RDS migration (delta)
3.  Final Storage → S3 sync
4.  Deploy API to production ECS
5.  Ship app update (EXPO_PUBLIC_API_BASE_URL → production)
6.  DNS cutover: api.chatcart.app → ALB
7.  Disable Cloud Functions
8.  Firestore rules: deny all writes
9.  Maintenance mode OFF
10. Monitor: feed p95, Paystack webhooks, WS connections, RDS CPU
```

### Rollback
- Revert app to previous build (Firestore client)
- Re-enable Cloud Functions
- Firestore has pre-freeze snapshot

---

## 16. Success criteria

- [ ] Zero Firestore reads in production app
- [ ] Liked post never appears on refresh (100 test cycles)
- [ ] Feed: 1 API call + 1 batch hydrate, p95 < 500ms
- [ ] Chat delivers < 200ms via WebSocket
- [ ] Paystack end-to-end on new orders table
- [ ] Seller creates post: presign → S3 → CDN URL → API
- [ ] All users sign in via Firebase Auth (unchanged)
- [ ] Migration row counts match ±0.1%

---

## 17. Team & timeline

| Role | Duration |
|------|----------|
| Senior backend (API + AWS infra + migration script) | 6–8 weeks |
| Mobile (rewire all screens off Firestore) | 6–8 weeks (parallel) |
| DevOps (VPC, ECS, RDS, CDN, cutover) | 2 weeks |
| **Total** | **~8 weeks** |

---

## 18. What dies on cutover

| Retired | Replaced by |
|---------|-------------|
| Firestore | RDS PostgreSQL |
| Firebase Storage | S3 + Cloudflare CDN |
| All Cloud Functions | ECS `chatcart-api` |
| `getPersonalizedMarketFeed` | `GET /v1/feed` |
| `logMarketPostInteraction` | `POST /v1/social/watch` |
| `likeMarketPost` | `POST /v1/social/like` |
| Firestore chat listeners | `WSS /v1/ws/chat` |
| `likedBy[]` on posts | `user_liked_posts` table |
| `marketPostScores` collection | `post_scores` table |
| AsyncStorage feed cache | ElastiCache Redis |

---

## One sentence for the team

> Full cutover off Firestore to **AWS ECS + RDS PostgreSQL + ElastiCache Redis + S3 + Cloudflare CDN**, single monolith API, Firebase Auth only, Paystack unchanged — single migration weekend after 8 weeks build.
