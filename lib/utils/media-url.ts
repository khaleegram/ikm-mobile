import { getMediaCdnUrl } from '@/lib/config/media';

export function mediaUrlToStoragePath(url: string): string | null {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;

  const cdnBase = getMediaCdnUrl();
  if (cdnBase && trimmed.startsWith(cdnBase)) {
    return trimmed.slice(cdnBase.length).replace(/^\/+/, '');
  }

  const firebaseMatch = trimmed.match(/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/);
  if (firebaseMatch) {
    return decodeURIComponent(firebaseMatch[1]);
  }

  const googleMatch = trimmed.match(/storage\.googleapis\.com\/[^/]+\/(.+)/);
  if (googleMatch) {
    return googleMatch[1];
  }

  return null;
}

export function collectMediaPathsFromUrls(urls: Array<string | null | undefined>): string[] {
  const paths = new Set<string>();
  urls.forEach((url) => {
    const path = mediaUrlToStoragePath(String(url || ''));
    if (path) paths.add(path);
  });
  return Array.from(paths);
}
