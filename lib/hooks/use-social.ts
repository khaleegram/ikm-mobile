// Follow / block / save graph — a chatcart-api (Neon) resource, not Firestore.
//
// Previously every call site (feed cards, seller profile, saved screen, inbox) fetched its
// own independent copy of the full following/saved/blocked list with a bare useEffect, with
// no shared cache and no invalidation between them — so following a seller on their profile
// would not update the "Following" badge on their post card in the feed until that card
// happened to remount, and every screen re-fetched the full list from scratch on every mount.
// This is now backed by Query so all of that is one shared, invalidatable cache per user.

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import type { MarketPost } from '@/types';

export type SavedCollection = {
  ids: string[];
  posts: MarketPost[];
};

function normalizeSavedCache(data: unknown): SavedCollection {
  if (Array.isArray(data)) {
    return { ids: data, posts: [] };
  }
  if (data && typeof data === 'object') {
    const record = data as Partial<SavedCollection>;
    return {
      ids: Array.isArray(record.ids) ? record.ids : [],
      posts: Array.isArray(record.posts) ? record.posts : [],
    };
  }
  return { ids: [], posts: [] };
}

async function fetchFollowingIds(): Promise<string[]> {
  const { marketSocialApi } = await import('@/lib/api/market-social');
  return marketSocialApi.listFollowingIds();
}

async function fetchSavedCollection(): Promise<SavedCollection> {
  const { marketSocialApi } = await import('@/lib/api/market-social');
  const saved = await marketSocialApi.listSaved();
  return {
    ids: Array.isArray(saved.ids) ? saved.ids : [],
    posts: Array.isArray(saved.posts) ? (saved.posts as MarketPost[]) : [],
  };
}

async function fetchBlockedIds(): Promise<string[]> {
  const { marketSocialApi } = await import('@/lib/api/market-social');
  return marketSocialApi.listBlockedIds();
}

export type SocialIdsResult = {
  ids: string[];
  idSet: Set<string>;
  loading: boolean;
  /** Set when the fetch failed and there is no cached data — never treat as "empty list". */
  error: Error | null;
  refetch: () => Promise<unknown>;
};

function useSocialIdsQuery(
  enabled: boolean,
  query: UseQueryResult<string[], Error>
): SocialIdsResult {
  // Never present a failed fetch as an empty list — callers must show retry UI.
  const failed = query.isError && !query.data;
  const ids = failed ? [] : (query.data ?? []);
  const idSet = useMemo(() => new Set(ids), [ids]);
  return {
    ids,
    idSet,
    loading: enabled && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load')
      : null,
    refetch: query.refetch,
  };
}

export function useFollowingUserIds(userId: string | null): SocialIdsResult {
  const id = String(userId || '').trim() || null;
  const enabled = Boolean(id);
  const query = useQuery({
    queryKey: queryKeys.social.following(id),
    enabled,
    staleTime: 30_000,
    queryFn: fetchFollowingIds,
  });
  return useSocialIdsQuery(enabled, query);
}

export function useBlockedUserIds(userId: string | null): SocialIdsResult {
  const id = String(userId || '').trim() || null;
  const enabled = Boolean(id);
  const query = useQuery({
    queryKey: queryKeys.social.blocked(id),
    enabled,
    staleTime: 30_000,
    queryFn: fetchBlockedIds,
  });
  return useSocialIdsQuery(enabled, query);
}

/** Derives from the same shared following-list cache as `useFollowingUserIds` — no extra fetch. */
export function useIsFollowing(followerId: string | null, followedId: string | null) {
  const follower = String(followerId || '').trim() || null;
  const followed = String(followedId || '').trim() || null;
  const enabled = Boolean(follower) && Boolean(followed);

  const query = useQuery({
    queryKey: queryKeys.social.following(follower),
    enabled,
    staleTime: 30_000,
    queryFn: fetchFollowingIds,
  });

  const failed = query.isError && !query.data;
  const isFollowing = enabled && !failed ? (query.data ?? []).includes(followed as string) : false;
  return {
    isFollowing,
    loading: enabled && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load')
      : null,
    refetch: query.refetch,
  };
}

