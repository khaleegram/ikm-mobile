/**
 * One-time migration: copy Firebase Storage objects to Cloudflare R2 and rewrite Firestore URLs.
 *
 * Usage:
 *   node scripts/migrate-firebase-storage-to-r2.mjs
 *
 * Required env:
 *   DATABASE_URL (unused here)
 *   FIREBASE_PROJECT_ID
 *   GOOGLE_APPLICATION_CREDENTIALS
 *   FIREBASE_STORAGE_BUCKET
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   MEDIA_CDN_URL
 */
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createReadStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  buildPublicMediaUrl,
  normalizeStoragePath,
  urlToStoragePath,
} from '../src/media.mjs';

const {
  FIREBASE_PROJECT_ID = 'ikm-marketplace',
  GOOGLE_APPLICATION_CREDENTIALS,
  FIREBASE_STORAGE_BUCKET,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  MEDIA_CDN_URL,
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

requireEnv('GOOGLE_APPLICATION_CREDENTIALS', GOOGLE_APPLICATION_CREDENTIALS);
requireEnv('FIREBASE_STORAGE_BUCKET', FIREBASE_STORAGE_BUCKET);
requireEnv('R2_ACCOUNT_ID', R2_ACCOUNT_ID);
requireEnv('R2_ACCESS_KEY_ID', R2_ACCESS_KEY_ID);
requireEnv('R2_SECRET_ACCESS_KEY', R2_SECRET_ACCESS_KEY);
requireEnv('R2_BUCKET', R2_BUCKET);
requireEnv('MEDIA_CDN_URL', MEDIA_CDN_URL);

const credentialJson = JSON.parse(await fs.readFile(GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));

if (getApps().length === 0) {
  initializeApp({
    credential: cert(credentialJson),
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });
}

const firestore = getFirestore();
const bucket = getStorage().bucket(FIREBASE_STORAGE_BUCKET);
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const migrated = new Set();

function rewriteUrl(url) {
  const storagePath = urlToStoragePath(url);
  if (!storagePath) return url;
  if (String(url).startsWith(MEDIA_CDN_URL.replace(/\/$/, ''))) return url;
  return buildPublicMediaUrl(storagePath);
}

async function copyObjectToR2(storagePath) {
  const key = normalizeStoragePath(storagePath);
  if (!key || migrated.has(key)) return;

  const file = bucket.file(key);
  const [exists] = await file.exists();
  if (!exists) {
    console.warn(`Skipping missing Firebase object: ${key}`);
    return;
  }

  const [metadata] = await file.getMetadata();
  const tmpPath = path.join(os.tmpdir(), `migrate_${Date.now()}_${key.replace(/[\\/]/g, '_')}`);
  await file.download({ destination: tmpPath });

  const body = await fs.readFile(tmpPath);
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: metadata.contentType || 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  await fs.unlink(tmpPath).catch(() => undefined);
  migrated.add(key);
  console.log(`Copied ${key}`);
}

function collectUrlsFromDoc(data) {
  const urls = [];
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) urls.push(value.trim());
  };

  add(data.videoUrl);
  add(data.coverImageUrl);
  add(data.imageUrl);
  add(data.storeLogoUrl);
  add(data.storeBannerUrl);
  add(data.avatarUrl);
  add(data.photoURL);
  add(data.audioDescription);
  add(data.videoUrl);

  if (Array.isArray(data.images)) data.images.forEach(add);
  if (Array.isArray(data.imageUrls)) data.imageUrls.forEach(add);
  if (data.soundMeta) {
    add(data.soundMeta.sourceUri);
    add(data.soundMeta.artworkUrl);
  }

  return urls;
}

async function migrateCollection(collectionName, transform) {
  const snapshot = await firestore.collection(collectionName).get();
  let updated = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() || {};
    const urls = collectUrlsFromDoc(data);
    const paths = urls.map(urlToStoragePath).filter(Boolean);

    for (const storagePath of paths) {
      await copyObjectToR2(storagePath);
    }

    const nextData = transform ? transform(data) : data;
    const changed = JSON.stringify(nextData) !== JSON.stringify(data);
    if (changed) {
      await docSnap.ref.set(nextData, { merge: true });
      updated += 1;
    }
  }

  console.log(`${collectionName}: scanned ${snapshot.size}, updated ${updated}`);
}

function rewriteDocUrls(data) {
  const next = { ...data };
  const rewriteField = (field) => {
    if (typeof next[field] === 'string' && next[field].trim()) {
      next[field] = rewriteUrl(next[field]);
    }
  };

  rewriteField('videoUrl');
  rewriteField('coverImageUrl');
  rewriteField('imageUrl');
  rewriteField('storeLogoUrl');
  rewriteField('storeBannerUrl');
  rewriteField('avatarUrl');
  rewriteField('photoURL');
  rewriteField('audioDescription');

  if (Array.isArray(next.images)) {
    next.images = next.images.map((url) => rewriteUrl(url));
  }
  if (Array.isArray(next.imageUrls)) {
    next.imageUrls = next.imageUrls.map((url) => rewriteUrl(url));
  }
  if (next.soundMeta) {
    next.soundMeta = {
      ...next.soundMeta,
      sourceUri: rewriteUrl(next.soundMeta.sourceUri),
      artworkUrl: next.soundMeta.artworkUrl ? rewriteUrl(next.soundMeta.artworkUrl) : next.soundMeta.artworkUrl,
    };
  }

  return next;
}

async function migrateChatMessages() {
  const chats = await firestore.collection('marketChats').get();
  let updated = 0;

  for (const chatDoc of chats.docs) {
    const messages = await chatDoc.ref.collection('messages').get();
    for (const messageDoc of messages.docs) {
      const data = messageDoc.data() || {};
      const imageUrl = String(data.imageUrl || '').trim();
      if (!imageUrl) continue;

      const storagePath = urlToStoragePath(imageUrl);
      if (storagePath) await copyObjectToR2(storagePath);

      const rewritten = rewriteUrl(imageUrl);
      if (rewritten !== imageUrl) {
        await messageDoc.ref.set({ imageUrl: rewritten }, { merge: true });
        updated += 1;
      }
    }
  }

  console.log(`marketChats/messages: updated ${updated}`);
}

async function main() {
  await migrateCollection('marketPosts', rewriteDocUrls);
  await migrateCollection('marketSounds', rewriteDocUrls);
  await migrateCollection('products', rewriteDocUrls);
  await migrateCollection('users', rewriteDocUrls);
  await migrateCollection('stores', rewriteDocUrls);
  await migrateChatMessages();
  console.log(`Migration complete. Copied ${migrated.size} unique objects to R2.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
