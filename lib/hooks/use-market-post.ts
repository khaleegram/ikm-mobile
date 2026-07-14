import { useQuery } from '@tanstack/react-query';

import { marketPostsApi } from '@/lib/api/market-posts';
import type { MarketPost } from '@/types';

export function useMarketPostQuery(postId: string | null | undefined) {
  const id = String(postId || '').trim() || null;
  return useQuery({
    queryKey: ['market-post', id],
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
    queryKey: ['market-posts-batch', ids.slice().sort().join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<MarketPost[]> => marketPostsApi.getBatch(ids),
  });
}
