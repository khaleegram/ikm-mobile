import { createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config, isR2Configured } from './config.mjs';

const execFileAsync = promisify(execFile);

const ALLOWED_PREFIXES = new Set([
  'marketPosts',
  'products',
  'marketSounds',
  'profile_pictures',
  'store_images',
  'marketMessages',
  'chatVoice',
  'chatImages',
  'avatars',
  'orderProof',
  'marketStatuses',
]);

const CHAT_VOICE_MAX_BYTES = 512 * 1024;

let r2Client = null;

function getR2Client() {
  if (!isR2Configured()) {
    const err = new Error('R2 media storage is not configured on the API');
    err.statusCode = 503;
    throw err;
  }
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }
  return r2Client;
}

export function normalizeStoragePath(storagePath) {
  return String(storagePath || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');
}

export function buildPublicMediaUrl(storagePath) {
  const normalized = normalizeStoragePath(storagePath);
  return `${config.mediaCdnUrl}/${normalized}`;
}

export function urlToStoragePath(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;

  const cdnBase = config.mediaCdnUrl;
  if (cdnBase && trimmed.startsWith(cdnBase)) {
    return normalizeStoragePath(trimmed.slice(cdnBase.length));
  }

  const firebaseMatch = trimmed.match(/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/);
  if (firebaseMatch) {
    return normalizeStoragePath(decodeURIComponent(firebaseMatch[1]));
  }

  const googleMatch = trimmed.match(/storage\.googleapis\.com\/[^/]+\/(.+)/);
  if (googleMatch) {
    return normalizeStoragePath(googleMatch[1]);
  }

  return null;
}

export function validateMediaPath(storagePath, uid) {
  return validateMediaPathDetailed(storagePath, uid).ok;
}

export function validateMediaPathDetailed(storagePath, uid) {
  const normalized = normalizeStoragePath(storagePath);
  if (!normalized || normalized.includes('..')) {
    return { ok: false, reason: 'invalid' };
  }

  const parts = normalized.split('/');
  const prefix = parts[0];
  if (!ALLOWED_PREFIXES.has(prefix)) {
    return { ok: false, reason: 'prefix', prefix };
  }

  if (parts.length < 3 || parts[1] !== uid) {
    return { ok: false, reason: 'owner', prefix };
  }

  return { ok: true };
}

export async function createPresignedUpload({ uid, storagePath, contentType, contentLength }) {
  const path = normalizeStoragePath(storagePath);
  const validation = validateMediaPathDetailed(path, uid);
  if (!validation.ok) {
    const err = new Error(
      validation.reason === 'prefix'
        ? `Invalid media prefix "${validation.prefix}". Redeploy chatcart-api if this folder was recently added.`
        : 'Invalid or unauthorized media path. Use {folder}/{yourUserId}/{fileName}.'
    );
    err.statusCode = 403;
    throw err;
  }

  if (path.startsWith('chatVoice/') && Number(contentLength) > CHAT_VOICE_MAX_BYTES) {
    const err = new Error('Voice note exceeds maximum size');
    err.statusCode = 400;
    throw err;
  }

  const resolvedContentType = String(contentType || 'application/octet-stream').trim();
  const command = new PutObjectCommand({
    Bucket: config.r2Bucket,
    Key: path,
    ContentType: resolvedContentType,
    CacheControl: 'public, max-age=31536000, immutable',
    ...(Number.isFinite(contentLength) && contentLength > 0
      ? { ContentLength: Number(contentLength) }
      : {}),
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, {
    expiresIn: config.mediaPresignTtlSec,
  });

  return {
    uploadUrl,
    publicUrl: buildPublicMediaUrl(path),
    path,
    contentType: resolvedContentType,
  };
}

export async function deleteStorageObjects(paths) {
  const keys = Array.from(
    new Set(
      (Array.isArray(paths) ? paths : [])
        .map((value) => normalizeStoragePath(value))
        .filter(Boolean)
    )
  );

  if (!keys.length) {
    return { deleted: 0 };
  }

  const client = getR2Client();
  const result = await client.send(
    new DeleteObjectsCommand({
      Bucket: config.r2Bucket,
      Delete: {
        Objects: keys.map((Key) => ({ Key })),
        Quiet: true,
      },
    })
  );

  return { deleted: result.Deleted?.length || 0, keys };
}

export async function deleteMediaForUser(uid, rawPaths) {
  const paths = (Array.isArray(rawPaths) ? rawPaths : [])
    .map((value) => normalizeStoragePath(value))
    .filter((value) => validateMediaPath(value, uid));

  return deleteStorageObjects(paths);
}

export function collectMediaPathsFromPost(postData = {}) {
  const paths = new Set();
  const addUrl = (url) => {
    const storagePath = urlToStoragePath(url);
    if (storagePath) paths.add(storagePath);
  };

  addUrl(postData.videoUrl);
  addUrl(postData.coverImageUrl);
  if (Array.isArray(postData.images)) {
    postData.images.forEach(addUrl);
  }
  if (postData.soundMeta) {
    addUrl(postData.soundMeta.sourceUri);
    addUrl(postData.soundMeta.artworkUrl);
  }

  return Array.from(paths);
}

function parseMarketPostIdFromVideoPath(objectName) {
  const parts = normalizeStoragePath(objectName).split('/');
  if (parts[0] !== 'marketPosts' || parts.length < 3) {
    return { ownerId: null, postId: null };
  }
  const ownerId = parts[1] || null;
  const fileName = parts.slice(2).join('/');
  const match = fileName.match(/post_([a-zA-Z0-9_-]+)\./);
  return { ownerId, postId: match?.[1] ? String(match[1]).trim() : null };
}

async function downloadObjectToFile(storagePath, destination) {
  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.r2Bucket,
      Key: normalizeStoragePath(storagePath),
    })
  );

  await pipeline(response.Body, createWriteStream(destination));
}

