import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { mmkvStorage } from '@/lib/storage/mmkv';
import type { ChatInboxItem, ChatMessage, ChatPeerProfile, ChatThread } from '@/types/chat';

import { isPendingThreadId } from './thread-id';
import { mergeThreadMessages } from './thread-messages';

const LEGACY_THREAD_CACHE_KEY = 'chat-thread-cache-v1';
const LEGACY_INBOX_CACHE_KEY = 'chat-inbox-cache-v2';

/** Server + optimistic thread snapshot owned by TanStack Query. */
export type ChatThreadQueryData = {
  thread: ChatThread | null;
  peer: ChatPeerProfile | null;
  messages: ChatMessage[];
  olderCursor: string | null;
  hasMore: boolean;
};

export function emptyThreadData(): ChatThreadQueryData {
  return {
    thread: null,
    peer: null,
    messages: [],
    olderCursor: null,
    hasMore: false,
  };
}

export function patchThreadData(
  prev: ChatThreadQueryData | undefined,
  patch: Partial<ChatThreadQueryData> & {
    mergeMessages?: ChatMessage[];
    replaceMessages?: ChatMessage[];
  }
): ChatThreadQueryData {
  const base = prev ?? emptyThreadData();
  let messages = base.messages;
  if (patch.replaceMessages) {
    messages = patch.replaceMessages;
  } else if (patch.mergeMessages?.length) {
    messages = mergeThreadMessages(base.messages, patch.mergeMessages);
  }
  return {
    thread: patch.thread !== undefined ? patch.thread : base.thread,
    peer: patch.peer !== undefined ? patch.peer : base.peer,
    messages,
    olderCursor: patch.olderCursor !== undefined ? patch.olderCursor : base.olderCursor,
    hasMore: patch.hasMore !== undefined ? patch.hasMore : base.hasMore,
  };
}

export function getThreadQueryData(threadId: string | null | undefined): ChatThreadQueryData | undefined {
  const id = String(threadId || '').trim();
  if (!id) return undefined;
  return queryClient.getQueryData<ChatThreadQueryData>(queryKeys.chat.thread(id));
}

export function setThreadQueryData(
  threadId: string,
  seed?: Partial<ChatThreadQueryData> & {
    mergeMessages?: ChatMessage[];
    replaceMessages?: ChatMessage[];
  }
): ChatThreadQueryData {
  const id = String(threadId || '').trim();
  const key = queryKeys.chat.thread(id);
  const prev = queryClient.getQueryData<ChatThreadQueryData>(key);
  const next = patchThreadData(prev, seed ?? {});
  queryClient.setQueryData(key, next);
  return next;
}

export function patchThreadQueryData(
  threadId: string,
  patch: Partial<ChatThreadQueryData> & {
    mergeMessages?: ChatMessage[];
    replaceMessages?: ChatMessage[];
  }
): ChatThreadQueryData {
  const id = String(threadId || '').trim();
  const key = queryKeys.chat.thread(id);
  let next = emptyThreadData();
  queryClient.setQueryData<ChatThreadQueryData>(key, (prev) => {
    next = patchThreadData(prev, patch);
    return next;
  });
  return next;
}

/** Move Query entry when a pending thread resolves to a real UUID. */
export function migrateChatThreadQuery(fromThreadId: string, toThreadId: string) {
  const from = String(fromThreadId || '').trim();
  const to = String(toThreadId || '').trim();
  if (!from || !to || from === to) return;
  const prev = queryClient.getQueryData<ChatThreadQueryData>(queryKeys.chat.thread(from));
  const target = queryClient.getQueryData<ChatThreadQueryData>(queryKeys.chat.thread(to));
  if (prev) {
    const mergedMessages = mergeThreadMessages(target?.messages || [], prev.messages);
    queryClient.setQueryData<ChatThreadQueryData>(queryKeys.chat.thread(to), {
      ...prev,
      ...target,
      thread: prev.thread
        ? { ...prev.thread, ...(target?.thread || {}), id: to }
        : target?.thread
          ? { ...target.thread, id: to }
          : null,
      peer: target?.peer || prev.peer,
      messages: mergedMessages.map((m) => ({ ...m, threadId: to })),
      olderCursor: target?.olderCursor ?? prev.olderCursor,
      hasMore: target?.hasMore ?? prev.hasMore,
    });
    queryClient.removeQueries({ queryKey: queryKeys.chat.thread(from) });
  }
}

