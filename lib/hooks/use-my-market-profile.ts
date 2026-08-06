import { useQuery } from '@tanstack/react-query';

import { usersApi, type ApiUserProfile } from '@/lib/api/users-api';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';

/**
 * Own market profile from Neon (`/users/me`) — the single source of truth for
 * buyer delivery fields (marketBuyerPhone, marketBuyerLocation) plus display name.
 *
 * Screens must read buyer fields from here, never from the Firestore users doc:
 * buyer profile writes go to Neon only (see `saveMarketBuyerProfile`), so
 * Firestore values for these fields are stale legacy data.
 */
export function useMyMarketProfile(userId: string | null | undefined) {
  const id = String(userId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.user.me(id),
    enabled: Boolean(id),
    staleTime: 60_000,
    queryFn: (): Promise<ApiUserProfile> => usersApi.getMe(),
  });

  return {
    profile: query.data ?? null,
    loading: Boolean(id) && query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
  };
}

/** Refresh the cached own-profile after a buyer-profile mutation. */
export async function invalidateMyMarketProfile(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
}
