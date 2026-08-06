/**
 * Central deep-link builders + cold-start resolver for ChatCart.
 * Scheme comes from app.config.js (`chatcart` / `chatcart-seller`).
 */
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

export type DeepLinkEntity =
  | { type: 'post'; postId: string }
  | { type: 'chat'; chatId: string; peerId?: string }
  | { type: 'order'; orderId: string }
  | { type: 'seller'; sellerId: string }
  | { type: 'paystack'; reference?: string; rawUrl: string };

function cleanId(value: unknown): string {
  return String(value || '').trim();
}

/** Build a shareable app URL for a known entity. */
export function buildDeepLink(entity: Exclude<DeepLinkEntity, { type: 'paystack' }>): string {
  switch (entity.type) {
    case 'post':
      return Linking.createURL(`post/${encodeURIComponent(entity.postId)}`);
    case 'chat': {
      const base = Linking.createURL(`messages/${encodeURIComponent(entity.chatId)}`);
      const peer = cleanId(entity.peerId);
      return peer ? `${base}?peerId=${encodeURIComponent(peer)}` : base;
    }
    case 'order':
      return Linking.createURL(`orders/${encodeURIComponent(entity.orderId)}`);
    case 'seller':
      return Linking.createURL(`seller/${encodeURIComponent(entity.sellerId)}`);
    default:
      return Linking.createURL('/');
  }
}

/**
 * Parse an incoming URL into a typed entity.
 * Supports both path-style (`chatcart://post/abc`) and host-style (`chatcart://post/abc`).
 */
export function parseDeepLink(url: string): DeepLinkEntity | null {
  const raw = String(url || '').trim();
  if (!raw) return null;

  let path = '';
  let queryParams: Record<string, string | undefined> = {};

  try {
    const parsed = Linking.parse(raw);
    path = String(parsed.path || '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    // Linking.parse sometimes puts the first segment in `hostname` for custom schemes.
    if (!path && parsed.hostname) {
      const host = String(parsed.hostname || '').trim();
      const rest = String(parsed.path || '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
      path = rest ? `${host}/${rest}` : host;
    }
    queryParams = (parsed.queryParams || {}) as Record<string, string | undefined>;
  } catch {
    return null;
  }

  const lower = path.toLowerCase();

  // Paystack return — only when the path is clearly the callback route.
  if (lower === 'paystack-callback' || lower.startsWith('paystack-callback/')) {
    const reference =
      cleanId(queryParams.reference) ||
      cleanId(queryParams.trxref) ||
      cleanId(queryParams.ref) ||
      undefined;
    return { type: 'paystack', reference, rawUrl: raw };
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Strip optional market/ group prefixes if present in shared links.
  const first = segments[0].toLowerCase();
  const offset =
    first === '(market)' || first === 'market' || first === '(tabs)' || first === 'tabs' ? 1 : 0;
  const kind = String(segments[offset] || '').toLowerCase();
  const id = cleanId(segments[offset + 1]);

  if ((kind === 'post' || kind === 'post-view') && id) {
    return { type: 'post', postId: id };
  }
  if ((kind === 'messages' || kind === 'chat') && id) {
    return {
      type: 'chat',
      chatId: id,
      peerId: cleanId(queryParams.peerId) || undefined,
    };
  }
  if (kind === 'orders' && id) {
    return { type: 'order', orderId: id };
  }
  if (kind === 'seller' && id) {
    return { type: 'seller', sellerId: id };
  }

  return null;
}

/** Map a parsed entity to an expo-router href. */
export function hrefForDeepLink(entity: DeepLinkEntity): string {
  switch (entity.type) {
    case 'post':
      return `/(market)/post/${encodeURIComponent(entity.postId)}`;
    case 'chat': {
      const peer = cleanId(entity.peerId);
      const qs = peer ? `?peerId=${encodeURIComponent(peer)}` : '';
      return `/(market)/messages/${encodeURIComponent(entity.chatId)}${qs}`;
    }
    case 'order':
      return `/(market)/orders/${encodeURIComponent(entity.orderId)}`;
    case 'seller':
      return `/(market)/seller/${encodeURIComponent(entity.sellerId)}`;
    case 'paystack': {
      const ref = cleanId(entity.reference);
      return ref
        ? `/paystack-callback?reference=${encodeURIComponent(ref)}`
        : '/paystack-callback';
    }
    default:
      return '/';
  }
}

/** Navigate for a cold-start / runtime deep link. Returns true if handled. */
export function openDeepLink(url: string): boolean {
  const entity = parseDeepLink(url);
  if (!entity) return false;
  const href = hrefForDeepLink(entity);
  try {
    router.push(href as any);
    return true;
  } catch {
    return false;
  }
}
