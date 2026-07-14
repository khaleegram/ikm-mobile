export function getMediaCdnUrl(): string {
  return (process.env.EXPO_PUBLIC_MEDIA_CDN_URL || '').replace(/\/$/, '');
}

export function isMediaCdnUrl(url: string): boolean {
  const cdn = getMediaCdnUrl();
  if (!cdn) return false;
  return String(url || '').trim().startsWith(cdn);
}
