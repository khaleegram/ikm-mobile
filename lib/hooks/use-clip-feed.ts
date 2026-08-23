import { useCallback, useMemo } from 'react';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { marketFeedApi } from '@/lib/api/market-feed';
import { normalizeMarketPostRecord } from '@/lib/market/normalize-market-post';
import { queryKeys } from '@/lib/query/keys';
import type { MarketPost } from '@/types';

export type ClipFeedSourceMode = 'forYou' | 'following' | 'public';

export type FeedPageParam = {
  cursor: string | null;
  sessionId: string | null;
};

export type FeedQueryPage = {
  items: MarketPost[];
  nextCursor: string | null;
  hasMore: boolean;
  sessionId: string | null;
};

export interface UseClipFeedOptions {
  mode: ClipFeedSourceMode;
  userId?: string | null;
  enabled?: boolean;
}

export interface UseClipFeedResult {
  items: MarketPost[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  sessionId: string | null;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  removeItem: (clipId: string) => void;
  patchItem: (clipId: string, patch: Partial<MarketPost>) => void;
  markSeen: (postIds: string[], dwellSec?: number) => void;
}

function normalizeItems(raw: MarketPost[]): MarketPost[] {
  return raw
    .map((post) => normalizeMarketPostRecord(String(post.id || ''), post as any))
    .filter((post) => Boolean(post.id));
}

async function fetchFeedPage(
  mode: ClipFeedSourceMode,
  pageParam: FeedPageParam
): Promise<FeedQueryPage> {
  const params = {
    limit: marketFeedApi.pageSize,
    cursor: pageParam.cursor,
    sessionId: pageParam.sessionId,
  };

  const result =
    mode === 'following'
      ? await marketFeedApi.getFollowingFeed(params)
      : mode === 'public'
        ? await marketFeedApi.getPublicFeed(params)
        : await marketFeedApi.getForYouFeed(params);

  return {
    items: normalizeItems(result.items),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    sessionId: result.sessionId,
  };
}

function flattenFeedPages(pages: FeedQueryPage[] | undefined): MarketPost[] {
  if (!pages?.length) return [];
  const seen = new Set<string>();
  const merged: MarketPost[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const id = String(item.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

function patchFeedInfiniteData(
  old: InfiniteData<FeedQueryPage, FeedPageParam> | undefined,
  updater: (items: MarketPost[]) => MarketPost[]
): InfiniteData<FeedQueryPage, FeedPageParam> | undefined {
  if (!old?.pages?.length) return old;
  const flat = flattenFeedPages(old.pages);
  const nextFlat = updater(flat);
  const byId = new Map(nextFlat.map((item) => [item.id, item]));
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      items: page.items
        .map((item) => byId.get(item.id) ?? item)
        .filter((item) => byId.has(item.id)),
    })),
  };
}

/**
 * Clip-style feed pagination on TanStack Query — session-pinned pages,
 * MMKV cold start, local remove/patch mutations.
 */
export function useClipFeed({
  mode,
  userId = null,
  enabled = true,
}: UseClipFeedOptions): UseClipFeedResult {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.feed.infinite(mode, userId);

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: { cursor: null, sessionId: null } satisfies FeedPageParam,
    staleTime: 45_000,
    queryFn: ({ pageParam }) => fetchFeedPage(mode, pageParam),
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || !lastPage.nextCursor) return undefined;
      return {
        cursor: lastPage.nextCursor,
        sessionId: lastPage.sessionId,
      };
    },
  });

  const items = useMemo(() => flattenFeedPages(query.data?.pages), [query.data?.pages]);

  const sessionId = useMemo(() => {
    const pages = query.data?.pages;
    if (!pages?.length) return null;
    return pages[pages.length - 1]?.sessionId ?? pages[0]?.sessionId ?? null;
  }, [query.data?.pages]);

  const loadMore = useCallback(async () => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    await query.fetchNextPage();
  }, [query]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const removeItem = useCallback(
    (clipId: string) => {
      const id = String(clipId || '').trim();
      if (!id) return;
      queryClient.setQueryData<InfiniteData<FeedQueryPage, FeedPageParam>>(queryKey, (old) =>
        patchFeedInfiniteData(old, (flat) => flat.filter((item) => item.id !== id))
      );
    },
    [queryClient, queryKey]
  );

  const patchItem = useCallback(
    (clipId: string, patch: Partial<MarketPost>) => {
      const id = String(clipId || '').trim();
      if (!id) return;
      queryClient.setQueryData<InfiniteData<FeedQueryPage, FeedPageParam>>(queryKey, (old) =>
        patchFeedInfiniteData(old, (flat) =>
          flat.map((item) => (item.id === id ? { ...item, ...patch, id: item.id } : item))
        )
      );
    },
    [queryClient, queryKey]
  );

  const markSeen = useCallback((postIds: string[], dwellSec?: number) => {
    if (!postIds.length) return;
    marketFeedApi.markSeen(postIds, dwellSec).catch(() => {});
  }, []);

  return {
    items,
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isRefetching && Boolean(query.data),
    loadingMore: query.isFetchingNextPage,
    error: query.error instanceof Error ? query.error : null,
    hasMore: Boolean(query.hasNextPage),
    sessionId,
    loadMore,
    refresh,
    removeItem,
    patchItem,
    markSeen,
  };
}
