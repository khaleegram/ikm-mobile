import React, { useEffect, useState } from 'react';
import { useIsRestoring } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as SplashScreen from 'expo-splash-screen';

import {
  QUERY_PERSIST_MAX_AGE_MS,
  queryClient,
  queryPersister,
} from '@/lib/query/client';
import { clearLegacyChatCaches } from '@/lib/chat/chat-query-cache';

void SplashScreen.preventAutoHideAsync().catch(() => {});

type AppQueryProviderProps = {
  children: React.ReactNode;
};

function HydrationGate({ children }: { children: React.ReactNode }) {
  const isRestoring = useIsRestoring();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isRestoring) return;
    const t = setTimeout(() => setTimedOut(true), 1500);
    return () => clearTimeout(t);
  }, [isRestoring]);

  useEffect(() => {
    if (isRestoring && !timedOut) return;
    void SplashScreen.hideAsync().catch(() => {});
  }, [isRestoring, timedOut]);

  if (isRestoring && !timedOut) return null;
  return <>{children}</>;
}

/**
 * TanStack Query + persisted cache.
 * Holds splash until the disk cache has rehydrated so cold starts feel instant.
 */
export function AppQueryProvider({ children }: AppQueryProviderProps) {
  useEffect(() => {
    clearLegacyChatCaches();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: QUERY_PERSIST_MAX_AGE_MS,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === 'success',
        },
      }}>
      <HydrationGate>{children}</HydrationGate>
    </PersistQueryClientProvider>
  );
}
