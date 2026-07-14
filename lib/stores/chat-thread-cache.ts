import type { ChatInboxItem, ChatMessage, ChatPeerProfile, ChatThread } from '@/types/chat';

type CachedThread = {
  thread: ChatThread | null;
  peer: ChatPeerProfile | null;
  messages: ChatMessage[];
  updatedAt: number;
};

const cache = new Map<string, CachedThread>();
const MAX_ENTRIES = 40;

function touch(threadId: string, entry: CachedThread) {
  cache.delete(threadId);
  cache.set(threadId, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export const chatThreadCache = {
  get(threadId: string): CachedThread | null {
    const key = String(threadId || '').trim();
    if (!key) return null;
    return cache.get(key) ?? null;
  },

  set(
    threadId: string,
    data: {
      thread?: ChatThread | null;
      peer?: ChatPeerProfile | null;
      messages?: ChatMessage[];
    }
  ) {
    const key = String(threadId || '').trim();
    if (!key) return;
    const existing = cache.get(key);
    touch(key, {
      thread: data.thread !== undefined ? data.thread : existing?.thread ?? null,
      peer: data.peer !== undefined ? data.peer : existing?.peer ?? null,
      messages: data.messages !== undefined ? data.messages : existing?.messages ?? [],
      updatedAt: Date.now(),
    });
  },

  seedFromInbox(item: ChatInboxItem) {
    const key = String(item.threadId || '').trim();
    if (!key) return;
    const existing = cache.get(key);
    if (existing?.messages?.length) return;

    touch(key, {
      thread:
        existing?.thread ??
        ({
          id: key,
          postId: item.postId,
          buyerId: '',
          sellerId: '',
          status: item.status,
          postSnapshot: item.postSnapshot,
          lastMessage: item.lastPreview,
          lastAt: item.lastAt,
        } as ChatThread),
      peer:
        existing?.peer ??
        ({
          id: item.peerId,
          displayName: item.peerName,
          avatarUrl: item.peerAvatar,
          presence: item.peerPresence,
          lastSeenAt: item.peerLastSeenAt,
        } as ChatPeerProfile),
      messages: existing?.messages ?? [],
      updatedAt: existing?.updatedAt ?? Date.now(),
    });
  },
};
