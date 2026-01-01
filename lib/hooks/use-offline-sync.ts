// Hook for offline sync functionality
import { useEffect, useState, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { syncQueuedWrites, getWriteQueue } from '../utils/offline';
import { productApi } from '../api/products';
import { orderApi } from '../api/orders';
import { userApi } from '../api/user';
import { QueuedWrite } from '../utils/offline';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [queuedWrites, setQueuedWrites] = useState<QueuedWrite[]>([]);
  const [syncing, setSyncing] = useState(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Track app state to prevent operations when backgrounded
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      appState.current = nextAppState;
    });

    // Subscribe to network state changes
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = NetInfo.addEventListener((state) => {
        // Only update if app is in foreground or active
        if (appState.current === 'active') {
          setIsOnline(state.isConnected ?? false);
        }
      });
    } catch (error) {
      console.error('Error setting up NetInfo listener:', error);
    }

    // Load queued writes
    loadQueuedWrites();

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
  }, []);

  const loadQueuedWrites = async () => {
    const queue = await getWriteQueue();
    setQueuedWrites(queue);
  };

  const syncWrites = async () => {
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
        }
      });
      await loadQueuedWrites();
    } catch (error) {
      console.error('Error syncing writes:', error);
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync when coming online (only if app is active)
  useEffect(() => {
    if (isOnline && queuedWrites.length > 0 && appState.current === 'active') {
      syncWrites();
    }
  }, [isOnline]);

  return {
    isOnline,
    queuedWrites,
    syncing,
    syncWrites,
    loadQueuedWrites,
  };
}

