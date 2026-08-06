// Post comments — Neon via chatcart-api, TanStack Query (infinite + live poll).

import { useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

import { marketCommentsApi } from '@/lib/api/market-comments';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { MarketComment } from '@/types';

const PAGE_SIZE = 30;
/** While a comments sheet is open, pick up peers' new comments without closing. */
const LIVE_REFETCH_MS = 8_000;

function commentCursor(comment: MarketComment | undefined): string | null {
  if (!comment?.createdAt) return null;
  const d = comment.createdAt instanceof Date ? comment.createdAt : new Date(comment.createdAt as any);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function useMarketPostComments(postId: string | null) {
  const id = String(postId || '').trim() || null;
  const query = useInfiniteQuery({
    queryKey: queryKeys.posts.comments(id),
    enabled: Boolean(id),
    initialPageParam: null as string | null,
    staleTime: 15_000,
    refetchInterval: LIVE_REFETCH_MS,
    queryFn: async ({ pageParam }): Promise<MarketComment[]> => {
      if (!id) return [];
      return marketCommentsApi.list(id, { limit: PAGE_SIZE, before: pageParam });
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.length || lastPage.length < PAGE_SIZE) return undefined;
      return commentCursor(lastPage[lastPage.length - 1]) || undefined;
    },
  });

  const comments = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const seen = new Set<string>();
    const merged: MarketComment[] = [];
    for (const page of pages) {
      for (const c of page) {
        const cid = String(c.id || '');
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        merged.push(c);
      }
    }
    return merged;
  }, [query.data?.pages]);

  return {
    comments,
    loading: Boolean(id) && query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMore: async () => {
      if (!query.hasNextPage || query.isFetchingNextPage) return;
      await query.fetchNextPage();
    },
    refetch: query.refetch,
  };
}

/** Optimistic insert at the top of page 0; rolls back on failure. */
export async function createMarketCommentOptimistic(postId: string, text: string) {
  const id = String(postId || '').trim();
  if (!id) throw new Error('Post not found');
  const key = queryKeys.posts.comments(id);
  const previous = queryClient.getQueryData(key);

  const tempId = `temp_${Date.now()}`;
  const optimistic: MarketComment = {
    id: tempId,
    postId: id,
    userId: 'me',
    comment: text.trim(),
    createdAt: new Date(),
  } as MarketComment;

  queryClient.setQueryData(key, (old: any) => {
    if (!old?.pages?.length) {
      return { pages: [[optimistic]], pageParams: [null] };
    }
    const pages = [...old.pages];
    pages[0] = [optimistic, ...(pages[0] || [])];
    return { ...old, pages };
  });

  try {
    const created = await marketCommentsApi.create(id, text);
    queryClient.setQueryData(key, (old: any) => {
      if (!old?.pages?.length) {
        return { pages: [[created]], pageParams: [null] };
      }
      const pages = old.pages.map((page: MarketComment[], idx: number) =>
        idx === 0
          ? [created, ...page.filter((c) => c.id !== tempId && c.id !== created.id)]
          : page.filter((c) => c.id !== created.id)
      );
      return { ...old, pages };
    });
    return created;
  } catch (err) {
    if (previous !== undefined) queryClient.setQueryData(key, previous);
    else void queryClient.invalidateQueries({ queryKey: key });
    throw err;
  }
}

export async function deleteMarketCommentOptimistic(postId: string, commentId: string) {
  const id = String(postId || '').trim();
  const cid = String(commentId || '').trim();
  if (!id || !cid) return;
  const key = queryKeys.posts.comments(id);
  const previous = queryClient.getQueryData(key);

  queryClient.setQueryData(key, (old: any) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page: MarketComment[]) => page.filter((c) => c.id !== cid)),
    };
  });

  try {
    await marketCommentsApi.delete(cid);
  } catch (err) {
    if (previous !== undefined) queryClient.setQueryData(key, previous);
    throw err;
  }
}

export function useInvalidateMarketComments() {
  const client = useQueryClient();
  return (postId: string | null | undefined) => {
    const id = String(postId || '').trim();
    if (!id) return;
    void client.invalidateQueries({ queryKey: queryKeys.posts.comments(id) });
  };
}
