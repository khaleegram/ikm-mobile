/**
 * Foundational deal-room open path:
 * - Sync-seed TanStack Query (`queryKeys.chat.thread`) from inbox before navigate
 * - Prefetch getThread + getMessages into that same Query key
 * - Prefer real UUIDs — resolve `pending:` before navigation whenever the network allows
 */
import { router } from 'expo-router';

import { chatApi } from '@/lib/api/chat';
import {
  findThreadQueryByPostAndPeer,
  getThreadQueryData,
  migrateChatThreadQuery,
  patchThreadData,
  replaceInboxThreadId,
  seedThreadFromInbox,
  setThreadQueryData,
  type ChatThreadQueryData,
} from '@/lib/chat/chat-query-cache';
import { isPendingThreadId, parsePendingThreadId } from '@/lib/chat/thread-id';
import { mergeThreadMessages } from '@/lib/chat/thread-messages';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import type { ChatInboxItem, ChatMessage, ChatPeerProfile, ChatThread } from '@/types/chat';

export type { ChatThreadQueryData } from '@/lib/chat/chat-query-cache';
export { migrateChatThreadQuery } from '@/lib/chat/chat-query-cache';

function emptyThreadData(): ChatThreadQueryData {
  return {
    thread: null,
    peer: null,
    messages: [],
    olderCursor: null,
    hasMore: false,
  };
}

/** Write a deal-room snapshot into TanStack Query (sync). */
export function seedDealRoomQuery(
  threadId: string,
  seed?: {
    thread?: ChatThread | null;
    peer?: ChatPeerProfile | null;
    messages?: ChatMessage[];
    olderCursor?: string | null;
    hasMore?: boolean;
  }
): ChatThreadQueryData {
  const id = String(threadId || '').trim();
  if (!id) return emptyThreadData();

  const prev = getThreadQueryData(id);
  const messages = mergeThreadMessages(prev?.messages || [], seed?.messages || []);
  return setThreadQueryData(id, {
    thread: seed?.thread !== undefined ? seed.thread : prev?.thread ?? null,
    peer: seed?.peer !== undefined ? seed.peer : prev?.peer ?? null,
    messages,
    olderCursor: seed?.olderCursor !== undefined ? seed.olderCursor : prev?.olderCursor ?? null,
    hasMore: seed?.hasMore !== undefined ? seed.hasMore : Boolean(prev?.hasMore),
  });
}

/** Seed Query from an inbox row before navigation (instant chrome). */
export function seedDealRoomFromInbox(room: ChatInboxItem): void {
  seedThreadFromInbox(room);
}

/**
 * Network prefetch into the same Query key the deal room reads.
 * Safe to fire-and-forget after a sync seed + navigate.
 */
export async function prefetchDealRoom(threadId: string): Promise<ChatThreadQueryData | null> {
  const id = String(threadId || '').trim();
  if (!id || isPendingThreadId(id)) return null;

  seedDealRoomQuery(id);

  try {
    const [meta, page] = await Promise.all([
      chatApi.getThread(id),
      chatApi.getMessages(id),
    ]);
    const key = queryKeys.chat.thread(id);
    const prev = queryClient.getQueryData<ChatThreadQueryData>(key);
    const messages = mergeThreadMessages(prev?.messages || [], page.messages);
    const next: ChatThreadQueryData = {
      thread: meta.thread,
      peer: meta.peer,
      messages,
      olderCursor: page.nextCursor,
      hasMore: Boolean(page.hasMore),
    };
    queryClient.setQueryData(key, next);
    return next;
  } catch {
    return queryClient.getQueryData<ChatThreadQueryData>(queryKeys.chat.thread(id)) ?? null;
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

  const local = findThreadQueryByPostAndPeer(pending.postId, pending.peerId);
  const localId = String(local?.thread?.id || '').trim();
  if (localId && !isPendingThreadId(localId)) {
    migrateChatThreadQuery(raw, localId);
    if (userId) {
      replaceInboxThreadId(userId, raw, localId);
    }
    return localId;
  }

  try {
    const { thread } = await chatApi.getOrCreateThread(pending.postId, pending.peerId);
    const realId = String(thread.id || '').trim();
    if (!realId || isPendingThreadId(realId)) return raw;
    migrateChatThreadQuery(raw, realId);
    setThreadQueryData(realId, { thread });
    if (userId) {
      replaceInboxThreadId(userId, raw, realId, {
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

  navigateToDealRoom(threadId, peerId);

  if (!isPendingThreadId(threadId)) {
    void prefetchDealRoom(threadId);
  }
}

// Re-export patch helper for consumers that merge thread snapshots.
export { patchThreadData };
