/**
 * Single Query-backed identity cache for avatars / display names / public profile cards.
 *
 * Before this module, inbox used N Firestore onSnapshot listeners per peer, feed overlays
 * used a separate in-memory Map (`usePublicUserProfileOnce`), and deal-room headers used
 * yet another Firestore listener — so the same seller could show three different avatars
 * across three screens until each listener happened to catch up.
 *
 * Every public-facing avatar/name read goes through `queryKeys.user.byId` / `.batch`.
 * Profile writes invalidate those keys so every screen updates together.
 */

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { usersApi, type ApiUserProfile } from '@/lib/api/users-api';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import type { PublicUser } from '@/types';

export function avatarUriFromProfile(
  profile: Pick<ApiUserProfile, 'storeLogoUrl' | 'avatarUrl' | 'photoURL'> | null | undefined
): string | undefined {
  if (!profile) return undefined;
  const uri =
    String(profile.storeLogoUrl || '').trim() ||
    String(profile.avatarUrl || '').trim() ||
    String(profile.photoURL || '').trim();
  return uri || undefined;
}

export function displayNameFromProfile(
  profile: Pick<ApiUserProfile, 'storeName' | 'displayName'> | null | undefined,
  fallback = 'Store'
): string {
  if (!profile) return fallback;
  const store = String(profile.storeName || '').trim();
  if (store) return store;
  const display = String(profile.displayName || '').trim();
  if (display && !display.includes('@')) return display;
  return fallback;
}

export function apiUserToPublicUser(profile: ApiUserProfile): PublicUser {
  const loc = profile.marketLocation;
  return {
    id: profile.id,
    displayName: displayNameFromProfile(profile, 'User'),
    storeName: profile.storeName || undefined,
    storeLogoUrl: avatarUriFromProfile(profile),
    storeLocation: loc
      ? {
          state: String(loc.state || '').trim() || '',
          lga: String(loc.lga || '').trim() || '',
          city: String(loc.city || '').trim() || '',
        }
      : undefined,
    bio: String(profile.bio || '').trim() || undefined,
    followerCount: profile.followerCount ?? 0,
    followingCount: profile.followingCount ?? 0,
  };
}

function seedIndividualUserCaches(users: ApiUserProfile[]) {
  for (const user of users) {
    if (!user?.id) continue;
    queryClient.setQueryData(queryKeys.user.byId(user.id), user);
  }
}

export function useUserIdentity(userId: string | null | undefined) {
  const id = String(userId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.user.byId(id),
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: async (): Promise<ApiUserProfile | null> => {
      if (!id) return null;
      return usersApi.getById(id);
    },
  });

  return {
    user: query.data ?? null,
    publicUser: query.data ? apiUserToPublicUser(query.data) : null,
    loading: Boolean(id) && query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

function peerIdsContentKey(peerIds: (string | null | undefined)[]): string {
  const set = new Set<string>();
  for (const id of peerIds) {
    const s = String(id || '').trim();
    if (s) set.add(s);
  }
  return [...set].sort().join(',');
}

export function useUsersBatch(userIds: (string | null | undefined)[]) {
  // Content key is a string — stable across renders even when the caller passes a fresh array.
  const idsKey = peerIdsContentKey(userIds);
  const ids = useMemo(
    () => (idsKey ? idsKey.split(',').filter(Boolean) : []),
    [idsKey]
  );

  const query = useQuery({
    queryKey: queryKeys.user.batch(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<ApiUserProfile[]> => {
      const users = await usersApi.getBatch(ids);
      seedIndividualUserCaches(users);
      return users;
    },
  });

  const byId = useMemo(() => {
    const map: Record<string, ApiUserProfile> = {};
    for (const user of query.data ?? []) {
      if (user?.id) map[user.id] = user;
    }
    return map;
  }, [query.data]);

  return {
    users: query.data ?? [],
    byId,
    loading: ids.length > 0 && query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
  };
}

/** Compatibility shape for screens that previously used usePublicUserProfile. */
export function usePublicUserProfile(userId: string | null) {
  const { publicUser, loading, error } = useUserIdentity(userId);
  return { user: publicUser, loading, error };
}

/** Same Query cache as usePublicUserProfile — the old "Once" name is kept for call-site compat. */
export function usePublicUserProfileOnce(userId: string | null) {
  return usePublicUserProfile(userId);
}

/** Call after any write that changes a user's avatar/name so every screen updates together. */
export function invalidateUserIdentity(userId: string | null | undefined) {
  const id = String(userId || '').trim();
  if (!id) return;
  void queryClient.invalidateQueries({ queryKey: queryKeys.user.byId(id) });
  void queryClient.invalidateQueries({ queryKey: ['users', 'batch'] });
}

export function setUserIdentityCache(user: ApiUserProfile) {
  if (!user?.id) return;
  queryClient.setQueryData(queryKeys.user.byId(user.id), user);
  void queryClient.invalidateQueries({ queryKey: ['users', 'batch'] });
}

export function useInvalidateUserIdentity() {
  const client = useQueryClient();
  return {
    invalidate: (userId: string) => {
      void client.invalidateQueries({ queryKey: queryKeys.user.byId(userId) });
      void client.invalidateQueries({ queryKey: ['users', 'batch'] });
    },
    setUser: (user: ApiUserProfile) => {
      if (!user?.id) return;
      client.setQueryData(queryKeys.user.byId(user.id), user);
      void client.invalidateQueries({ queryKey: ['users', 'batch'] });
    },
  };
}
