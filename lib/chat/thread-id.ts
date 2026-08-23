const PENDING_PREFIX = 'pending:';

export function isPendingThreadId(threadId: string | null | undefined): boolean {
  return String(threadId || '').startsWith(PENDING_PREFIX);
}

export function buildPendingThreadId(postId: string, peerId: string): string {
  return `${PENDING_PREFIX}${String(postId).trim()}:${String(peerId).trim()}`;
}

export function parsePendingThreadId(
  threadId: string | null | undefined
): { postId: string; peerId: string } | null {
  const raw = String(threadId || '');
  if (!raw.startsWith(PENDING_PREFIX)) return null;
  const rest = raw.slice(PENDING_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  const postId = rest.slice(0, colon).trim();
  const peerId = rest.slice(colon + 1).trim();
  if (!postId || !peerId) return null;
  return { postId, peerId };
}
