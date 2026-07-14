import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { chatApi } from '@/lib/api/chat';
import { isPostgresChatBackend } from '@/lib/config/chat-backend';
import { chatThreadCache } from '@/lib/stores/chat-thread-cache';
import { useMarketChats } from '@/lib/firebase/firestore/market-messages';
import type { ChatInboxItem } from '@/types/chat';

type UseChatInboxResult = {
  items: ChatInboxItem[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  usingPostgres: boolean;
};

function mapLegacyChatToInboxItem(chat: any, userId: string): ChatInboxItem {
  const participants = Array.isArray(chat?.participants) ? chat.participants : [];
  const peerId =
    participants.find((id: string) => id && id !== userId) ||
    chat?.posterId ||
    chat?.buyerId ||
    '';
  const postId = String(chat?.postId || chat?.lastContextPostId || '').trim();
  const lastMessage = String(chat?.lastMessage || '').trim();
  const statusBadge = /offer/i.test(lastMessage)
    ? 'offer_sent'
    : /order/i.test(lastMessage)
      ? 'order_active'
      : null;

  return {
    threadId: String(chat?.id || chat?.chatId || peerId),
    peerId: String(peerId),
    peerName: String(chat?.posterName || chat?.otherParticipantName || 'Conversation'),
    peerAvatar: null,
    postId,
    postSnapshot: {
      title: chat?.postTitle || undefined,
      imageUrl: chat?.postImageUrl || null,
    },
    status: 'browsing',
    statusBadge,
    lastPreview: lastMessage || 'Tap to open chat',
    unreadCount: Number(chat?.unreadCount || 0),
    lastAt: chat?.updatedAt ? new Date(chat.updatedAt).toISOString() : null,
  };
}

export function useChatInbox(userId: string | null): UseChatInboxResult {
  const usingPostgres = isPostgresChatBackend();
  const legacy = useMarketChats(usingPostgres ? null : userId);

  const [items, setItems] = useState<ChatInboxItem[]>([]);
  const [loading, setLoading] = useState(Boolean(userId && usingPostgres));
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !usingPostgres) return;
    setLoading(true);
    setError(null);
    try {
      const threads = await chatApi.getInbox();
      for (const item of threads) {
        chatThreadCache.seedFromInbox(item);
      }
      setItems(threads);
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error(String(err?.message || 'Failed to load inbox')));
    } finally {
      setLoading(false);
    }
  }, [userId, usingPostgres]);

  useEffect(() => {
    if (!userId || !usingPostgres) return;
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, 15000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [userId, usingPostgres, refresh]);

  if (!usingPostgres) {
    return {
      items: legacy.chats.map((chat) => mapLegacyChatToInboxItem(chat, userId || '')),
      loading: legacy.loading,
      error: legacy.error,
      refresh: async () => {},
      usingPostgres: false,
    };
  }

  return { items, loading, error, refresh, usingPostgres: true };
}
