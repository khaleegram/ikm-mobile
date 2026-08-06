/**
 * Foundational deal-room open path:
 * - Sync-seed TanStack Query (`queryKeys.chat.thread`) from inbox/MMKV before navigate
 * - Prefetch getThread + getMessages into that same Query key (not MMKV-only)
 * - Prefer real UUIDs — resolve `pending:` before navigation whenever the network allows
 */
import { router } from 'expo-router';

import { chatApi } from '@/lib/api/chat';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import {
  chatThreadCache,
  isPendingThreadId,
  mergeThreadMessages,
  parsePendingThreadId,
} from '@/lib/stores/chat-thread-cache';
import { useChatInboxCache } from '@/lib/stores/chat-inbox-cache';
import type { ChatInboxItem, ChatMessage, ChatPeerProfile, ChatThread } from '@/types/chat';

/** Mirrors `ChatThreadQueryData` in use-chat-thread (kept local to avoid import cycles). */
type DealRoomQueryData = {
  thread: ChatThread | null;
  peer: ChatPeerProfile | null;
  messages: ChatMessage[];
  olderCursor: string | null;
  hasMore: boolean;
};

function emptyThreadData(): DealRoomQueryData {
  return {
    thread: null,
    peer: null,
    messages: [],
    olderCursor: null,
    hasMore: false,
  };
}

export function migrateDealRoomQuery(fromThreadId: string, toThreadId: string) {
  const from = String(fromThreadId || '').trim();
  const to = String(toThreadId || '').trim();
  if (!from || !to || from === to) return;
  const prev = queryClient.getQueryData<DealRoomQueryData>(queryKeys.chat.thread(from));
  if (prev) {
    queryClient.setQueryData<DealRoomQueryData>(queryKeys.chat.thread(to), {
      ...prev,
      thread: prev.thread ? { ...prev.thread, id: to } : prev.thread,
      messages: prev.messages.map((m) => ({ ...m, threadId: to })),
    });
  }
  queryClient.removeQueries({ queryKey: queryKeys.chat.thread(from) });
}

/** Write a deal-room snapshot into TanStack Query + MMKV (sync). */
export function seedDealRoomQuery(
  threadId: string,
  seed?: {
    thread?: ChatThread | null;
    peer?: ChatPeerProfile | null;
    messages?: ChatMessage[];
    olderCursor?: string | null;
    hasMore?: boolean;
  }
): DealRoomQueryData {
  const id = String(threadId || '').trim();
  if (!id) return emptyThreadData();

  const key = queryKeys.chat.thread(id);
  const prev = queryClient.getQueryData<DealRoomQueryData>(key);
  const mmkv = chatThreadCache.get(id);
  const messages = mergeThreadMessages(
    mergeThreadMessages(mmkv?.messages || [], prev?.messages || []),
    seed?.messages || []
  );
  const next: DealRoomQueryData = {
    thread: seed?.thread !== undefined ? seed.thread : prev?.thread ?? mmkv?.thread ?? null,
    peer: seed?.peer !== undefined ? seed.peer : prev?.peer ?? mmkv?.peer ?? null,
    messages,
    olderCursor:
      seed?.olderCursor !== undefined ? seed.olderCursor : prev?.olderCursor ?? null,
    hasMore: seed?.hasMore !== undefined ? seed.hasMore : Boolean(prev?.hasMore),
  };

  queryClient.setQueryData(key, next);
  chatThreadCache.set(
    id,
    { thread: next.thread, peer: next.peer, messages: next.messages },
    { notify: false }
  );
  return next;
}

/** Seed Query from an inbox row before navigation (instant chrome). */
export function seedDealRoomFromInbox(room: ChatInboxItem): void {
  const id = String(room.threadId || '').trim();
  if (!id) return;
  chatThreadCache.seedFromInbox(room, { notify: false });
  const cached = chatThreadCache.get(id);
  seedDealRoomQuery(id, {
    thread: cached?.thread || {
      id,
      postId: room.postId,
      buyerId: '',
      sellerId: '',
      status: room.status,
      postSnapshot: room.postSnapshot || {},
      lastMessage: room.lastPreview,
      lastAt: room.lastAt,
    },
    peer: cached?.peer || {
      id: room.peerId,
      displayName: room.peerName,
      storeName: room.peerName || null,
      avatarUrl: room.peerAvatar || null,
      presence: room.peerPresence,
      lastSeenAt: room.peerLastSeenAt,
    },
    messages: cached?.messages || [],
  });
}

