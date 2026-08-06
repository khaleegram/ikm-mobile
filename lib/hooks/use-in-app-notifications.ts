import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { notificationsApi } from '@/lib/api/notifications';
import { queryKeys } from '@/lib/query/keys';
import type { AppNotification } from '@/types';

/** In-app feed row — CF payload plus a few legacy aliases used by screens. */
export type InAppNotification = AppNotification & {
  message?: string;
  chatId?: string;
  peerId?: string;
  productId?: string;
  amount?: number;
  status?: string;
};

function mapNotification(row: any): InAppNotification {
  const message = String(row?.message || row?.body || '');
  const chatId = row?.chatId || row?.chatRoomId || undefined;
  return {
    id: String(row?.id || ''),
    userId: String(row?.userId || ''),
    title: String(row?.title || ''),
    body: message,
    message,
    type: String(row?.type || 'system') as AppNotification['type'],
    read: Boolean(row?.read),
    chatId,
    chatRoomId: chatId,
    peerId: row?.peerId || undefined,
    productId: row?.productId || undefined,
    orderId: row?.orderId || undefined,
    status: row?.status || undefined,
    amount: row?.amount != null ? Number(row.amount) : undefined,
    actionUrl: row?.actionUrl || undefined,
    deliveredVia: Array.isArray(row?.deliveredVia) ? row.deliveredVia : (['in_app'] as AppNotification['deliveredVia']),
    priority: (row?.priority === 'high' || row?.priority === 'low' ? row.priority : 'medium') as AppNotification['priority'],
    createdAt: row?.createdAt || row?.created_at || new Date(),
  };
}

/**
 * In-app notification feed via Cloud Functions + TanStack Query (no Firestore listeners).
 * Persist sink remains CF/Firestore server-side until a Neon notifications table lands.
 *
 * Distinct from `use-notifications.ts` (Expo push token / local schedule helpers).
 */
export function useInAppNotifications(userId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.notifications.list(userId),
    enabled: Boolean(userId),
    staleTime: 20_000,
    queryFn: async (): Promise<InAppNotification[]> => {
      const result = await notificationsApi.getNotifications({ limit: 50 });
      const rows = Array.isArray(result?.notifications) ? result.notifications : [];
      return rows.map(mapNotification).filter((n) => n.id);
    },
  });

  useEffect(() => {
    if (!userId) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(userId) });
      }
    }, 45_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(userId) });
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [userId, queryClient]);

  const notifications = query.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;
  const loading = Boolean(userId) && query.isPending && notifications.length === 0;

  const refresh = useCallback(async () => {
    if (!userId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(userId) });
    await query.refetch();
  }, [userId, queryClient, query]);

  const markRead = useCallback(
    async (notificationId: string) => {
      const id = String(notificationId || '').trim();
      if (!id || !userId) return;
      queryClient.setQueryData<InAppNotification[]>(queryKeys.notifications.list(userId), (prev) =>
        (prev || []).map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      try {
        await notificationsApi.markRead(id);
      } catch {
        await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(userId) });
      }
    },
    [userId, queryClient]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    queryClient.setQueryData<InAppNotification[]>(queryKeys.notifications.list(userId), (prev) =>
      (prev || []).map((n) => ({ ...n, read: true }))
    );
    try {
      await notificationsApi.markAllRead();
    } catch {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(userId) });
    }
  }, [userId, queryClient]);

  return {
    notifications,
    unreadCount,
    loading,
    error: query.error instanceof Error ? query.error : null,
    refresh,
    markRead,
    markAllRead,
    refetch: refresh,
  };
}

/** @deprecated Prefer useInAppNotifications().markRead */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  await notificationsApi.markRead(notificationId);
}

/** Alias kept for call sites that used the old firestore hook name. */
export const useNotifications = useInAppNotifications;
