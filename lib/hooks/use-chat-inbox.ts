import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { chatApi } from '@/lib/api/chat';
import { marketPostsApi } from '@/lib/api/market-posts';
import { enrichInboxRoomsWithPosts } from '@/lib/chat/enrich-inbox-snapshots';
import { queryKeys } from '@/lib/query/keys';
import { chatThreadCache, isPendingThreadId } from '@/lib/stores/chat-thread-cache';
import { useChatInboxCache } from '@/lib/stores/chat-inbox-cache';
import type { ChatInboxItem } from '@/types/chat';
import type { MarketPost } from '@/types';

const EMPTY_INBOX: ChatInboxItem[] = [];

/** Background poll only as a WS/reconnect safety net — not the primary delivery path. */
const INBOX_POLL_MS = 60_000;
const FOCUS_STALE_MS = 25_000;

type UseChatInboxResult = {
  items: ChatInboxItem[];
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  usingPostgres: boolean;
};

async function attachLivePostTitles(threads: ChatInboxItem[]): Promise<ChatInboxItem[]> {
  const postIds = [
    ...new Set(threads.map((item) => String(item.postId || '').trim()).filter(Boolean)),
  ];
  if (!postIds.length) return threads;

  const postsById: Record<string, MarketPost | undefined> = {};
  for (let i = 0; i < postIds.length; i += 50) {
    const chunk = postIds.slice(i, i + 50);
    try {
      const posts = await marketPostsApi.getBatch(chunk);
      for (const post of posts) {
        if (post?.id) postsById[post.id] = post;
      }
    } catch {
      // Keep snapshot titles if batch fails
    }
  }
  return enrichInboxRoomsWithPosts(threads, postsById);
}

async function fetchInboxForUser(userId: string): Promise<ChatInboxItem[]> {
  const threads = await chatApi.getInbox();
  const local = useChatInboxCache.getState().getItems(userId);
  const pendingLocal = local.filter(
    (item) =>
      isPendingThreadId(item.threadId) &&
      !threads.some(
        (row) =>
          String(row.postId || '') === String(item.postId || '') &&
          String(row.peerId || '') === String(item.peerId || '')
      )
  );
  const merged = [...pendingLocal, ...threads];
  for (const item of merged) {
    chatThreadCache.seedFromInbox(item, { notify: false });
  }

  const enriched = await attachLivePostTitles(merged);
  useChatInboxCache.getState().setItems(userId, enriched);
  for (const item of enriched) {
    chatThreadCache.seedFromInbox(item, { notify: false });
  }
  return enriched;
}

/**
 * Inbox backed by TanStack Query (`queryKeys.chat.inbox`) with MMKV seed so cold opens
 * paint instantly. Zustand inbox cache still mirrors writes for pending/optimistic rooms.
 */
export function useChatInbox(userId: string | null): UseChatInboxResult {
  const hydrate = useChatInboxCache((s) => s.hydrate);
  const hydrated = useChatInboxCache((s) => s.hydrated);
  const cachedItems = useChatInboxCache((s) => {
    if (!userId) return EMPTY_INBOX;
    return s.byUserId[userId] ?? EMPTY_INBOX;
  });
  const queryClient = useQueryClient();
  const [lastFocusRefresh, setLastFocusRefresh] = useState(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const query = useQuery({
    queryKey: queryKeys.chat.inbox(userId),
    enabled: Boolean(userId) && hydrated,
    staleTime: 20_000,
    placeholderData: () => (cachedItems.length > 0 ? cachedItems : undefined),
    queryFn: async (): Promise<ChatInboxItem[]> => {
      if (!userId) return [];
      return fetchInboxForUser(userId);
    },
  });

  // Seed Query from MMKV on first hydrate so revisiting never flashes empty.
  useEffect(() => {
    if (!userId || !hydrated || cachedItems.length === 0) return;
    const existing = queryClient.getQueryData(queryKeys.chat.inbox(userId));
    if (!existing) {
      queryClient.setQueryData(queryKeys.chat.inbox(userId), cachedItems);
    }
  }, [userId, hydrated, cachedItems, queryClient]);

  useEffect(() => {
    if (!userId || !hydrated) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat.inbox(userId) });
      }
    }, INBOX_POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat.inbox(userId) });
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [userId, hydrated, queryClient]);

  const items = query.data ?? cachedItems;
  const showInitialLoader = Boolean(userId) && query.isPending && items.length === 0;

  const refresh = useCallback(async () => {
    if (!userId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.chat.inbox(userId) });
    await query.refetch();
  }, [userId, queryClient, query]);

  const refreshIfStale = useCallback(async () => {
    if (!userId) return;
    if (Date.now() - lastFocusRefresh < FOCUS_STALE_MS) return;
    setLastFocusRefresh(Date.now());
    await queryClient.invalidateQueries({ queryKey: queryKeys.chat.inbox(userId) });
  }, [userId, lastFocusRefresh, queryClient]);

  return {
    items,
    loading: showInitialLoader,
    refreshing: query.isFetching && items.length > 0,
    error: query.error instanceof Error ? query.error : null,
    refresh,
    refreshIfStale,
    usingPostgres: true,
  };
}
