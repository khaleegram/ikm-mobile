import { create } from 'zustand';

interface MarketChatState {
  activeConversationId: string | null;
  setActiveMarketConversationId: (id: string | null) => void;
  getActiveMarketConversationId: () => string | null;
}

export const useMarketChatStore = create<MarketChatState>((set, get) => ({
  activeConversationId: null,
  setActiveMarketConversationId: (conversationId) => {
    const next = conversationId && String(conversationId).trim() ? String(conversationId).trim() : null;
    if (next === get().activeConversationId) return;
    set({ activeConversationId: next });
  },
  getActiveMarketConversationId: () => get().activeConversationId,
}));
