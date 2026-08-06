import type { MarketPost } from '@/types';

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];
}

/**
 * Normalize any post-shaped payload (API JSON or legacy Firestore doc) into MarketPost.
 * Lives outside `lib/firebase/firestore/` so feed/clip code does not depend on Firestore types.
 */
export function normalizeMarketPostRecord(id: string, data: Record<string, any>): MarketPost {
  const videoUrl = String(data.videoUrl || '').trim();
  const soundTitle = String(data.soundMeta?.title || '').trim();
  const soundSourceUri = String(data.soundMeta?.sourceUri || '').trim();
  const images = asStringArray(data.images);
  const resolvedCoverImageUrl =
    String(data.coverImageUrl || '').trim() || (videoUrl && images[0] ? images[0] : '');
  const coverImageUrl = resolvedCoverImageUrl;

  return {
    id,
    posterId: String(data.posterId || '').trim(),
    posterStoreName: String(data.posterStoreName || '').trim() || undefined,
    posterAvatarUrl: String(data.posterAvatarUrl || '').trim() || undefined,
    mediaType: data.mediaType || (videoUrl ? 'video' : 'image_gallery'),
    images,
    coverImageUrl: coverImageUrl || undefined,
    videoUrl: videoUrl || undefined,
    videoMeta:
      data.videoMeta || videoUrl
        ? {
            durationMs: Number.isFinite(data.videoMeta?.durationMs)
              ? Number(data.videoMeta.durationMs)
              : undefined,
            width: Number.isFinite(data.videoMeta?.width) ? Number(data.videoMeta.width) : undefined,
            height: Number.isFinite(data.videoMeta?.height)
              ? Number(data.videoMeta.height)
              : undefined,
            aspectRatio: Number.isFinite(data.videoMeta?.aspectRatio)
              ? Number(data.videoMeta.aspectRatio)
              : undefined,
            originalAudioMuted: Boolean(data.videoMeta?.originalAudioMuted),
          }
        : undefined,
    soundMeta:
      soundTitle || soundSourceUri
        ? {
            soundId: String(data.soundMeta?.soundId || '').trim() || undefined,
            title: soundTitle || 'Untitled sound',
            sourceUri: soundSourceUri || '',
            sourceType: data.soundMeta?.sourceType || 'uploaded',
            artworkUrl: String(data.soundMeta?.artworkUrl || '').trim() || undefined,
            durationMs: Number.isFinite(data.soundMeta?.durationMs)
              ? Number(data.soundMeta.durationMs)
              : undefined,
            startMs: Number.isFinite(data.soundMeta?.startMs)
              ? Number(data.soundMeta.startMs)
              : undefined,
            soundVolume: Number.isFinite(data.soundMeta?.soundVolume)
              ? Number(data.soundMeta.soundVolume)
              : undefined,
            originalAudioVolume: Number.isFinite(data.soundMeta?.originalAudioVolume)
              ? Number(data.soundMeta.originalAudioVolume)
              : undefined,
            useOriginalVideoAudio: Boolean(data.soundMeta?.useOriginalVideoAudio),
          }
        : undefined,
    hashtags: asStringArray(data.hashtags),
    price: Number.isFinite(data.price) ? Number(data.price) : undefined,
    isNegotiable: Boolean(data.isNegotiable),
    title: String(data.title || '').trim() || undefined,
    description: String(data.description || '').trim() || undefined,
    location:
      data.location && (data.location.state || data.location.city)
        ? {
            state: String(data.location.state || '').trim() || undefined,
            city: String(data.location.city || '').trim() || undefined,
          }
        : undefined,
    contactMethod: data.contactMethod || 'in-app',
    likes: typeof data.likes === 'number' ? data.likes : 0,
    views: typeof data.views === 'number' ? data.views : 0,
    comments: typeof data.comments === 'number' ? data.comments : 0,
    likedBy: asStringArray(data.likedBy),
    status: data.status || 'active',
    createdAt: asDate(data.createdAt),
    updatedAt: asDate(data.updatedAt),
    expiresAt: data.expiresAt ? asDate(data.expiresAt) : undefined,
  };
}
