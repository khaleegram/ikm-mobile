import { MarketMessage } from '@/types';

export const lightBrown = '#A67C52';

/**
 * Text and icons that sit on a `lightBrown` / success-green fill.
 *
 * White on this gold measures 3.73:1 and white on the success green only 2.54:1 — both fail the
 * 4.5:1 needed for readable text. Dark text on the same fills measures 4.79:1 and 7.05:1. This
 * applies in both themes because the chat's gold is a fixed brand colour, not a theme token.
 * Dark fills (the destructive red at 6.47:1 with white) keep white.
 */
export const onLightFill = '#111827';

export function isDirectConversationId(chatId: string | null): boolean {
  return Boolean(chatId && chatId.startsWith('direct_'));
}

export function getMessageTimeMs(value: unknown): number {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  const parsed = new Date(value as any).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashStableKey(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/** Chat/deal peer label — store name first, never email. */
export function resolveProfileName(profile: any, fallback: string): string {
  const store = String(profile?.storeName || '').trim();
  if (store) return store;

  const display = String(profile?.displayName || '').trim();
  if (display && !display.includes('@')) return display;

  const first = String(profile?.firstName || '').trim();
  const last = String(profile?.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  if (full && !full.includes('@')) return full;

  return fallback;
}

/** True when a string looks like an email address. */
export function looksLikeEmail(value: unknown): boolean {
  const s = String(value || '').trim();
  return s.includes('@') && s.includes('.');
}

export function getStableMessageKey(message: Partial<MarketMessage>, fallbackChatId: string): string {
  // Prefer client id so optimistic → server swaps do not remount bubbles (critical for voice).
  const clientId = String((message as any)?.clientMessageId || '').trim();
  if (clientId) return `client:${clientId}`;

  const explicitId = String(message?.id || '').trim();
  if (explicitId) return explicitId;

  const chatId = String(message?.chatId || fallbackChatId || '').trim();
  const senderId = String(message?.senderId || '').trim();
  const createdAtMs = getMessageTimeMs((message as any)?.createdAt);
  const text = String((message as any)?.text || (message as any)?.message || '').trim();
  const hash = hashStableKey(`${chatId}|${senderId}|${createdAtMs}|${text}`);
  return `fallback:${hash}`;
}

export function buildClientMessageId(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
