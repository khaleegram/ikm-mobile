import { appStorage } from '@/lib/storage/mmkv';

/**
 * Offline **write queue** only — not a second server-state cache.
 *
 * Server reads go through TanStack Query + MMKV persistence (`lib/query/*`).
 * This module queues mutations (messages/products/orders) for replay when
 * connectivity returns. Do not add TTL read-caches here.
 */

const QUEUE_KEY = '@ikm_queue_writes_v1';

export interface QueuedWrite {
  id: string;
  type: 'product' | 'order' | 'user' | 'marketMessage';
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  retryCount?: number;
}

function readQueue(): QueuedWrite[] {
  try {
    const raw = appStorage.getString(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedWrite[]): void {
  appStorage.set(QUEUE_KEY, JSON.stringify(queue));
}

export async function queueWrite(write: QueuedWrite): Promise<void> {
  const queue = readQueue().filter((item) => item.id !== write.id);
  queue.push({ ...write, retryCount: write.retryCount ?? 0 });
  writeQueue(queue);
}

export async function removeQueuedWrite(id: string): Promise<void> {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

export async function getWriteQueue(): Promise<QueuedWrite[]> {
  return readQueue();
}

export async function getQueuedMarketMessages(chatId?: string): Promise<QueuedWrite[]> {
  const id = String(chatId || '').trim();
  return readQueue().filter((item) => {
    if (item.type !== 'marketMessage' || item.action !== 'create') return false;
    if (!id) return true;
    return String(item.data?.chatId || '') === id;
  });
}

export async function syncQueuedWrites(
  handler: (write: QueuedWrite) => Promise<void>
): Promise<void> {
  const queue = readQueue();
  if (!queue.length) return;

  const remaining: QueuedWrite[] = [];
  for (const write of queue) {
    try {
      await handler(write);
    } catch {
      remaining.push({
        ...write,
        retryCount: (write.retryCount || 0) + 1,
      });
    }
  }
  writeQueue(remaining);
}

/** @deprecated Server-state caching belongs in TanStack Query/MMKV — no-op kept for stray imports. */
export async function cacheData(_key: string, _data: unknown, _ttl?: number): Promise<void> {
  // Intentionally empty — do not reintroduce AsyncStorage read caches.
}

/** @deprecated Always returns null; use TanStack Query. */
export async function getCachedData<T>(_key: string): Promise<T | null> {
  return null;
}
