import { useQuery, useQueryClient } from '@tanstack/react-query';

import { marketPostsApi } from '@/lib/api/market-posts';
import { queryKeys } from '@/lib/query/keys';
import type { MarketPost } from '@/types';

export function useMarketPostQuery(postId: string | null | undefined) {
  const id = String(postId || '').trim() || null;
  return useQuery({
    queryKey: queryKeys.posts.byId(id),
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: async (): Promise<MarketPost | null> => {
      if (!id) return null;
      return marketPostsApi.getById(id);
    },
  });
}

export function useMarketPostsByIdsQuery(postIds: string[]) {
  const ids = [...new Set(postIds.map((id) => String(id || '').trim()).filter(Boolean))];
  return useQuery({
    queryKey: queryKeys.posts.batch(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<MarketPost[]> => {
      const out: MarketPost[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = await marketPostsApi.getBatch(ids.slice(i, i + 50));
        out.push(...chunk);
      }
      return out;
    },
  });
}

export function useUserMarketPosts(userId: string | null) {
  const id = String(userId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.posts.byPoster(id),
    enabled: Boolean(id),
    staleTime: 30_000,
    queryFn: async (): Promise<MarketPost[]> => {
      if (!id) return [];
      return marketPostsApi.listByPoster(id, 60);
    },
  });

  return {
    posts: query.data ?? [],
    // Only spin when we have never had data — cached posts render immediately
    loading: query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

/** Compatibility shape used across screens — backed by TanStack Query. */
export function useMarketPost(postId: string | null) {
  const query = useMarketPostQuery(postId);
  return {
    post: query.data ?? null,
    loading: query.isPending && !query.data,
    error:
      query.error instanceof Error
        ? query.error
        : query.error
          ? new Error(String(query.error))
          : null,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

export function useMarketPostsByIds(postIds: string[], _maxItems = 20) {
  const query = useMarketPostsByIdsQuery(postIds);
  return {
    posts: query.data ?? [],
    loading: query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
  };
}

// Moved from lib/firebase/firestore/market-posts.ts — this is a chatcart-api (Neon)
// resource, not Firestore. Now backed by Query instead of a bare useEffect fetch, so a
// network hiccup doesn't wipe a screen that already knows which posts are liked.
export function useUserLikedPostIds(userId: string | null) {
  const id = String(userId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.social.liked(id),
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { apiUrl } = await import('@/lib/api/api-base');
      const { coreCloudClient } = await import('@/lib/api/core-cloud-client');
      const response = await coreCloudClient.request<{ ids?: string[] }>(apiUrl('/social/liked'), {
        method: 'GET',
        requiresAuth: true,
      });
      return Array.isArray(response.ids) ? response.ids : [];
    },
  });

  const failed = query.isError && !query.data;
  const likedPostIds = failed ? [] : (query.data ?? []);
  return {
    likedPostIds,
    idSet: new Set(likedPostIds),
    loading: Boolean(id) && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load liked posts')
      : null,
    refetch: query.refetch,
  };
}

// Moved from lib/firebase/firestore/market-posts.ts — same reasoning as above.
export function useMarketPostsSearch(searchQuery: string | null) {
  const term = String(searchQuery || '').trim();
  const query = useQuery({
    queryKey: queryKeys.posts.search(term),
    enabled: term.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<MarketPost[]> => marketPostsApi.search(term, 50),
  });

  return {
    posts: query.data ?? [],
    loading: query.isFetching,
    error: query.error instanceof Error ? query.error : null,
  };
}

/** Posts using a given sound — Neon via `/posts?soundId=`, not Firestore. */
export function useMarketPostsBySound(soundId: string | null) {
  const id = String(soundId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.posts.bySound(id),
    enabled: Boolean(id),
    staleTime: 30_000,
    queryFn: async (): Promise<MarketPost[]> => {
      if (!id) return [];
      return marketPostsApi.listBySound(id, 40);
    },
  });

  const failed = query.isError && !query.data;
  return {
    posts: failed ? [] : (query.data ?? []),
    loading: Boolean(id) && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load posts for this sound')
      : null,
    refetch: query.refetch,
  };
}

export function useInvalidateMarketPost() {
  const queryClient = useQueryClient();
  return {
    setPost: (post: MarketPost) => {
      if (!post?.id) return;
      queryClient.setQueryData(queryKeys.posts.byId(post.id), post);
      if (post.posterId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.posts.byPoster(post.posterId),
        });
      }
    },
    invalidatePost: (postId: string, posterId?: string | null) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.byId(postId) });
      void queryClient.invalidateQueries({ queryKey: ['market-posts-batch'] });
      if (posterId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.posts.byPoster(posterId),
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['market-posts-by-poster'] });
      }
    },
  };
}
