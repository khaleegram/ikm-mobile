import type { MarketPost } from '@/types';

const FALLBACK_CREATED_AT_MS = 0;

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

export function getMarketPostVideoCover(post: MarketPost | null | undefined): string {
  if (!post) return '';
  return getMarketPostPrimaryImage(post);
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
