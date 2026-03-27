// Offline support and data caching utilities
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = '@ikm_cache_';
const QUEUE_PREFIX = '@ikm_queue_';

export interface CachedData<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface QueuedWrite {
  id: string;
  type: 'product' | 'order' | 'user' | 'marketMessage';
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  retryCount?: number;
}

/**
 * Cache data with expiration
 */
export async function cacheData<T>(
  key: string,
  data: T,
  ttl: number = 3600000 // 1 hour default
): Promise<void> {
  const cached: CachedData<T> = {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + ttl,
  };
  await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(cached));
}

/**
 * Get cached data if not expired
 */
export async function getCachedData<T>(key: string): Promise<T | null> {
  try {
    const cachedStr = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!cachedStr) return null;

    const cached: CachedData<T> = JSON.parse(cachedStr);
    
    // Check if expired
    if (Date.now() > cached.expiresAt) {
      await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }

    return cached.data;
  } catch (error) {
    console.error('Error getting cached data:', error);
    return null;
  }
}

/**
 * Clear cached data
 */
export async function clearCache(key: string): Promise<void> {
  await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
}

/**
 * Clear all cached data
 */
export async function clearAllCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const cacheKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX));
  await AsyncStorage.multiRemove(cacheKeys);
}

/**
 * Queue a write operation for offline sync
 */
export async function queueWrite(write: QueuedWrite): Promise<void> {
  try {
    const queue = await getWriteQueue();
    const nextQueue = [...queue];

    // Avoid duplicate queued market messages with the same client id.
    if (write.type === 'marketMessage' && write.action === 'create') {
      const chatId = String(write.data?.chatId || '').trim();
      const clientMessageId = String(write.data?.clientMessageId || '').trim();
      if (chatId && clientMessageId) {
        const existingIndex = nextQueue.findIndex((queued) => {
          if (queued.type !== 'marketMessage' || queued.action !== 'create') return false;
          return (
            String(queued.data?.chatId || '').trim() === chatId &&
            String(queued.data?.clientMessageId || '').trim() === clientMessageId
          );
        });
        if (existingIndex >= 0) {
          nextQueue[existingIndex] = {
            ...nextQueue[existingIndex],
            ...write,
            timestamp: write.timestamp || Date.now(),
          };
          await AsyncStorage.setItem(QUEUE_PREFIX, JSON.stringify(nextQueue));
          return;
        }
      }
    }

    nextQueue.push(write);
    await AsyncStorage.setItem(QUEUE_PREFIX, JSON.stringify(nextQueue));
  } catch (error) {
    console.error('Error queueing write:', error);
  }
}

/**
 * Get all queued writes
 */
export async function getWriteQueue(): Promise<QueuedWrite[]> {
  try {
    const queueStr = await AsyncStorage.getItem(QUEUE_PREFIX);
    if (!queueStr) return [];
    return JSON.parse(queueStr);
  } catch (error) {
    console.error('Error getting write queue:', error);
    return [];
  }
}

/**
 * Remove a write from the queue
 */
export async function removeQueuedWrite(writeId: string): Promise<void> {
  const queue = await getWriteQueue();
  const filtered = queue.filter((w) => w.id !== writeId);
  await AsyncStorage.setItem(QUEUE_PREFIX, JSON.stringify(filtered));
}

/**
 * Clear all queued writes
 */
export async function clearWriteQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_PREFIX);
}

/**
 * Get queued market messages, optionally scoped to a chat.
 */
export async function getQueuedMarketMessages(chatId?: string): Promise<QueuedWrite[]> {
  const queue = await getWriteQueue();
  const normalizedChatId = String(chatId || '').trim();
  return queue.filter((write) => {
    if (write.type !== 'marketMessage' || write.action !== 'create') return false;
    if (!normalizedChatId) return true;
    return String(write.data?.chatId || '').trim() === normalizedChatId;
  });
}

/**
 * Check if device is online
 * Note: This is a simple check. Use NetInfo in components for accurate status.
 */
export function isOnline(): boolean {
  // Default to true - actual check should use NetInfo hook
  return true;
}

/**
 * Sync queued writes when online
 */
export async function syncQueuedWrites(
  syncFn: (write: QueuedWrite) => Promise<void>
): Promise<void> {
  if (!isOnline()) return;

  const queue = await getWriteQueue();
  const sortedQueue = [...queue].sort((left, right) => {
    const leftTs = Number(left.timestamp || 0);
    const rightTs = Number(right.timestamp || 0);
    return leftTs - rightTs;
  });

  for (const write of sortedQueue) {
    try {
      await syncFn(write);
      await removeQueuedWrite(write.id);
    } catch (error) {
      console.error(`Error syncing write ${write.id}:`, error);
      // Keep in queue for retry
      continue;
    }
  }
}

