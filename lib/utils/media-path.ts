/**
 * R2 storage paths must match chatcart-api validation:
 *   {allowedPrefix}/{firebaseUid}/{fileName}
 */
export const MEDIA_STORAGE_PREFIXES = [
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
] as const;

export type MediaStoragePrefix = (typeof MEDIA_STORAGE_PREFIXES)[number];

const ALLOWED_PREFIX_SET = new Set<string>(MEDIA_STORAGE_PREFIXES);

export function buildUserMediaPath(
  prefix: MediaStoragePrefix,
  uid: string,
  fileName: string,
): string {
  const ownerId = String(uid || '').trim();
  const safeFileName = String(fileName || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');

  if (!ownerId) {
    throw new Error('You must be logged in to upload media.');
  }
  if (!safeFileName || safeFileName.includes('..') || safeFileName.includes('/')) {
    throw new Error('Invalid media file name.');
  }
  if (!ALLOWED_PREFIX_SET.has(prefix)) {
    throw new Error(`Unsupported media folder: ${prefix}`);
  }

  return `${prefix}/${ownerId}/${safeFileName}`;
}

export function assertUserMediaPath(path: string, uid: string): void {
  const normalized = String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');

  if (!normalized || normalized.includes('..')) {
    throw new Error('Invalid media path.');
  }

  const parts = normalized.split('/');
  const prefix = parts[0];
  const ownerId = String(uid || '').trim();

  if (!ALLOWED_PREFIX_SET.has(prefix)) {
    throw new Error(`Uploads must use an allowed media folder (got "${prefix}").`);
  }
  if (parts.length < 3 || parts[1] !== ownerId) {
    throw new Error('Upload path must be scoped to your account: {folder}/{yourUserId}/{file}.');
  }
}
