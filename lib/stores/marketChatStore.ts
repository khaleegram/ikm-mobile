import { create } from 'zustand';

import type { MarketMessage } from '@/types';

interface MarketChatState {
  activeConversationId: string | null;
  pendingQuoteByChatId: Record<string, MarketMessage>;
  setActiveMarketConversationId: (id: string | null) => void;
  getActiveMarketConversationId: () => string | null;
  stagePendingQuoteMessage: (chatId: string, message: MarketMessage) => void;
  peekPendingQuoteMessage: (chatId: string) => MarketMessage | null;
  clearPendingQuoteMessage: (chatId: string) => void;
}

export const useMarketChatStore = create<MarketChatState>((set, get) => ({
  activeConversationId: null,
  pendingQuoteByChatId: {},
  setActiveMarketConversationId: (conversationId) => {
    const next = conversationId && String(conversationId).trim() ? String(conversationId).trim() : null;
    if (next === get().activeConversationId) return;
    set({ activeConversationId: next });
  },
  getActiveMarketConversationId: () => get().activeConversationId,
  stagePendingQuoteMessage: (chatId, message) => {
    const key = String(chatId || '').trim();
    if (!key) return;
    set((state) => ({
      pendingQuoteByChatId: {
        ...state.pendingQuoteByChatId,
        [key]: message,
      },
    }));
  },
  peekPendingQuoteMessage: (chatId) => {
    const key = String(chatId || '').trim();
    if (!key) return null;
    return get().pendingQuoteByChatId[key] || null;
  },
  clearPendingQuoteMessage: (chatId) => {
    const key = String(chatId || '').trim();
    if (!key || !get().pendingQuoteByChatId[key]) return;
    const next = { ...get().pendingQuoteByChatId };
    delete next[key];
    set({ pendingQuoteByChatId: next });
  },
}));
