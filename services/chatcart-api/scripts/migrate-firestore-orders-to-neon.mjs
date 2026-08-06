/**
 * One-time: Firestore orders (+ timeline) → Neon.
 * Prefer market orders (market_post_* items / postId / marketMeta).
 *
 * Usage:
 *   node scripts/migrate-firestore-orders-to-neon.mjs
 *   node scripts/migrate-firestore-orders-to-neon.mjs --dry-run
 *   node scripts/migrate-firestore-orders-to-neon.mjs --all
 */
import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { upsertOrderFromPayload, appendTimelineEvent } from '../src/orders.mjs';

dotenv.config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const MIGRATE_ALL = process.argv.includes('--all');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

function loadCred() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const p =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../../../secrets/firebase-admin.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  const local = path.join(__dirname, '../secrets/firebase-admin.json');
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8'));
  return null;
}

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ikm-marketplace';
if (getApps().length === 0) {
  const cred = loadCred();
  initializeApp(
    cred ? { credential: cert(cred), projectId: FIREBASE_PROJECT_ID } : { projectId: FIREBASE_PROJECT_ID }
  );
}

const firestore = getFirestore();
// Ensure pool is created via db.mjs side effect when orders.mjs imports it
void pg;

function asString(v) {
  return String(v ?? '').trim();
}

function asDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (typeof v?._seconds === 'number') return new Date(v._seconds * 1000);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isMarketOrder(data) {
  if (asString(data.postId) || asString(data.marketMeta?.postId)) return true;
  const items = Array.isArray(data.items) ? data.items : [];
  return items.some((item) => asString(item?.productId).startsWith('market_post_'));
}

function serialize(value) {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000).toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

async function main() {
  console.log(`Migrating Firestore orders → Neon${DRY_RUN ? ' (dry-run)' : ''}…`);
  const snap = await firestore.collection('orders').get();
  let considered = 0;
  let upserted = 0;
  let skipped = 0;
  let timelineCount = 0;
  let errors = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!MIGRATE_ALL && !isMarketOrder(data)) {
      skipped += 1;
      continue;
    }
    considered += 1;

    const payload = {
      id: doc.id,
      ...serialize(data),
      createdAt: asDate(data.createdAt) || new Date(),
      updatedAt: asDate(data.updatedAt) || new Date(),
    };

    if (DRY_RUN) {
      upserted += 1;
      continue;
    }

    try {
      await upsertOrderFromPayload(payload);
      upserted += 1;

      const timelineSnap = await doc.ref.collection('timeline').get();
      for (const eventDoc of timelineSnap.docs) {
        const ev = eventDoc.data() || {};
        await appendTimelineEvent({
          id: eventDoc.id,
          orderId: doc.id,
          event: ev.event,
          status: ev.status,
          text: ev.text,
          actorId: ev.actorId,
          actorRole: ev.actorRole,
          metadata: serialize(ev.metadata),
          createdAt: asDate(ev.createdAt),
        });
        timelineCount += 1;
      }
    } catch (err) {
      errors += 1;
      console.warn(`Failed order ${doc.id}:`, err.message);
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        migrateAll: MIGRATE_ALL,
        totalDocs: snap.size,
        considered,
        upserted,
        skippedNonMarket: skipped,
        timelineEvents: timelineCount,
        errors,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
