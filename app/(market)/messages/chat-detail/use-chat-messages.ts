import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { marketMessagesApi } from '@/lib/api/market-messages';
import {
  useMarketChat,
  useMarketChatMeta,
  useMarketConversationMessages,
} from '@/lib/firebase/firestore/market-messages';
import { MarketMessage } from '@/types';

import { getStableMessageKey, isDirectConversationId, toMs } from './utils';

type UseChatMessagesParams = {
  activeChatId: string | null;
  legacyChatId: string | null;
  resolvedPeerId: string | null;
  userId: string | null;
};

type UseChatMessagesResult = {
  contextPostId: string | null;
  displayMessages: MarketMessage[];
  error: Error | null;
  legacyChat: any;
  legacySellerId: string | null;
  loading: boolean;
  pendingMessages: MarketMessage[];
  renderedMessages: MarketMessage[];
  setPendingMessages: Dispatch<SetStateAction<MarketMessage[]>>;
  unreadCount: number;
  unreadDividerMessageId: string;
};

export function useChatMessages({
  activeChatId,
  legacyChatId,
  resolvedPeerId,
  userId,
}: UseChatMessagesParams): UseChatMessagesResult {
  const lastMarkedReadMessageIdRef = useRef<string>('');
  const [pendingMessages, setPendingMessages] = useState<MarketMessage[]>([]);
  const [unreadSnapshotCount, setUnreadSnapshotCount] = useState(0);
  const [unreadSnapshotMessageId, setUnreadSnapshotMessageId] = useState('');

  const effectiveLegacyChatId = userId ? legacyChatId : null;
  const {
    messages: legacyMessages,
    loading: legacyLoading,
    error: legacyError,
  } = useMarketChat(effectiveLegacyChatId);
  const { chat: legacyChat } = useMarketChatMeta(effectiveLegacyChatId);
  const { chat: activeChatMeta } = useMarketChatMeta(activeChatId);

  const {
    messages: conversationMessages,
    loading: conversationLoading,
    error: conversationError,
  } = useMarketConversationMessages(userId, userId ? resolvedPeerId || null : null);

  const loading = resolvedPeerId ? conversationLoading : legacyLoading;
  const error = resolvedPeerId ? conversationError || legacyError : legacyError;

  const legacySellerId = useMemo(() => {
    if (!legacyChat || !Array.isArray(legacyChat.participants)) return null;
    if (legacyChat.posterId && typeof legacyChat.posterId === 'string') return legacyChat.posterId;
    if (legacyChat.sellerId && typeof legacyChat.sellerId === 'string') return legacyChat.sellerId;
    if (legacyChat.buyerId && typeof legacyChat.buyerId === 'string') {
      return legacyChat.participants.find((id: string) => id !== legacyChat.buyerId) || null;
    }
    return null;
  }, [legacyChat]);

  const legacyPostId = useMemo(() => {
    const candidate = String((legacyChat as any)?.postId || '').trim();
    return candidate || null;
  }, [legacyChat]);

  const visibleMessages = useMemo(() => {
    const merged = new Map<string, MarketMessage>();
    [...legacyMessages, ...conversationMessages, ...pendingMessages].forEach((message) => {
      const stableId = getStableMessageKey(message, String(activeChatId || 'chat'));
      merged.set(stableId, { ...message, id: stableId });
    });
    return [...merged.values()].sort((left, right) => toMs(left.createdAt) - toMs(right.createdAt));
  }, [legacyMessages, conversationMessages, pendingMessages, activeChatId]);

  const displayMessages = useMemo(() => {
    if (visibleMessages.length > 0) return visibleMessages;
    if (resolvedPeerId) return visibleMessages;
    if (loading) return visibleMessages;

    const fallbackText = String((legacyChat as any)?.lastMessage || '').trim();
    if (!fallbackText || !activeChatId) return visibleMessages;

    return [
      {
        id: `meta-${activeChatId}`,
        chatId: activeChatId,
        senderId: String(
          (legacyChat as any)?.lastMessageSenderId ||
            (legacyChat as any)?.senderId ||
            (legacyChat as any)?.buyerId ||
            ''
        ),
        receiverId: '',
        postId: legacyPostId || '',
        message: fallbackText,
        read: true,
        createdAt:
          (legacyChat as any)?.updatedAt ||
          (legacyChat as any)?.lastMessageAt ||
          (legacyChat as any)?.createdAt ||
          new Date(),
      } as MarketMessage,
    ];
  }, [visibleMessages, resolvedPeerId, loading, legacyChat, activeChatId, legacyPostId]);

  const renderedMessages = useMemo(() => [...displayMessages].reverse(), [displayMessages]);

  const contextPostId = useMemo(() => {
    if (legacyPostId) return legacyPostId;
    const latestWithPost = [...displayMessages]
      .reverse()
      .find((message) => String(message.quoteCard?.postId || message.postId || '').trim().length > 0);
    return String(latestWithPost?.quoteCard?.postId || latestWithPost?.postId || '').trim() || null;
  }, [displayMessages, legacyPostId]);

  const unreadCountFromMeta = useMemo(() => {
    if (!userId || !activeChatMeta) return 0;
    const unreadByUser = (activeChatMeta as any)?.unreadCountByUser;
    if (unreadByUser && typeof unreadByUser === 'object') {
      return Number(unreadByUser[userId] || 0);
    }
    return Number((activeChatMeta as any)?.unreadCount || 0);
  }, [activeChatMeta, userId]);

  const lastReadMessageIdFromMeta = useMemo(() => {
    if (!userId || !activeChatMeta) return '';
    return String((activeChatMeta as any)?.lastReadMessageIdByUser?.[userId] || '').trim();
  }, [activeChatMeta, userId]);

  const unreadMessagesByPointer = useMemo(() => {
    if (!userId || displayMessages.length === 0) return [];

    const lastReadIndex = lastReadMessageIdFromMeta
      ? displayMessages.findIndex(
          (message) => String(message.id || '').trim() === lastReadMessageIdFromMeta
        )
      : -1;

    return displayMessages
      .slice(Math.max(0, lastReadIndex + 1))
      .filter((message) => String(message.senderId || '') !== userId);
  }, [displayMessages, lastReadMessageIdFromMeta, userId]);

  const effectiveUnreadCount = useMemo(
    () => Math.max(unreadCountFromMeta, unreadMessagesByPointer.length),
    [unreadCountFromMeta, unreadMessagesByPointer.length]
  );

  useEffect(() => {
    setUnreadSnapshotCount(0);
    setUnreadSnapshotMessageId('');
  }, [activeChatId]);

  useEffect(() => {
    if (!userId || unreadSnapshotCount > 0) return;
    if (effectiveUnreadCount <= 0 || displayMessages.length === 0) return;

    let anchorId = String(unreadMessagesByPointer[0]?.id || '').trim();
    if (!anchorId) {
      const incomingMessages = displayMessages.filter(
        (message) => String(message.senderId || '') !== userId
      );
      const firstUnreadIndex = Math.max(0, incomingMessages.length - effectiveUnreadCount);
      anchorId = String(incomingMessages[firstUnreadIndex]?.id || '').trim();
    }

    if (!anchorId) return;
    setUnreadSnapshotCount(effectiveUnreadCount);
    setUnreadSnapshotMessageId(anchorId);
  }, [displayMessages, effectiveUnreadCount, unreadMessagesByPointer, unreadSnapshotCount, userId]);

  const unreadCount = unreadSnapshotCount > 0 ? unreadSnapshotCount : effectiveUnreadCount;

  const unreadDividerMessageId = useMemo(() => {
    if (!userId || unreadCount <= 0 || displayMessages.length === 0) return '';
    if (unreadSnapshotMessageId) {
      const exists = displayMessages.some(
        (message) => String(message.id || '').trim() === unreadSnapshotMessageId
      );
      if (exists) return unreadSnapshotMessageId;
    }

    if (unreadMessagesByPointer.length > 0) {
      return String(unreadMessagesByPointer[0]?.id || '').trim();
    }

    const incomingMessages = displayMessages.filter(
      (message) => String(message.senderId || '') !== userId
    );
    const firstUnreadIndex = Math.max(0, incomingMessages.length - unreadCount);
    return String(incomingMessages[firstUnreadIndex]?.id || '').trim();
  }, [displayMessages, unreadCount, unreadMessagesByPointer, unreadSnapshotMessageId, userId]);

  useEffect(() => {
    if (!userId || pendingMessages.length === 0 || displayMessages.length === 0) return;

    setPendingMessages((previous) => {
      let changed = false;
      const next = previous.filter((pending) => {
        const pendingClientMessageId = String((pending as any)?.clientMessageId || '').trim();
        const matched = displayMessages.some((serverMessage) => {
          if (serverMessage.senderId !== userId) return false;
          const serverClientMessageId = String((serverMessage as any)?.clientMessageId || '').trim();
          if (pendingClientMessageId && serverClientMessageId) {
            return serverClientMessageId === pendingClientMessageId;
          }

          if ((serverMessage.message || '').trim() !== (pending.message || '').trim()) return false;
          if (String(serverMessage.chatId || '') !== String(pending.chatId || '')) return false;
          const serverTime = toMs(serverMessage.createdAt);
          const pendingTime = toMs(pending.createdAt);
          return serverTime >= pendingTime - 60000 && serverTime - pendingTime <= 24 * 60 * 60 * 1000;
        });
        if (!matched) return true;
        changed = true;
        return false;
      });

      return changed ? next : previous;
    });
  }, [displayMessages, pendingMessages.length, userId]);

  useEffect(() => {
    if (!userId || !activeChatId || !isDirectConversationId(activeChatId) || displayMessages.length === 0) {
      return;
    }

    const incomingMessageIds = displayMessages
      .filter((item) => item.senderId !== userId)
      .map((item) => String(item.id || '').trim())
      .filter(Boolean);

    if (incomingMessageIds.length === 0) return;
    const latestIncomingId = incomingMessageIds[incomingMessageIds.length - 1];
    if (!latestIncomingId || lastMarkedReadMessageIdRef.current === latestIncomingId) {
      return;
    }

    lastMarkedReadMessageIdRef.current = latestIncomingId;
    marketMessagesApi.markAsRead(activeChatId, [latestIncomingId]).catch(() => {
      if (lastMarkedReadMessageIdRef.current === latestIncomingId) {
        lastMarkedReadMessageIdRef.current = '';
      }
    });
  }, [activeChatId, displayMessages, userId]);

  return {
    contextPostId,
    displayMessages,
    error,
    legacyChat,
    legacySellerId,
    loading,
    pendingMessages,
    renderedMessages,
    setPendingMessages,
    unreadCount,
    unreadDividerMessageId,
  };
}
