import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { marketSoundsApi } from '@/lib/api/market-sounds';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import type { MarketSound } from '@/types';

export function useMarketSounds(searchQuery?: string | null, maxItems: number = 60) {
  const term = String(searchQuery || '').trim();
  const query = useQuery({
    queryKey: queryKeys.sounds.list(term, maxItems),
    staleTime: 60_000,
    queryFn: (): Promise<MarketSound[]> => marketSoundsApi.list(maxItems, term),
  });

  const failed = query.isError && !query.data;
  return {
    sounds: failed ? [] : (query.data ?? []),
    loading: query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load sounds')
      : null,
    refetch: query.refetch,
  };
}

export function useMarketSound(soundId: string | null) {
  const id = String(soundId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.sounds.byId(id),
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: async (): Promise<MarketSound | null> => {
      if (!id) return null;
      return marketSoundsApi.get(id);
    },
  });

  return {
    sound: query.data ?? null,
    loading: Boolean(id) && query.isPending && query.data === undefined,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
  };
}

export function useUserSavedSoundIds(userId: string | null) {
  const id = String(userId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.sounds.savedIds(id),
    enabled: Boolean(id),
    staleTime: 30_000,
    queryFn: (): Promise<string[]> => marketSoundsApi.listSavedIds(150),
  });

  const failed = query.isError && !query.data;
  const soundIds = failed ? [] : (query.data ?? []);
  const idSet = useMemo(() => new Set(soundIds), [soundIds]);
  return {
    soundIds,
    idSet,
    loading: Boolean(id) && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load saved sounds')
      : null,
    refetch: query.refetch,
  };
}

export function useSavedMarketSounds(userId: string | null) {
  const id = String(userId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.sounds.saved(id),
    enabled: Boolean(id),
    staleTime: 30_000,
    queryFn: (): Promise<MarketSound[]> => marketSoundsApi.listSaved(150),
  });

  const failed = query.isError && !query.data;
  return {
    sounds: failed ? [] : (query.data ?? []),
    loading: Boolean(id) && query.isPending && !query.data,
    error: failed
      ? query.error instanceof Error
        ? query.error
        : new Error('Failed to load saved sounds')
      : null,
    refetch: query.refetch,
  };
}

export function useIsMarketSoundSaved(soundId: string | null, userId: string | null) {
  const { soundIds, loading, error, refetch } = useUserSavedSoundIds(userId);
  const isSaved = Boolean(soundId && soundIds.includes(soundId));
  return { isSaved, loading, error, refetch };
}

/** Optimistic save toggle — updates saved-ids + saved-list caches. */
export async function toggleMarketSoundSave(
  userId: string,
  soundId: string,
  isCurrentlySaved: boolean
) {
  const uid = String(userId || '').trim();
  const sid = String(soundId || '').trim();
  if (!uid || !sid) throw new Error('Please log in to continue.');

  const idsKey = queryKeys.sounds.savedIds(uid);
  const listKey = queryKeys.sounds.saved(uid);
  const previousIds = queryClient.getQueryData<string[]>(idsKey) ?? [];
  const previousList = queryClient.getQueryData<MarketSound[]>(listKey);

  const nextIds = isCurrentlySaved
    ? previousIds.filter((id) => id !== sid)
    : [...new Set([...previousIds, sid])];
  queryClient.setQueryData(idsKey, nextIds);

  if (previousList) {
    queryClient.setQueryData(
      listKey,
      isCurrentlySaved ? previousList.filter((s) => s.id !== sid) : previousList
    );
  }

  try {
    await marketSoundsApi.toggleSaveSound(sid, isCurrentlySaved);
    void queryClient.invalidateQueries({ queryKey: idsKey });
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sounds.byId(sid) });
  } catch (err) {
    queryClient.setQueryData(idsKey, previousIds);
    if (previousList) queryClient.setQueryData(listKey, previousList);
    throw err;
  }
}
