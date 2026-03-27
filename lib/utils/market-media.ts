import type { MarketPost, MarketSound } from '@/types';

const FALLBACK_CREATED_AT_MS = 0;

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTitleCase(value: string): string {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inferFileExtension(uri: string, fallback: string): string {
  const normalized = String(uri || '').split('?')[0];
  const lastSegment = normalized.split('/').pop() || '';
  const extension = lastSegment.includes('.') ? lastSegment.split('.').pop() : '';
  const trimmed = String(extension || '').trim().toLowerCase();
  return trimmed || fallback;
}

export function extractFileStem(uri: string): string {
  const normalized = String(uri || '').split('?')[0];
  const lastSegment = normalized.split('/').pop() || '';
  const stem = lastSegment.includes('.') ? lastSegment.slice(0, lastSegment.lastIndexOf('.')) : lastSegment;
  return stem.trim();
}

export function buildOriginalSoundTitle(displayName?: string | null): string {
  const cleaned = toTitleCase(displayName || '');
  return cleaned ? `Original sound - ${cleaned}` : 'Original sound';
}

export function buildUploadedSoundTitle(uri: string, displayName?: string | null): string {
  const stem = toTitleCase(extractFileStem(uri).replace(/[_-]+/g, ' '));
  if (stem) return stem;
  const cleaned = toTitleCase(displayName || '');
  return cleaned ? `${cleaned} sound` : 'Uploaded sound';
}

export function isVideoMarketPost(post: MarketPost | null | undefined): boolean {
  if (!post) return false;
  return post.mediaType === 'video' || Boolean(String(post.videoUrl || '').trim());
}

export function getMarketPostPrimaryImage(post: MarketPost | null | undefined): string {
  if (!post) return '';
  const cover = String(post.coverImageUrl || '').trim();
  const firstImage = Array.isArray(post.images) ? String(post.images[0] || '').trim() : '';
  return cover || firstImage;
}

export function buildMarketPostStableKey(post: MarketPost | null | undefined): string {
  if (!post) return 'market-post-unknown';
  if (post.id) return post.id;
  const createdAt =
    post.createdAt instanceof Date
      ? post.createdAt.getTime()
      : typeof (post.createdAt as { toDate?: () => Date } | undefined)?.toDate === 'function'
        ? (post.createdAt as { toDate: () => Date }).toDate().getTime()
        : FALLBACK_CREATED_AT_MS;
  const descriptionSlug = slugify(post.description || '').slice(0, 48) || 'post';
  return `market-post-${post.posterId || 'unknown'}-${createdAt}-${descriptionSlug}`;
}

export function buildMarketSoundStableKey(sound: MarketSound | null | undefined): string {
  if (!sound) return 'market-sound-unknown';
  if (sound.id) return sound.id;
  const createdAt =
    sound.createdAt instanceof Date
      ? sound.createdAt.getTime()
      : typeof (sound.createdAt as { toDate?: () => Date } | undefined)?.toDate === 'function'
        ? (sound.createdAt as { toDate: () => Date }).toDate().getTime()
        : FALLBACK_CREATED_AT_MS;
  return `market-sound-${sound.createdBy || 'unknown'}-${createdAt}-${slugify(sound.title).slice(0, 48) || 'sound'}`;
}
