import { create } from 'zustand';

import { mmkvStorage } from '@/lib/storage/mmkv';
import type { ChatInboxItem } from '@/types/chat';

const STORAGE_KEY = 'chat-inbox-cache-v2';

type ChatInboxCacheState = {
  byUserId: Record<string, ChatInboxItem[]>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  getItems: (userId: string) => ChatInboxItem[];
  setItems: (userId: string, items: ChatInboxItem[]) => void;
  patchThread: (
    userId: string,
    threadId: string,
    patch: Partial<ChatInboxItem>
  ) => void;
  replaceThreadId: (
    userId: string,
    fromThreadId: string,
    toThreadId: string,
    patch?: Partial<ChatInboxItem>
  ) => void;
  clearUser: (userId: string) => void;
};

function loadFromDisk(): Record<string, ChatInboxItem[]> {
  try {
    const raw = mmkvStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, ChatInboxItem[]>;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // ignore corrupt cache
  }
  return {};
}

function persist(byUserId: Record<string, ChatInboxItem[]>) {
  try {
    mmkvStorage.setItem(STORAGE_KEY, JSON.stringify(byUserId));
  } catch {
    // ignore persist failures
  }
}

export const useChatInboxCache = create<ChatInboxCacheState>((set, get) => ({
  // MMKV is synchronous, so the cache is available on the very first render — no async
  // rehydration gap on cold start.
  byUserId: loadFromDisk(),
  hydrated: true,

  hydrate: async () => {
    // Retained for API compatibility; MMKV hydrates synchronously at store creation.
    if (get().hydrated) return;
    set({ byUserId: loadFromDisk(), hydrated: true });
  },

  getItems: (userId) => {
    const key = String(userId || '').trim();
    if (!key) return [];
    return get().byUserId[key] || [];
  },

  setItems: (userId, items) => {
    const key = String(userId || '').trim();
    if (!key) return;
    const next = { ...get().byUserId, [key]: items };
    set({ byUserId: next });
    persist(next);
  },

  /** Patch one room in-place (e.g. clear unread after markRead). */
  patchThread: (userId, threadId, patch) => {
    const key = String(userId || '').trim();
    const id = String(threadId || '').trim();
    if (!key || !id) return;
    const items = get().byUserId[key] || [];
    let changed = false;
    const next = items.map((item) => {
      if (item.threadId !== id) return item;
      changed = true;
      return { ...item, ...patch };
    });
    if (!changed) return;
    const byUserId = { ...get().byUserId, [key]: next };
    set({ byUserId });
    persist(byUserId);
  },

  /** Swap a pending / old thread id for the real server UUID without losing the row. */
  replaceThreadId: (userId: string, fromThreadId: string, toThreadId: string, patch?: Partial<ChatInboxItem>) => {
    const key = String(userId || '').trim();
    const from = String(fromThreadId || '').trim();
    const to = String(toThreadId || '').trim();
    if (!key || !from || !to) return;
    const items = get().byUserId[key] || [];
    const next = items.map((item) => {
      if (item.threadId !== from) return item;
      return { ...item, ...patch, threadId: to };
    });
    // Drop duplicate if real id already existed
    const deduped = next.filter(
      (item, index, arr) => arr.findIndex((row) => row.threadId === item.threadId) === index
    );
    const byUserId = { ...get().byUserId, [key]: deduped };
    set({ byUserId });
    persist(byUserId);
  },

  clearUser: (userId) => {
    const key = String(userId || '').trim();
    if (!key || !get().byUserId[key]) return;
    const next = { ...get().byUserId };
    delete next[key];
    set({ byUserId: next });
    persist(next);
  },
}));
