// Hook for offline sync functionality
import { useCallback, useEffect, useState, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { syncQueuedWrites, getWriteQueue, QueuedWrite } from '../utils/offline';
import { productApi } from '../api/products';
import { orderApi } from '../api/orders';
import { userApi } from '../api/user';
import { marketMessagesApi } from '../api/market-messages';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [queuedWrites, setQueuedWrites] = useState<QueuedWrite[]>([]);
  const [syncing, setSyncing] = useState(false);
  const appState = useRef(AppState.currentState);

  const loadQueuedWrites = useCallback(async () => {
    const queue = await getWriteQueue();
    setQueuedWrites(queue);
  }, []);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      appState.current = nextAppState;
      if (nextAppState === 'active') {
        void loadQueuedWrites();
      }
    });

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = NetInfo.addEventListener((state) => {
        if (appState.current === 'active') {
          setIsOnline(Boolean(state.isConnected));
          void loadQueuedWrites();
        }
      });

      void NetInfo.fetch()
        .then((state) => {
          if (appState.current !== 'active') return;
          setIsOnline(Boolean(state.isConnected));
          return loadQueuedWrites();
        })
        .catch(() => {});
    } catch (error) {
      console.error('Error setting up NetInfo listener:', error);
    }

    void loadQueuedWrites();

    return () => {
      appStateSubscription?.remove();
      try {
        if (unsubscribe) {
          unsubscribe();
        }
      } catch (error) {
        console.error('Error removing NetInfo listener:', error);
      }
    };
  }, [loadQueuedWrites]);

  const syncWrites = useCallback(async () => {
    if (!isOnline || syncing) return;

    setSyncing(true);
    try {
      await syncQueuedWrites(async (write: QueuedWrite) => {
        switch (write.type) {
          case 'product':
            if (write.action === 'create') {
              await productApi.create(write.data);
            } else if (write.action === 'update') {
              await productApi.update(write.data.id, write.data);
            } else if (write.action === 'delete') {
              await productApi.delete(write.data.id);
            }
            break;
          case 'order':
            if (write.action === 'update') {
              await orderApi.updateStatus(write.data.orderId, write.data.status);
            }
            break;
          case 'user':
            if (write.action === 'update') {
              await userApi.updateProfile(write.data.userId, write.data);
            }
            break;
          case 'marketMessage':
            if (write.action === 'create') {
              await marketMessagesApi.sendQueuedMessage(write.data);
            }
            break;
        }
      });
      await loadQueuedWrites();
    } catch (error) {
      console.error('Error syncing writes:', error);
    } finally {
      setSyncing(false);
    }
  }, [isOnline, syncing, loadQueuedWrites]);

  useEffect(() => {
    if (isOnline && queuedWrites.length > 0 && appState.current === 'active') {
      void syncWrites();
    }
  }, [isOnline, queuedWrites.length, syncWrites]);

  return {
    isOnline,
    queuedWrites,
    syncing,
    syncWrites,
    loadQueuedWrites,
  };
}