/**
 * Network prefetch into the same Query key the deal room reads.
 * Safe to fire-and-forget after a sync seed + navigate.
 */
export async function prefetchDealRoom(threadId: string): Promise<DealRoomQueryData | null> {
  const id = String(threadId || '').trim();
  if (!id || isPendingThreadId(id)) return null;

  seedDealRoomQuery(id);

  try {
    const [meta, page] = await Promise.all([
      chatApi.getThread(id),
      chatApi.getMessages(id),
    ]);
    const key = queryKeys.chat.thread(id);
    const prev = queryClient.getQueryData<DealRoomQueryData>(key);
    const mmkv = chatThreadCache.get(id);
    const messages = mergeThreadMessages(
      mergeThreadMessages(mmkv?.messages || [], prev?.messages || []),
      page.messages
    );
    const next: DealRoomQueryData = {
      thread: meta.thread,
      peer: meta.peer,
      messages,
      olderCursor: page.nextCursor,
      hasMore: Boolean(page.hasMore),
    };
    queryClient.setQueryData(key, next);
    chatThreadCache.set(
      id,
      { thread: next.thread, peer: next.peer, messages: next.messages },
      { notify: true }
    );
    return next;
  } catch {
    return queryClient.getQueryData<DealRoomQueryData>(queryKeys.chat.thread(id)) ?? null;
  }
}

/** Resolve a pending inbox/local id to a real UUID when possible. */
export async function resolvePendingThreadId(
  threadId: string,
  userId?: string | null
): Promise<string> {
  const raw = String(threadId || '').trim();
  if (!raw || !isPendingThreadId(raw)) return raw;

  const pending = parsePendingThreadId(raw);
  if (!pending) return raw;

  const local = chatThreadCache.findByPostAndPeer(pending.postId, pending.peerId);
  const localId = String(local?.thread?.id || '').trim();
  if (localId && !isPendingThreadId(localId)) {
    chatThreadCache.migrate(raw, localId);
    migrateDealRoomQuery(raw, localId);
    if (userId) {
      useChatInboxCache.getState().replaceThreadId(userId, raw, localId);
    }
    return localId;
  }

  try {
    const { thread } = await chatApi.getOrCreateThread(pending.postId, pending.peerId);
    const realId = String(thread.id || '').trim();
    if (!realId || isPendingThreadId(realId)) return raw;
    chatThreadCache.migrate(raw, realId);
    migrateDealRoomQuery(raw, realId);
    chatThreadCache.set(realId, { thread }, { notify: false });
    if (userId) {
      useChatInboxCache.getState().replaceThreadId(userId, raw, realId, {
        postId: thread.postId,
        status: thread.status,
        postSnapshot: thread.postSnapshot,
      });
    }
    return realId;
  } catch {
    return raw;
  }
}

/** Navigate only with a thread id (warns if still pending). */
export function navigateToDealRoom(threadId: string, peerId?: string | null): void {
  const id = String(threadId || '').trim();
  if (!id) return;
  const peer = String(peerId || '').trim();
  const qs = peer ? `?peerId=${encodeURIComponent(peer)}` : '';
  router.push(`/(market)/messages/${encodeURIComponent(id)}${qs}` as any);
}

/**
 * Canonical inbox → deal open:
 * 1) resolve pending → real UUID when possible
 * 2) sync-seed Query
 * 3) navigate
 * 4) prefetch into Query (background)
 */
export async function openDealRoom(room: ChatInboxItem, userId?: string | null): Promise<void> {
  const peerId = String(room.peerId || '').trim();
  let threadId = String(room.threadId || '').trim();
  if (!threadId) return;

  if (isPendingThreadId(threadId)) {
    threadId = await resolvePendingThreadId(threadId, userId);
  }

  const roomForSeed: ChatInboxItem = { ...room, threadId };
  seedDealRoomFromInbox(roomForSeed);

  // Prefer not to land on pending — only navigate pending if resolve failed.
  navigateToDealRoom(threadId, peerId);

  if (!isPendingThreadId(threadId)) {
    void prefetchDealRoom(threadId);
  }
}
