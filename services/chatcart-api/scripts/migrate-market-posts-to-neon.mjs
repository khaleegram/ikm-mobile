import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function asString(v) {
  return String(v ?? '').trim();
}

function asDate(v) {
  if (!v) return new Date();
  if (v.toDate) return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function ensureUser(client, userId, profile = {}) {
  await client.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
  if (profile.displayName || profile.avatarUrl) {
    await client.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         store_name = COALESCE($4, store_name),
         store_logo_url = COALESCE($5, store_logo_url),
         email = COALESCE($6, email),
         updated_at = now()
       WHERE id = $1`,
      [
        userId,
        profile.displayName || null,
        profile.avatarUrl || null,
        profile.storeName || null,
        profile.storeLogoUrl || null,
        profile.email || null,
      ]
    );
  }
}

async function migrateUsers() {
  console.log('Migrating users…');
  const snap = await firestore.collection('users').get();
  const client = await pool.connect();
  let count = 0;
  try {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const first = asString(data.firstName);
      const last = asString(data.lastName);
      const displayName =
        asString(data.displayName) || `${first} ${last}`.trim() || asString(data.storeName) || null;
      await ensureUser(client, doc.id, {
        displayName,
        avatarUrl: asString(data.photoURL || data.avatarUrl) || null,
        storeName: asString(data.storeName) || null,
        storeLogoUrl: asString(data.storeLogoUrl) || null,
        email: asString(data.email) || null,
      });
      count += 1;
    }
  } finally {
    client.release();
  }
  console.log(`Users upserted: ${count}`);
}

async function migratePosts() {
  console.log('Migrating marketPosts…');
  const snap = await firestore.collection('marketPosts').get();
  const client = await pool.connect();
  let count = 0;
  try {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const posterId = asString(data.posterId);
      if (!posterId) continue;
      await ensureUser(client, posterId);

      const images = Array.isArray(data.images)
        ? data.images.map(asString).filter(Boolean)
        : [];
      const videoUrl = asString(data.videoUrl) || null;
      const coverUrl =
        asString(data.coverImageUrl) || images[0] || null;
      const hashtags = Array.isArray(data.hashtags)
        ? data.hashtags.map((t) => asString(t).toLowerCase()).filter(Boolean)
        : [];
      const mediaType = asString(data.mediaType) || (videoUrl ? 'video' : 'image_gallery');
      const price = Number(data.price);
      const likedBy = Array.isArray(data.likedBy)
        ? data.likedBy.map(asString).filter(Boolean)
        : [];

      await client.query(
        `INSERT INTO posts (
           id, poster_id, media_type, status, description, price, is_negotiable,
           hashtags, location, contact_method, cover_url, video_url, video_duration_ms,
           video_meta, sound_meta, likes_count, views_count, comments_count, liked_by,
           created_at, updated_at, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,
           $8::text[],$9::jsonb,$10,$11,$12,$13,
           $14::jsonb,$15::jsonb,$16,$17,$18,$19::text[],
           $20,$21,$22
         )
         ON CONFLICT (id) DO UPDATE SET
           description = EXCLUDED.description,
           price = EXCLUDED.price,
           cover_url = EXCLUDED.cover_url,
           video_url = EXCLUDED.video_url,
           hashtags = EXCLUDED.hashtags,
           likes_count = EXCLUDED.likes_count,
           views_count = EXCLUDED.views_count,
           comments_count = EXCLUDED.comments_count,
           liked_by = EXCLUDED.liked_by,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [
          doc.id,
          posterId,
          mediaType,
          asString(data.status) || 'active',
          asString(data.description) || null,
          Number.isFinite(price) && price > 0 ? price : null,
          Boolean(data.isNegotiable),
          hashtags,
          data.location ? JSON.stringify(data.location) : null,
          asString(data.contactMethod) || 'in-app',
          coverUrl,
          videoUrl,
          data.videoMeta?.durationMs != null ? Number(data.videoMeta.durationMs) : null,
          data.videoMeta ? JSON.stringify(data.videoMeta) : null,
          data.soundMeta ? JSON.stringify(data.soundMeta) : null,
          typeof data.likes === 'number' ? data.likes : likedBy.length,
          typeof data.views === 'number' ? data.views : 0,
          typeof data.comments === 'number' ? data.comments : 0,
          likedBy,
          asDate(data.createdAt),
          asDate(data.updatedAt),
          data.expiresAt ? asDate(data.expiresAt) : null,
        ]
      );

      await client.query(`DELETE FROM post_images WHERE post_id = $1`, [doc.id]);
      const imageList = images.length ? images : coverUrl ? [coverUrl] : [];
      for (let i = 0; i < imageList.length; i += 1) {
        await client.query(
          `INSERT INTO post_images (post_id, url, sort_order) VALUES ($1, $2, $3)`,
          [doc.id, imageList[i], i]
        );
      }

      await client.query(
        `INSERT INTO post_scores (
           post_id, poster_id, hashtags, media_type, status, total_points, score,
           breakdown, views_count, created_at, updated_at
         ) VALUES ($1,$2,$3::text[],$4,$5,0,0,'{}'::jsonb,$6,$7,now())
         ON CONFLICT (post_id) DO NOTHING`,
        [
          doc.id,
          posterId,
          hashtags,
          mediaType,
          asString(data.status) || 'active',
          typeof data.views === 'number' ? data.views : 0,
          asDate(data.createdAt),
        ]
      );

      count += 1;
      if (count % 50 === 0) console.log(`  posts: ${count}`);
    }
  } finally {
    client.release();
  }
  console.log(`Posts migrated: ${count}`);
}