export function findThreadQueryByPostAndPeer(
  postId: string,
  peerId: string
): ChatThreadQueryData | null {
  const post = String(postId || '').trim();
  const peer = String(peerId || '').trim();
  if (!post || !peer) return null;

  const entries = queryClient.getQueriesData<ChatThreadQueryData>({
    queryKey: ['chat', 'thread'],
  });

  let pendingHit: ChatThreadQueryData | null = null;
  for (const [, data] of entries) {
    const t = data?.thread;
    if (!t) continue;
    if (String(t.postId || '').trim() !== post) continue;
    const matchesPeer =
      String(t.sellerId || '').trim() === peer || String(t.buyerId || '').trim() === peer;
    if (!matchesPeer) continue;
    const id = String(t.id || '').trim();
    if (id && !isPendingThreadId(id)) return data ?? null;
    if (!pendingHit) pendingHit = data ?? null;
  }
  return pendingHit;
}

function inboxPeerFromItem(item: ChatInboxItem): ChatPeerProfile {
  return {
    id: item.peerId,
    displayName: item.peerName,
    storeName: item.peerName || null,
    avatarUrl: item.peerAvatar || null,
    presence: item.peerPresence,
    lastSeenAt: item.peerLastSeenAt,
  };
}

function threadFromInboxItem(item: ChatInboxItem): ChatThread {
  return {
    id: item.threadId,
    postId: item.postId,
    buyerId: '',
    sellerId: '',
    status: item.status,
    postSnapshot: item.postSnapshot || {},
    lastMessage: item.lastPreview,
    lastAt: item.lastAt,
  };
}

/** Seed thread Query from an inbox row before navigation (instant chrome). */
export function seedThreadFromInbox(room: ChatInboxItem): ChatThreadQueryData {
  const id = String(room.threadId || '').trim();
  if (!id) return emptyThreadData();
  const prev = getThreadQueryData(id);
  const inboxPeer = inboxPeerFromItem(room);
  const mergedPeer: ChatPeerProfile = prev?.peer
    ? {
        ...prev.peer,
        displayName: prev.peer.displayName || inboxPeer.displayName,
        storeName: prev.peer.storeName || inboxPeer.storeName,
        avatarUrl: prev.peer.avatarUrl || inboxPeer.avatarUrl,
        presence: prev.peer.presence || inboxPeer.presence,
        lastSeenAt: prev.peer.lastSeenAt || inboxPeer.lastSeenAt,
      }
    : inboxPeer;

  const baseThread = prev?.thread ?? threadFromInboxItem(room);
  const priorSnap = baseThread.postSnapshot || {};
  const inboxSnap = room.postSnapshot || {};
  const mergedThread: ChatThread = {
    ...baseThread,
    postId: baseThread.postId || room.postId,
    status: baseThread.status || room.status,
    postSnapshot: {
      ...inboxSnap,
      ...priorSnap,
      title: priorSnap.title || inboxSnap.title || 'Product',
      imageUrl: priorSnap.imageUrl || inboxSnap.imageUrl || null,
    },
    lastMessage: baseThread.lastMessage || room.lastPreview,
    lastAt: baseThread.lastAt || room.lastAt,
  };

  return setThreadQueryData(id, {
    thread: mergedThread,
    peer: mergedPeer,
    messages: prev?.messages ?? [],
  });
}

