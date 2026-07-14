# Firebase Market Core Exit — runbook

Keep **Firebase Auth + FCM**. Market posts/social/chat/media live on **chatcart-api + Neon + R2**.

## Apply schema

```bash
cd services/chatcart-api
npm run migrate:posts   # 003 posts + 004 social + 005 buyer location
```

New market APIs (auth required):

- `GET /v1/posts/search?q=`
- `GET /v1/trending-hashtags`
- `PATCH /v1/users/me` supports `marketBuyerLocation` / `marketBuyerPhone`

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
EXPO_PUBLIC_CHAT_BACKEND=postgres
EXPO_PUBLIC_API_BASE_URL=https://…/v1
EXPO_PUBLIC_MEDIA_CDN_URL=https://media.chatcart.shop
```

## Deploy API

Redeploy Cloud Run `chatcart-api` after schema + code changes.

## Still on Firebase (intentional)

- Auth / FCM
- Orders, Paystack, seller dashboard, admin, statuses/sounds
- Report sink (`marketReports`) until admin phase
- Buyer location dual-write to Firestore so order CFs keep working

## Retired for market

- Client Firestore listeners for posts / comments / follows / saves / blocks / liked lists
- Post create/edit/search + trending hashtags (Postgres API)
- Feed ranking Firestore fallbacks (Postgres-only)
- Score dual-write on watch sessions
- Storage trigger sound extraction (no-op; API updates Postgres `sound_meta`)
