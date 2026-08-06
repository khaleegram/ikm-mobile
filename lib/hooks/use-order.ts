import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { marketOrdersReadApi } from '@/lib/api/market-orders';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import type { Order, OrderTimelineEvent } from '@/types';

/** Invalidate order Query caches after a Cloud Function mutation so market UI catches up. */
export function invalidateOrderQueries(orderId?: string | null, userId?: string | null) {
  if (orderId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.byId(orderId) });
  }
  void queryClient.invalidateQueries({ queryKey: ['orders'] });
  if (userId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.list(userId, 'all') });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.list(userId, 'buyer') });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.list(userId, 'seller') });
  }
}

export function useInvalidateOrder() {
  const client = useQueryClient();
  return useCallback(
    async (orderId: string | null | undefined, userId?: string | null) => {
      const id = String(orderId || '').trim();
      if (id) {
        await client.invalidateQueries({ queryKey: queryKeys.orders.byId(id) });
      }
      await client.invalidateQueries({ queryKey: ['orders'] });
      if (userId) {
        await client.invalidateQueries({ queryKey: queryKeys.orders.list(userId, 'all') });
        await client.invalidateQueries({ queryKey: queryKeys.orders.list(userId, 'buyer') });
        await client.invalidateQueries({ queryKey: queryKeys.orders.list(userId, 'seller') });
      }
    },
    [client]
  );
}

export function useOrder(orderId: string | null) {
  const id = String(orderId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.orders.byId(id),
    enabled: Boolean(id),
    staleTime: 15_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<{ order: Order | null; timeline: OrderTimelineEvent[] }> => {
      if (!id) return { order: null, timeline: [] };
      return marketOrdersReadApi.getById(id);
    },
  });

  return {
    order: query.data?.order ?? null,
    timeline: query.data?.timeline ?? [],
    loading: Boolean(id) && query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
  };
}

/**
 * Deal-room order resolver: linkedOrderId first, else lookup by chat thread id.
 * Keeps Confirm receipt / Dispute available even when the thread snapshot is thin.
 */
export function useDealOrder(linkedOrderId: string | null, threadId: string | null) {
  const orderId = String(linkedOrderId || '').trim() || null;
  const tid = String(threadId || '').trim() || null;
  const byId = useOrder(orderId);

  const byThread = useQuery({
    queryKey: ['orders', 'by-thread', tid] as const,
    enabled: Boolean(tid) && !orderId && !byId.order,
    staleTime: 15_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<{ order: Order | null; timeline: OrderTimelineEvent[] }> => {
      if (!tid) return { order: null, timeline: [] };
      try {
        return await marketOrdersReadApi.getByDealThread(tid);
      } catch {
        return { order: null, timeline: [] };
      }
    },
  });

  // When linkedOrderId is set but getById fails / returns empty, resolve via thread.
  const byThreadFallback = useQuery({
    queryKey: ['orders', 'by-thread-fallback', tid, orderId] as const,
    enabled: Boolean(tid) && Boolean(orderId) && !byId.order && !byId.loading,
    staleTime: 15_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<{ order: Order | null; timeline: OrderTimelineEvent[] }> => {
      if (!tid) return { order: null, timeline: [] };
      try {
        return await marketOrdersReadApi.getByDealThread(tid);
      } catch {
        return { order: null, timeline: [] };
      }
    },
  });

  const order = byId.order || byThread.data?.order || byThreadFallback.data?.order || null;
  const timeline =
    byId.timeline?.length
      ? byId.timeline
      : byThread.data?.timeline || byThreadFallback.data?.timeline || [];

  return {
    order,
    timeline,
    loading: byId.loading || (Boolean(tid) && !order && (byThread.isPending || byThreadFallback.isPending)),
    error: byId.error,
    refetch: async () => {
      await byId.refetch();
      if (tid) {
        await byThread.refetch();
        await byThreadFallback.refetch();
      }
    },
  };
}

export function useUserOrders(userId: string | null, role: 'all' | 'buyer' | 'seller' = 'all') {
  const id = String(userId || '').trim() || null;
  const query = useQuery({
    queryKey: queryKeys.orders.list(id, role),
    enabled: Boolean(id),
    staleTime: 30_000,
    queryFn: async (): Promise<Order[]> => {
      if (!id) return [];
      return marketOrdersReadApi.list(role, 60);
    },
  });

  return {
    orders: query.data ?? [],
    loading: Boolean(id) && query.isPending && !query.data,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
  };
}
