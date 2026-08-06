import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

import { wireReactQueryRnManagers } from '@/lib/query/rn-managers';
import { mmkvStorage } from '@/lib/storage/mmkv';

wireReactQueryRnManagers();

/**
 * TanStack Query client + MMKV disk persistence.
 * Cold starts rehydrate from MMKV before first paint (see AppQueryProvider).
 */
export const queryPersister = createSyncStoragePersister({
  storage: mmkvStorage,
  key: 'CHATCART_REACT_QUERY',
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 1000 * 60 * 60 * 24, // 24h
      retry: 1,
      // Prefer cached data while offline; NetInfo onlineManager drives reconnect refetch.
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
      networkMode: 'offlineFirst',
    },
  },
});

export const QUERY_PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
