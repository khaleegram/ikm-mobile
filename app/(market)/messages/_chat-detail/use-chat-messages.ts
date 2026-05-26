import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { marketMessagesApi } from '@/lib/api/market-messages';
import {
  useMarketChat,
  useMarketChatMeta,
  useMarketConversationMessages,
} from '@/lib/firebase/firestore/market-messages';
import { getQueuedMarketMessages, removeQueuedWrite } from '@/lib/utils/offline';
import { MarketMessage } from '@/types';

import { getMessageTimeMs, getStableMessageKey, isDirectConversationId } from './utils';

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
  markLatestVisibleIncomingAsRead: (messageId: string) => void;
  unreadCount: number;
  unreadDividerMessageId: string;
};

function normalizeDate(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value as any);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

function normalizeMessage(
  message: MarketMessage,
  fallbackChatId: string
): MarketMessage {
  const stableId = getStableMessageKey(message, fallbackChatId);
  const text = String((message as any).text || message.message || '').trim();
  return {
    ...message,
    id: stableId,
    text,
    createdAt: normalizeDate((message as any).createdAt),
  } as MarketMessage;
}

export function useChatMessages({
  activeChatId,
  legacyChatId,
  resolvedPeerId,
  userId,
}: UseChatMessagesParams): UseChatMessagesResult {
  const lastMarkedReadMessageIdRef = useRef<string>('');
  const [pendingMessages, setPendingMessages] = useState<MarketMessage[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<MarketMessage[]>([]);
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

  const serverMessages = useMemo(() => {
    const merged = new Map<string, MarketMessage>();
    [...legacyMessages, ...conversationMessages].forEach((message) => {
      const normalized = normalizeMessage(message, String(activeChatId || 'chat'));
      merged.set(String(normalized.id), normalized);
    });
    return [...merged.values()].sort(
      (left, right) => getMessageTimeMs(left.createdAt) - getMessageTimeMs(right.createdAt)
    );
  }, [legacyMessages, conversationMessages, activeChatId]);

  const hydrateQueuedMessages = useCallback(async () => {
    if (!userId || !activeChatId || !isDirectConversationId(activeChatId)) {
      setQueuedMessages([]);
      return;
    }

    const queuedWrites = await getQueuedMarketMessages(activeChatId);
    if (queuedWrites.length === 0) {
      setQueuedMessages([]);
      return;
    }

    const retained: MarketMessage[] = [];
    const staleWriteIds: string[] = [];

    queuedWrites.forEach((write) => {
      const clientMessageId = String(write.data?.clientMessageId || '').trim();
      const queuedText = String(write.data?.text || write.data?.message || '').trim();
      const queuedTimestamp = Number(write.timestamp || 0);
      const queuedImageUrl = String(write.data?.imageUrl || '').trim();
      const queuedPaymentLink = String(write.data?.paymentLink || '').trim();
      const queuedQuoteCard = write.data?.quoteCard;
      const normalizedClientMessageId = clientMessageId || String(write.id || '').trim();

      const matched = serverMessages.some((serverMessage) => {
        if (!normalizedClientMessageId) return false;
        if (String(serverMessage.senderId || '') !== userId) return false;
        const serverClientMessageId = String((serverMessage as any)?.clientMessageId || '').trim();
        if (!serverClientMessageId) return false;
        return normalizedClientMessageId === serverClientMessageId;
      });

      if (matched) {
        staleWriteIds.push(write.id);
        return;
      }

      retained.push({
        id: clientMessageId || write.id,
        chatId: activeChatId,
        senderId: userId,
        receiverId: '',
        postId: String(queuedQuoteCard?.postId || '').trim(),
        text: queuedText,
        clientMessageId: normalizedClientMessageId || undefined,
        imageUrl: queuedImageUrl || undefined,
        paymentLink: queuedPaymentLink || undefined,
        quoteCard: queuedQuoteCard,
        read: false,
        createdAt: normalizeDate(queuedTimestamp || Date.now()),
      } as MarketMessage);
    });

    if (staleWriteIds.length > 0) {
      await Promise.all(staleWriteIds.map((writeId) => removeQueuedWrite(writeId)));
    }

    retained.sort(
      (left, right) => getMessageTimeMs(left.createdAt) - getMessageTimeMs(right.createdAt)
    );
    setQueuedMessages(retained);
  }, [activeChatId, serverMessages, userId]);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!isMounted) return;
      await hydrateQueuedMessages();
    };

    run();
    const interval = setInterval(run, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [hydrateQueuedMessages]);

  const visibleMessages = useMemo(() => {
    const merged = new Map<string, MarketMessage>();
    [...serverMessages, ...queuedMessages, ...pendingMessages].forEach((message) => {
      const normalized = normalizeMessage(message, String(activeChatId || 'chat'));
      merged.set(String(normalized.id), normalized);
    });
    return [...merged.values()].sort(
      (left, right) => getMessageTimeMs(left.createdAt) - getMessageTimeMs(right.createdAt)
    );
  }, [serverMessages, queuedMessages, pendingMessages, activeChatId]);

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
        text: fallbackText,
        read: true,
        createdAt: normalizeDate(
          (legacyChat as any)?.updatedAt ||
            (legacyChat as any)?.lastMessageAt ||
            (legacyChat as any)?.createdAt ||
            new Date()
        ),
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

  const effectiveUnreadCount = unreadMessagesByPointer.length;

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
        if (!pendingClientMessageId) return true;
        const matched = serverMessages.some((serverMessage) => {
          if (serverMessage.senderId !== userId) return false;
          const serverClientMessageId = String((serverMessage as any)?.clientMessageId || '').trim();
          if (!serverClientMessageId) return false;
          return serverClientMessageId === pendingClientMessageId;
        });
        if (!matched) return true;
        changed = true;
        return false;
      });

      return changed ? next : previous;
    });
  }, [serverMessages, displayMessages.length, pendingMessages.length, userId]);

  const markLatestVisibleIncomingAsRead = useCallback(
    (messageId: string) => {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      if (!userId || !activeChatId || !isDirectConversationId(activeChatId)) return;
      if (lastMarkedReadMessageIdRef.current === normalizedMessageId) return;

      lastMarkedReadMessageIdRef.current = normalizedMessageId;
      marketMessagesApi.markAsRead(activeChatId, normalizedMessageId).catch(() => {
        if (lastMarkedReadMessageIdRef.current === normalizedMessageId) {
          lastMarkedReadMessageIdRef.current = '';
        }
      });
    },
    [activeChatId, userId]
  );

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
    markLatestVisibleIncomingAsRead,
    unreadCount,
    unreadDividerMessageId,
  };
}
