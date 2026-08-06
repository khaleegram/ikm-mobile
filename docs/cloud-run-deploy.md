> **ARCHIVED / HISTORICAL** � This document no longer matches the running codebase.
> Canonical migration status: `docs/firebase-market-core-exit.md` and `docs/architecture-boundaries.md`.
> Do not implement from this file.

---
# Deploy ChatCart API to Cloud Run

Step-by-step guide for the hybrid feed API (`services/chatcart-api`).

---

## Prerequisites

1. **Google Cloud project** — same as Firebase: `ikm-marketplace`
2. **[gcloud CLI](https://cloud.google.com/sdk/docs/install)** installed and logged in
3. **Neon + Upstash** — already configured in `services/chatcart-api/.env`
4. **Firebase Admin JSON** — copied to `services/chatcart-api/secrets/firebase-admin.json`

---

## Step 1 — Install gcloud and log in

```powershell
gcloud auth login
gcloud config set project ikm-marketplace
```

---

## Step 2 — Enable required APIs (one time)

```powershell
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
```

---

## Step 3 — Store Firebase service account in Secret Manager

From repo root:

```powershell
gcloud secrets create firebase-admin-json --replication-policy=automatic
gcloud secrets versions add firebase-admin-json --data-file="services/chatcart-api/secrets/firebase-admin.json"
```

Grant Cloud Run access to read it (replace `PROJECT_NUMBER` with yours from Firebase/GCP console):

```powershell
# Replace 723822682554 with YOUR project number from the line above:
gcloud secrets add-iam-policy-binding firebase-admin-json `
  --member="serviceAccount:723822682554-compute@developer.gserviceaccount.com" `
  --role="roles/secretmanager.secretAccessor"
```

Find project number:

```powershell
gcloud projects describe ikm-marketplace --format="value(projectNumber)"
```

---

## Step 4 — Test locally

```powershell
cd services/chatcart-api
npm install
npm start
```

Health check:

```powershell
curl http://localhost:8080/health
```

Feed requires a real Firebase ID token (from the app). `/health` is enough to confirm the server starts.

---

## Step 5 — Build and deploy to Cloud Run

From `services/chatcart-api`:

```powershell
gcloud run deploy chatcart-api `
  --source . `
  --region us-central1 `
  --allow-unauthenticated `
  --port 8080 `
  --memory 512Mi `
  --min-instances 0 `
  --max-instances 10 `
  --set-env-vars "NODE_ENV=production,FIREBASE_PROJECT_ID=ikm-marketplace,FEED_CACHE_TTL_SEC=600,FEED_PAGE_SIZE=25" `
  --set-env-vars "DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-fancy-thunder-ati6kclu-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require" `
  --set-env-vars "UPSTASH_REDIS_REST_URL=https://resolved-raccoon-147846.upstash.io" `
  --set-env-vars "UPSTASH_REDIS_REST_TOKEN=YOUR_UPSTASH_TOKEN" `
  --set-secrets "FIREBASE_SERVICE_ACCOUNT_JSON=firebase-admin-json:latest"
```

Notes:

- `--source .` builds the Dockerfile via Cloud Build (no local Docker required).
- Replace `YOUR_PASSWORD` and `YOUR_UPSTASH_TOKEN` with your real values (or use Secret Manager for those too before production).
- The API reads `FIREBASE_SERVICE_ACCOUNT_JSON` from the secret env var (see `src/firebase.mjs`).

After deploy, copy the URL from the output, e.g.:

```
https://chatcart-api-xxxxx-uc.a.run.app
```

---

## Step 6 — Wire the mobile app

In project root `.env`:

```env
EXPO_PUBLIC_API_BASE_URL=https://chatcart-api-xxxxx-uc.a.run.app/v1
```

Restart Expo after changing env vars.

---

## Step 7 — Verify production

```powershell
curl https://chatcart-api-xxxxx-uc.a.run.app/health
```

Expected: `{"ok":true,"service":"chatcart-api"}`

---

## API routes (v1)

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | No |
| POST | `/v1/feed` | Bearer Firebase token |
| POST | `/v1/feed/seen` | Bearer |
| POST | `/v1/social/watch` | Bearer |
| POST | `/v1/social/action` | Bearer (`chat`, `favorite`) |
| POST | `/v1/social/like` | Bearer |
| DELETE | `/v1/social/like/:postId` | Bearer |

---

## Optional — redeploy after code changes

```powershell
cd services/chatcart-api
gcloud run deploy chatcart-api --source . --region us-central1
```

Env vars and secrets persist on the service unless you change them.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Unauthorized` on feed | App must send `Authorization: Bearer <Firebase ID token>` |
| Firebase init fails on Cloud Run | Check secret mount + `FIREBASE_SERVICE_ACCOUNT_JSON` |
| Empty feed | Run Firestore → Neon migration script (scores/likes not in Postgres yet); API falls back to Firestore |
| Neon connection errors | Use **pooler** URL, not direct host |
| CORS errors | Set `CORS_ORIGINS=*` or your app origin in deploy env vars |
