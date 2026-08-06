import { mmkvStorage } from '@/lib/storage/mmkv';
import type { ChatInboxItem, ChatMessage, ChatPeerProfile, ChatThread } from '@/types/chat';

type CachedThread = {
  thread: ChatThread | null;
  peer: ChatPeerProfile | null;
  messages: ChatMessage[];
  updatedAt: number;
};

const MEMORY = new Map<string, CachedThread>();
const MAX_ENTRIES = 40;
const PERSIST_KEY = 'chat-thread-cache-v1';
const MAX_PERSISTED = 12;
const MAX_MESSAGES_PER_THREAD = 80;

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

/**
 * Merge an incoming page of messages onto existing ones, deduping by id / clientMsgId
 * and keeping the result sorted by createdAt. Every callsite that persists fetched
 * messages onto the cache must go through this — a raw array spread duplicates bubbles
 * whenever the incoming page overlaps what's already cached (e.g. prefetch-before-open).
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

function touch(threadId: string, entry: CachedThread, notifyListeners = true) {
  MEMORY.delete(threadId);
  MEMORY.set(threadId, entry);
  while (MEMORY.size > MAX_ENTRIES) {
    const oldest = MEMORY.keys().next().value;
    if (!oldest) break;
    MEMORY.delete(oldest);
  }
  schedulePersist();
  if (notifyListeners) notify(threadId);
}

type CacheListener = (threadId: string) => void;
const listeners = new Set<CacheListener>();

function notify(threadId: string) {
  listeners.forEach((fn) => {
    try {
      fn(threadId);
    } catch {
      // ignore listener errors
    }
  });
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistToDisk();
  }, 120);
}

function persistToDisk() {
  try {
    const entries = [...MEMORY.entries()]
      .filter(([id]) => !isPendingThreadId(id))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_PERSISTED)
      .map(([id, entry]) => [
        id,
        {
          ...entry,
          messages: (entry.messages || []).slice(-MAX_MESSAGES_PER_THREAD),
        },
      ]);
    mmkvStorage.setItem(PERSIST_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore persist failures
  }
}

function hydrateFromDisk() {
  try {
    const raw = mmkvStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CachedThread>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, entry] of Object.entries(parsed)) {
      if (!id || !entry || MEMORY.has(id)) continue;
      MEMORY.set(id, {
        thread: entry.thread ?? null,
        peer: entry.peer ?? null,
        messages: Array.isArray(entry.messages) ? entry.messages : [],
        updatedAt: Number(entry.updatedAt) || Date.now(),
      });
    }
  } catch {
    // ignore corrupt cache
  }
}

hydrateFromDisk();

export const chatThreadCache = {
  get(threadId: string): CachedThread | null {
    const key = String(threadId || '').trim();
    if (!key) return null;
    return MEMORY.get(key) ?? null;
  },

  set(
    threadId: string,
    data: {
      thread?: ChatThread | null;
      peer?: ChatPeerProfile | null;
      messages?: ChatMessage[];
    },
    options?: { notify?: boolean }
  ) {
    const key = String(threadId || '').trim();
    if (!key) return;
    const existing = MEMORY.get(key);
    touch(
      key,
      {
        thread: data.thread !== undefined ? data.thread : existing?.thread ?? null,
        peer: data.peer !== undefined ? data.peer : existing?.peer ?? null,
        messages: data.messages !== undefined ? data.messages : existing?.messages ?? [],
        updatedAt: Date.now(),
      },
      options?.notify !== false
    );
  },

  /** Merge a fetched page onto the cached thread — dedupes instead of blindly concatenating. */
  appendMessages(threadId: string, incoming: ChatMessage[], options?: { notify?: boolean }) {
    const key = String(threadId || '').trim();
    if (!key || !incoming.length) return;
    const existing = MEMORY.get(key);
    touch(
      key,
      {
        thread: existing?.thread ?? null,
        peer: existing?.peer ?? null,
        messages: mergeThreadMessages(existing?.messages || [], incoming),
        updatedAt: Date.now(),
      },
      options?.notify !== false
    );
  },

  /** Move optimistic pending room onto the real server UUID without losing bubbles. */
  migrate(fromThreadId: string, toThreadId: string) {
    const from = String(fromThreadId || '').trim();
    const to = String(toThreadId || '').trim();
    if (!from || !to || from === to) return;
    const source = MEMORY.get(from);
    if (!source) return;
    const target = MEMORY.get(to);
    const mergedMessages = [
      ...(target?.messages || []),
      ...(source.messages || []).map((m) => ({ ...m, threadId: to })),
    ];
    // Dedupe by id / clientMsgId
    const map = new Map<string, ChatMessage>();
    const byClient = new Map<string, string>();
    for (const message of mergedMessages) {
      const clientId = String(message.clientMsgId || '').trim();
      if (clientId && byClient.has(clientId)) {
        map.delete(byClient.get(clientId)!);
      }
      if (clientId) byClient.set(clientId, message.id);
      map.set(message.id, message);
    }
    touch(to, {
      thread: target?.thread || source.thread
        ? { ...(source.thread as ChatThread), ...(target?.thread || {}), id: to }
        : null,
      peer: target?.peer || source.peer,
      messages: [...map.values()].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
      updatedAt: Date.now(),
    });
    MEMORY.delete(from);
    schedulePersist();
    notify(to);
    notify(from);
  },

  subscribe(listener: CacheListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  findByPostAndPeer(postId: string, peerId: string): CachedThread | null {
    const post = String(postId || '').trim();
    const peer = String(peerId || '').trim();
    if (!post || !peer) return null;
    let pendingHit: CachedThread | null = null;
    for (const entry of MEMORY.values()) {
      const t = entry.thread;
      if (!t) continue;
      if (String(t.postId || '').trim() !== post) continue;
      const matchesPeer =
        String(t.sellerId || '').trim() === peer || String(t.buyerId || '').trim() === peer;
      if (!matchesPeer) continue;
      const id = String(t.id || '').trim();
      // Prefer a real UUID over a stale pending: room for the same product+peer.
      if (id && !isPendingThreadId(id)) return entry;
      if (!pendingHit) pendingHit = entry;
    }
    return pendingHit;
  },

  seedFromInbox(item: ChatInboxItem, options?: { notify?: boolean }) {
    const key = String(item.threadId || '').trim();
    if (!key) return;
    const existing = MEMORY.get(key);
    const notify = options?.notify !== false;

    const inboxPeer = {
      id: item.peerId,
      displayName: item.peerName,
      storeName: item.peerName || null,
      avatarUrl: item.peerAvatar || null,
      presence: item.peerPresence,
      lastSeenAt: item.peerLastSeenAt,
    } as ChatPeerProfile;

    const mergedPeer: ChatPeerProfile = existing?.peer
      ? {
          ...existing.peer,
          displayName: existing.peer.displayName || inboxPeer.displayName,
          storeName: existing.peer.storeName || inboxPeer.storeName,
          avatarUrl: existing.peer.avatarUrl || inboxPeer.avatarUrl,
          presence: existing.peer.presence || inboxPeer.presence,
          lastSeenAt: existing.peer.lastSeenAt || inboxPeer.lastSeenAt,
        }
      : inboxPeer;

    const baseThread =
      existing?.thread ??
      ({
        id: key,
        postId: item.postId,
        buyerId: '',
        sellerId: '',
        status: item.status,
        postSnapshot: item.postSnapshot || {},
        lastMessage: item.lastPreview,
        lastAt: item.lastAt,
      } as ChatThread);

    const priorSnap = baseThread.postSnapshot || {};
    const inboxSnap = item.postSnapshot || {};
    const mergedThread: ChatThread = {
      ...baseThread,
      postId: baseThread.postId || item.postId,
      status: baseThread.status || item.status,
      postSnapshot: {
        ...inboxSnap,
        ...priorSnap,
        title: priorSnap.title || inboxSnap.title || 'Product',
        imageUrl: priorSnap.imageUrl || inboxSnap.imageUrl || null,
      },
      lastMessage: baseThread.lastMessage || item.lastPreview,
      lastAt: baseThread.lastAt || item.lastAt,
    };

    touch(
      key,
      {
        thread: mergedThread,
        peer: mergedPeer,
        messages: existing?.messages ?? [],
        updatedAt: Date.now(),
      },
      notify
    );
  },

  seedOptimisticRoom(input: {
    threadId: string;
    postId: string;
    buyerId: string;
    sellerId: string;
    peerName?: string;
    /** Show the seller's real photo immediately instead of a blank bag icon while the thread resolves. */
    peerAvatar?: string | null;
    postSnapshot?: ChatThread['postSnapshot'];
    messages?: ChatMessage[];
  }) {
    const key = String(input.threadId || '').trim();
    if (!key) return;
    const existing = MEMORY.get(key);
    touch(key, {
      thread: {
        id: key,
        postId: input.postId,
        buyerId: input.buyerId,
        sellerId: input.sellerId,
        status: 'browsing',
        postSnapshot: input.postSnapshot || existing?.thread?.postSnapshot || {},
        lastMessage: input.messages?.[input.messages.length - 1]?.body || null,
        lastAt: new Date().toISOString(),
      },
      peer:
        existing?.peer ??
        ({
          id: input.sellerId,
          displayName: input.peerName || 'Seller',
          storeName: input.peerName || null,
          avatarUrl: input.peerAvatar || null,
        } as ChatPeerProfile),
      messages: input.messages?.length ? input.messages : existing?.messages ?? [],
      updatedAt: Date.now(),
    });
  },
};
