import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { chatApi } from '@/lib/api/chat';
import { marketPostsApi } from '@/lib/api/market-posts';
import {
  mergePendingInboxWithServer,
  setInboxItems,
} from '@/lib/chat/chat-query-cache';
import { enrichInboxRoomsWithPosts } from '@/lib/chat/enrich-inbox-snapshots';
import { queryKeys } from '@/lib/query/keys';
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
  const merged = mergePendingInboxWithServer(userId, threads);
  const enriched = await attachLivePostTitles(merged);
  setInboxItems(userId, enriched);
  return enriched;
}

/**
 * Inbox backed by TanStack Query (`queryKeys.chat.inbox`) — single source of truth.
 */
export function useChatInbox(userId: string | null): UseChatInboxResult {
  const queryClient = useQueryClient();
  const [lastFocusRefresh, setLastFocusRefresh] = useState(0);

  const query = useQuery({
    queryKey: queryKeys.chat.inbox(userId),
    enabled: Boolean(userId),
    staleTime: 20_000,
    queryFn: async (): Promise<ChatInboxItem[]> => {
      if (!userId) return [];
      return fetchInboxForUser(userId);
    },
  });

  useEffect(() => {
    if (!userId) return;
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
  }, [userId, queryClient]);

  const items = query.data ?? EMPTY_INBOX;
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
