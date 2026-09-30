/** Hybrid feed API base, e.g. https://chatcart-production.up.railway.app/v1 */
export function getApiBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}
