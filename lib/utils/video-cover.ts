import * as VideoThumbnails from 'expo-video-thumbnails';

const thumbnailCache = new Map<string, string>();

export async function getVideoThumbnailUri(videoUri: string): Promise<string | null> {
  const key = String(videoUri || '').trim();
  if (!key) return null;

  const cached = thumbnailCache.get(key);
  if (cached) return cached;

  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(key, { time: 0, quality: 0.72 });
    thumbnailCache.set(key, uri);
    return uri;
  } catch {
    return null;
  }
}