/** Optimistically updates the shared following-list cache; rolls back on failure. */
export async function toggleFollow(
  followerId: string,
  followedId: string,
  isCurrentlyFollowing: boolean
) {
  const key = queryKeys.social.following(followerId);
  const previous = queryClient.getQueryData<string[]>(key) ?? [];
  const next = isCurrentlyFollowing
    ? previous.filter((id) => id !== followedId)
    : [...new Set([...previous, followedId])];
  queryClient.setQueryData(key, next);

  try {
    const { marketSocialApi } = await import('@/lib/api/market-social');
    if (isCurrentlyFollowing) {
      await marketSocialApi.unfollowUser(followedId);
    } else {
      await marketSocialApi.followUser(followedId);
    }
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: queryKeys.social.followersOf(followedId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.social.followingOf(followerId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.user.byId(followedId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.user.byId(followerId) });
  } catch (err) {
    queryClient.setQueryData(key, previous);
    throw err;
  }
}

export function useUserSavedPostIds(userId: string | null): SocialIdsResult {
  const id = String(userId || '').trim() || null;
  const enabled = Boolean(id);
  const query = useQuery({
    queryKey: queryKeys.social.saved(id),
    enabled,
    staleTime: 30_000,
    queryFn: fetchSavedCollection,
  });
  const failed = query.isError && !query.data;
  const collection = failed ? { ids: [], posts: [] } : normalizeSavedCache(query.data);
  const ids = collection.ids;
  const idSet = useMemo(() => new Set(ids), [ids]);
  return {
    ids,
    idSet,
    loading: enabled && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load')
      : null,
    refetch: query.refetch,
  };
}

/** Saved posts in API order — one round trip via `/social/saved`. */
export function useSavedMarketPosts(userId: string | null) {
  const id = String(userId || '').trim() || null;
  const enabled = Boolean(id);
  const query = useQuery({
    queryKey: queryKeys.social.saved(id),
    enabled,
    staleTime: 30_000,
    queryFn: fetchSavedCollection,
  });
  const failed = query.isError && !query.data;
  const collection = failed ? { ids: [], posts: [] } : normalizeSavedCache(query.data);
  const posts = useMemo(() => {
    if (!collection.ids.length) return [];
    const byId = new Map(collection.posts.map((post) => [String(post.id), post]));
    return collection.ids.map((postId) => byId.get(postId)).filter(Boolean) as MarketPost[];
  }, [collection.ids, collection.posts]);

  return {
    ids: collection.ids,
    posts,
    loading: enabled && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load saved posts')
      : null,
    refetch: query.refetch,
  };
}

/** Derives from the same shared saved-list cache as `useUserSavedPostIds` — no extra fetch. */
export function useIsSaved(userId: string | null, postId: string | null) {
  const user = String(userId || '').trim() || null;
  const post = String(postId || '').trim() || null;
  const enabled = Boolean(user) && Boolean(post);

  const query = useQuery({
    queryKey: queryKeys.social.saved(user),
    enabled,
    staleTime: 30_000,
    queryFn: fetchSavedCollection,
  });

  const failed = query.isError && !query.data;
  const ids = failed ? [] : normalizeSavedCache(query.data).ids;
  const isSaved = enabled && !failed ? ids.includes(post as string) : false;
  return {
    isSaved,
    loading: enabled && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load')
      : null,
    refetch: query.refetch,
  };
}

/** Optimistically updates the shared saved-list cache; rolls back on failure. */
export async function toggleMarketSave(userId: string, postId: string) {
  const key = queryKeys.social.saved(userId);
  const previous = normalizeSavedCache(queryClient.getQueryData(key));
  const currentlySaved = previous.ids.includes(postId);
  const nextIds = currentlySaved
    ? previous.ids.filter((id) => id !== postId)
    : [...new Set([...previous.ids, postId])];
  const nextPosts = currentlySaved
    ? previous.posts.filter((post) => String(post.id) !== postId)
    : previous.posts;
  queryClient.setQueryData(key, { ids: nextIds, posts: nextPosts });

  try {
    const { marketSocialApi } = await import('@/lib/api/market-social');
    if (currentlySaved) {
      await marketSocialApi.unsavePost(postId);
    } else {
      await marketSocialApi.savePost(postId);
    }
    void queryClient.invalidateQueries({ queryKey: key });
  } catch (err) {
    queryClient.setQueryData(key, previous);
    throw err;
  }
}

/** Optimistically updates the shared blocked-list cache; rolls back on failure. */
export async function toggleBlock(userId: string, targetUserId: string, isCurrentlyBlocked: boolean) {
  const key = queryKeys.social.blocked(userId);
  const previous = queryClient.getQueryData<string[]>(key) ?? [];
  const next = isCurrentlyBlocked
    ? previous.filter((id) => id !== targetUserId)
    : [...new Set([...previous, targetUserId])];
  queryClient.setQueryData(key, next);

  try {
    const { marketSocialApi } = await import('@/lib/api/market-social');
    if (isCurrentlyBlocked) {
      await marketSocialApi.unblockUser(targetUserId);
    } else {
      await marketSocialApi.blockUser(targetUserId);
    }
    void queryClient.invalidateQueries({ queryKey: key });
  } catch (err) {
    queryClient.setQueryData(key, previous);
    throw err;
  }
}