async function uploadFileToR2(storagePath, filePath, contentType) {
  const body = await fs.readFile(filePath);
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: config.r2Bucket,
      Key: normalizeStoragePath(storagePath),
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return buildPublicMediaUrl(storagePath);
}

export async function processOriginalMarketSound({ uid, postId, videoPath }) {
  const normalizedVideoPath = normalizeStoragePath(videoPath);
  if (!validateMediaPath(normalizedVideoPath, uid)) {
    const err = new Error('Invalid video path for sound extraction');
    err.statusCode = 403;
    throw err;
  }

  const parsed = parseMarketPostIdFromVideoPath(normalizedVideoPath);
  if (!parsed.postId || parsed.postId !== String(postId || '').trim()) {
    const err = new Error('Video path does not match post ID');
    err.statusCode = 400;
    throw err;
  }

  const { getPostById } = await import('./posts-repo.mjs');
  const { pool } = await import('./db.mjs');
  const postData = await getPostById(postId);
  if (!postData) {
    const err = new Error('Post not found');
    err.statusCode = 404;
    throw err;
  }
  if (String(postData.posterId || '') !== uid) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  const soundId = String(postData.soundMeta?.soundId || '').trim();
  const soundType = String(postData.soundMeta?.sourceType || '').trim().toLowerCase();
  if (!soundId || soundType !== 'original') {
    return { skipped: true, reason: 'not_original_sound' };
  }

  let ffmpegPath = null;
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    ffmpegPath = ffmpegStatic.default || ffmpegStatic;
  } catch {
    ffmpegPath = null;
  }

  if (!ffmpegPath) {
    const err = new Error('ffmpeg is not available on the API server');
    err.statusCode = 503;
    throw err;
  }

  const tmpVideoPath = path.join(os.tmpdir(), `ikm_video_${postId}_${Date.now()}.mp4`);
  const tmpAudioPath = path.join(os.tmpdir(), `ikm_sound_${postId}_${Date.now()}.m4a`);
  const destPath = `marketSounds/${uid}/sound_${postId}.m4a`;

  try {
    await downloadObjectToFile(normalizedVideoPath, tmpVideoPath);
    await execFileAsync(ffmpegPath, [
      '-y',
      '-i',
      tmpVideoPath,
      '-vn',
      '-acodec',
      'aac',
      '-b:a',
      '128k',
      tmpAudioPath,
    ]);

    const audioUrl = await uploadFileToR2(destPath, tmpAudioPath, 'audio/mp4');
    const nextSoundMeta = {
      ...(postData.soundMeta || {}),
      sourceUri: audioUrl,
    };
    if (pool) {
      await pool.query(
        `UPDATE posts
         SET sound_meta = $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [postId, JSON.stringify(nextSoundMeta)]
      );
    }

    try {
      const { upsertSound } = await import('./sounds.mjs');
      await upsertSound({
        id: soundId,
        title: nextSoundMeta.title || 'Original sound',
        createdBy: uid,
        creatorName: nextSoundMeta.creatorName,
        sourceType: nextSoundMeta.sourceType || 'original',
        sourceUri: audioUrl,
        artworkUrl: nextSoundMeta.artworkUrl || postData.coverImageUrl,
        durationMs: nextSoundMeta.durationMs,
        rightsStatus: 'owned',
        status: 'active',
      });
    } catch (err) {
      console.warn('[media] upsertSound after extraction failed:', err?.message || err);
    }

    return { success: true, audioUrl, path: destPath };
  } finally {
    await fs.unlink(tmpVideoPath).catch(() => undefined);
    await fs.unlink(tmpAudioPath).catch(() => undefined);
  }
}