export function seedOptimisticThreadRoom(input: {
  threadId: string;
  postId: string;
  buyerId: string;
  sellerId: string;
  peerName?: string;
  peerAvatar?: string | null;
  postSnapshot?: ChatThread['postSnapshot'];
  messages?: ChatMessage[];
}) {
  const key = String(input.threadId || '').trim();
  if (!key) return emptyThreadData();
  const prev = getThreadQueryData(key);
  return setThreadQueryData(key, {
    thread: {
      id: key,
      postId: input.postId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      status: 'browsing',
      postSnapshot: input.postSnapshot || prev?.thread?.postSnapshot || {},
      lastMessage: input.messages?.[input.messages.length - 1]?.body || null,
      lastAt: new Date().toISOString(),
    },
    peer:
      prev?.peer ??
      ({
        id: input.sellerId,
        displayName: input.peerName || 'Seller',
        storeName: input.peerName || null,
        avatarUrl: input.peerAvatar || null,
      } as ChatPeerProfile),
    messages: input.messages?.length ? input.messages : prev?.messages ?? [],
  });
}

export function getInboxItems(userId: string | null | undefined): ChatInboxItem[] {
  const key = String(userId || '').trim();
  if (!key) return [];
  const data = queryClient.getQueryData<ChatInboxItem[]>(queryKeys.chat.inbox(key));
  return Array.isArray(data) ? data : [];
}

export function setInboxItems(userId: string, items: ChatInboxItem[]) {
  const key = String(userId || '').trim();
  if (!key) return;
  queryClient.setQueryData(queryKeys.chat.inbox(key), items);
}

export function patchInboxThread(
  userId: string,
  threadId: string,
  patch: Partial<ChatInboxItem>
) {
  const uid = String(userId || '').trim();
  const id = String(threadId || '').trim();
  if (!uid || !id) return;
  queryClient.setQueryData<ChatInboxItem[]>(queryKeys.chat.inbox(uid), (prev) => {
    if (!Array.isArray(prev)) return prev;
    let changed = false;
    const next = prev.map((item) => {
      if (item.threadId !== id) return item;
      changed = true;
      return { ...item, ...patch };
    });
    return changed ? next : prev;
  });
}

export function replaceInboxThreadId(
  userId: string,
  fromThreadId: string,
  toThreadId: string,
  patch?: Partial<ChatInboxItem>
) {
  const uid = String(userId || '').trim();
  const from = String(fromThreadId || '').trim();
  const to = String(toThreadId || '').trim();
  if (!uid || !from || !to) return;
  queryClient.setQueryData<ChatInboxItem[]>(queryKeys.chat.inbox(uid), (prev) => {
    if (!Array.isArray(prev)) return prev;
    const next = prev.map((item) => {
      if (item.threadId !== from) return item;
      return { ...item, ...patch, threadId: to };
    });
    const deduped = next.filter(
      (item, index, arr) => arr.findIndex((row) => row.threadId === item.threadId) === index
    );
    return deduped;
  });
}

export function upsertInboxItem(userId: string, item: ChatInboxItem) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  queryClient.setQueryData<ChatInboxItem[]>(queryKeys.chat.inbox(uid), (prev) => {
    const existing = Array.isArray(prev) ? prev : [];
    return [item, ...existing.filter((row) => row.threadId !== item.threadId)];
  });
  seedThreadFromInbox(item);
}

export function mergePendingInboxWithServer(
  userId: string,
  serverThreads: ChatInboxItem[]
): ChatInboxItem[] {
  const uid = String(userId || '').trim();
  if (!uid) return serverThreads;
  const local = getInboxItems(uid);
  const pendingLocal = local.filter(
    (item) =>
      isPendingThreadId(item.threadId) &&
      !serverThreads.some(
        (row) =>
          String(row.postId || '') === String(item.postId || '') &&
          String(row.peerId || '') === String(item.peerId || '')
      )
  );
  const merged = [...pendingLocal, ...serverThreads];
  for (const item of merged) {
    seedThreadFromInbox(item);
  }
  return merged;
}

/** One-time cleanup of retired parallel MMKV chat caches. */
export function clearLegacyChatCaches() {
  try {
    mmkvStorage.removeItem(LEGACY_THREAD_CACHE_KEY);
    mmkvStorage.removeItem(LEGACY_INBOX_CACHE_KEY);
  } catch {
    // ignore
  }
}