async function migrateFollows() {
  console.log('Migrating marketFollows…');
  const snap = await firestore.collection('marketFollows').get();
  const client = await pool.connect();
  let count = 0;
  try {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const follower = asString(data.followerId);
      const followed = asString(data.followedId);
      if (!follower || !followed) continue;
      await ensureUser(client, follower);
      await ensureUser(client, followed);
      await client.query(
        `INSERT INTO follows (follower_id, followed_id, created_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [follower, followed, asDate(data.createdAt)]
      );
      count += 1;
    }
  } finally {
    client.release();
  }
  console.log(`Follows migrated: ${count}`);
}

async function migrateSaves() {
  console.log('Migrating marketSaves…');
  const snap = await firestore.collection('marketSaves').get();
  const client = await pool.connect();
  let count = 0;
  try {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const userId = asString(data.userId);
      const postId = asString(data.postId);
      if (!userId || !postId) continue;
      await ensureUser(client, userId);
      await client.query(
        `INSERT INTO user_saved_posts (user_id, post_id, saved_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, postId, asDate(data.createdAt)]
      );
      count += 1;
    }
  } finally {
    client.release();
  }
  console.log(`Saves migrated: ${count}`);
}

async function migrateBlocks() {
  console.log('Migrating marketBlocks…');
  const snap = await firestore.collection('marketBlocks').get();
  const client = await pool.connect();
  let count = 0;
  try {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const blocker = asString(data.blockerId);
      const blocked = asString(data.blockedId);
      if (!blocker || !blocked) continue;
      await ensureUser(client, blocker);
      await ensureUser(client, blocked);
      await client.query(
        `INSERT INTO user_blocks (blocker_id, blocked_id, created_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [blocker, blocked, asDate(data.createdAt)]
      );
      count += 1;
    }
  } finally {
    client.release();
  }
  console.log(`Blocks migrated: ${count}`);
}

async function migrateComments() {
  console.log('Migrating marketPostComments…');
  const snap = await firestore.collection('marketPostComments').get();
  const client = await pool.connect();
  let count = 0;
  try {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const postId = asString(data.postId);
      const userId = asString(data.userId || data.authorId);
      const body = asString(data.text || data.body || data.comment);
      if (!postId || !userId || !body) continue;
      await ensureUser(client, userId);
      await client.query(
        `INSERT INTO post_comments (id, post_id, user_id, body, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (id) DO NOTHING`,
        [doc.id, postId, userId, body, asDate(data.createdAt)]
      );
      count += 1;
    }
  } finally {
    client.release();
  }
  console.log(`Comments migrated: ${count}`);
}

async function main() {
  await migrateUsers();
  await migratePosts();
  await migrateFollows();
  await migrateSaves();
  await migrateBlocks();
  await migrateComments();
  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
