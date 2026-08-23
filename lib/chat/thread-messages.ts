import type { ChatMessage } from '@/types/chat';

/**
 * Merge an incoming page of messages onto existing ones, deduping by id / clientMsgId
 * and keeping the result sorted by createdAt.
 */
export function mergeThreadMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  const clientIdToKey = new Map<string, string>();

  const put = (message: ChatMessage) => {
    const clientId = String(message.clientMsgId || '').trim();
    let next = message;

    if (clientId) {
      const priorKey = clientIdToKey.get(clientId);
      if (priorKey) {
        const prior = map.get(priorKey);
        if (prior) {
          const priorLocal = String((prior.payload as any)?.localUri || '').trim();
          const nextLocal = String((next.payload as any)?.localUri || '').trim();
          if (priorLocal && !nextLocal) {
            next = { ...next, payload: { ...(next.payload || {}), localUri: priorLocal } };
          }
          map.delete(priorKey);
        }
      }
      clientIdToKey.set(clientId, message.id);
    }
    map.set(message.id, next);
  };

  for (const message of existing) put(message);
  for (const message of incoming) put(message);
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}
