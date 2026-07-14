import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import pg from 'pg';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const DATABASE_URL = process.env.DATABASE_URL;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ikm-marketplace';
const CRED_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';

if (!DATABASE_URL) {
  console.error('DATABASE_URL missing in .env');
  process.exit(1);
}

function loadCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const credFile = CRED_PATH || 'secrets/firebase-admin.json';
  if (credFile && fs.existsSync(credFile)) {
    return JSON.parse(fs.readFileSync(credFile, 'utf8'));
  }
  return undefined;
}

if (getApps().length === 0) {
  const cred = loadCredential();
  initializeApp(cred ? { credential: cert(cred), projectId: FIREBASE_PROJECT_ID } : { projectId: FIREBASE_PROJECT_ID });
}

const firestore = getFirestore();

const pool = new pg.Pool({ connectionString: DATABASE_URL });

function asDate(val) {
  if (!val) return new Date();
  if (val?._seconds) return new Date(val._seconds * 1000);
  if (val?.toDate) return val.toDate();
  return new Date(val);
}

function normalizeHashtags(raw) {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map(t => String(t || '').trim().toLowerCase()).filter(Boolean).slice(0, 10)));
}

function computeDecayedScore(totalPoints, createdAt) {
  const ageHours = Math.max(0, (Date.now() - asDate(createdAt).getTime()) / 3_600_000);
  const denom = Math.pow(ageHours + 2, 1.5);
  return denom <= 0 ? totalPoints : totalPoints / denom;
}

async function migrateScores() {
  console.log('Migrating marketPostScores -> post_scores...');
  let count = 0;
  try {
    const snapshot = await firestore.collection('marketPostScores').limit(1000).get();
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const id = String(doc.id || data.postId || '').trim();
      if (!id) continue;

      const createdAt = asDate(data.createdAt);
      const totalPoints = Number(data.totalPoints || 0);
      const score = computeDecayedScore(totalPoints, createdAt);
      const breakdown = data.breakdown || {};
      const views = Number(data.views || 0);

      await pool.query(
        `INSERT INTO post_scores (post_id, poster_id, hashtags, media_type, status, total_points, score, breakdown, views_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (post_id) DO UPDATE SET
           total_points = EXCLUDED.total_points,
           score = EXCLUDED.score,
           breakdown = EXCLUDED.breakdown,
           views_count = EXCLUDED.views_count,
           updated_at = now()`,
        [
          id, String(data.posterId || '').trim(), normalizeHashtags(data.hashtags),
          data.mediaType || null, String(data.status || 'active'),
          totalPoints, score, JSON.stringify(breakdown), views, createdAt
        ]
      );
      count++;
    }
  } catch (e) {
    console.warn('Scores migration partial:', e.message);
  }
  console.log('Done:', count, 'post_scores migrated');
  return count;
}

async function migrateLikedPosts() {
  console.log('Migrating likedBy -> user_liked_posts...');
  let count = 0;
  try {
    const snapshot = await firestore.collection('marketPosts').where('likedBy', '!=', []).limit(500).get();
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const postId = doc.id;
      const likedBy = Array.isArray(data.likedBy) ? data.likedBy.filter(id => typeof id === 'string') : [];
      for (const userId of likedBy) {
        await pool.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
        await pool.query(`INSERT INTO user_liked_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, postId]);
        count++;
      }
    }
  } catch (e) {
    console.warn('Liked posts migration partial:', e.message);
  }
  console.log('Done:', count, 'user_liked_posts migrated');
  return count;
}

async function migrateInteractions() {
  console.log('Migrating marketPostInteractions -> interactions...');
  let count = 0;
  const cutoff = new Date(Date.now() - 90 * 24 * 3_600_000);
  try {
    const snapshot = await firestore.collection('marketPostInteractions').orderBy('createdAt', 'desc').limit(5000).get();
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const userId = String(data.userId || '').trim();
      const postId = String(data.postId || '').trim();
      const actionType = String(data.actionType || '').trim();
      if (!userId || !postId || !actionType) continue;

      const createdAt = asDate(data.createdAt);
      if (createdAt < cutoff) continue;

      const dwellSec = Number.isFinite(Number(data.watchTimeSec)) ? Number(data.watchTimeSec) : (Number.isFinite(Number(data.dwellSec)) ? Number(data.dwellSec) : null);
      const mediaType = data.mediaType || data.media_type || null;

      await pool.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
      await pool.query(
        `INSERT INTO interactions (user_id, post_id, action, dwell_sec, media_type, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, postId, actionType, dwellSec, mediaType, createdAt]
      );
      count++;
    }
  } catch (e) {
    console.warn('Interactions migration partial:', e.message);
  }
  console.log('Done:', count, 'interactions migrated');
  return count;
}

async function main() {
  console.log('Starting Firestore -> Neon migration...\n');
  const scores = await migrateScores();
  const likes = await migrateLikedPosts();
  const interactions = await migrateInteractions();
  console.log(`\nMigration complete: ${scores} scores, ${likes} liked posts, ${interactions} interactions`);
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
