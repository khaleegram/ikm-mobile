import { MarketMessage } from '@/types';

export const lightBrown = '#A67C52';

export function isDirectConversationId(chatId: string | null): boolean {
  return Boolean(chatId && chatId.startsWith('direct_'));
}

export function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as any).toMillis === 'function') return (value as any).toMillis();
  if (value && typeof (value as any).toDate === 'function') return (value as any).toDate().getTime();
  const parsed = new Date(value as any).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveProfileName(profile: any, fallback: string): string {
  const first = String(profile?.firstName || '').trim();
  const last = String(profile?.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;

  const display = String(profile?.displayName || '').trim();
  if (display) return display;

  const store = String(profile?.storeName || '').trim();
  if (store) return store;

  return fallback;
}

export function getStableMessageKey(message: Partial<MarketMessage>, fallbackChatId: string): string {
  const explicitId = String(message?.id || '').trim();
  if (explicitId) return explicitId;

  const clientId = String((message as any)?.clientMessageId || '').trim();
  if (clientId) return `client:${clientId}`;

  const chatId = String(message?.chatId || fallbackChatId || '').trim();
  const senderId = String(message?.senderId || '').trim();
  const createdAtMs = toMs((message as any)?.createdAt);
  const text = String((message as any)?.message || (message as any)?.text || '').trim();
  return `fallback:${chatId}:${senderId}:${createdAtMs}:${text}`;
}

export function buildClientMessageId(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
