/** Pure conversation-id helpers (no Firestore). Used for legacy deep-link parsing only. */

function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}

export function buildDirectConversationId(userA: string, userB: string): string {
  const left = asNonEmptyString(userA);
  const right = asNonEmptyString(userB);
  const [minUid, maxUid] = [left, right].sort((a, b) => a.localeCompare(b));
  return `direct_${minUid}_${maxUid}`;
}

export function parseDirectConversationId(
  conversationId: string
): { userA: string; userB: string } | null {
  const normalized = asNonEmptyString(conversationId);
  if (!normalized.startsWith('direct_')) return null;
  const parts = normalized.split('_');
  if (parts.length !== 3) return null;
  const userA = asNonEmptyString(parts[1]);
  const userB = asNonEmptyString(parts[2]);
  if (!userA || !userB) return null;
  return { userA, userB };
}

export function resolveDirectConversationPeerId(
  conversationId: string,
  currentUserId: string
): string | null {
  const parsed = parseDirectConversationId(conversationId);
  if (!parsed) return null;
  if (parsed.userA === currentUserId) return parsed.userB;
  if (parsed.userB === currentUserId) return parsed.userA;
  return null;
}
