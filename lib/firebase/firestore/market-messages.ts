// Client-side hooks for reading Market Message data (read-only)
import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  limit,
  query,
  where,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '../config';
import { MarketMessage } from '@/types';
import { cacheData, getCachedData } from '@/lib/utils/offline';

type AnyRecord = Record<string, any>;
const INBOX_DEBUG = false;
const MARKET_CHATS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MARKET_CHAT_MESSAGES_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const memoryChatsByUser = new Map<string, any[]>();
const memoryChatMessagesById = new Map<string, MarketMessage[]>();
const memoryConversationMessagesById = new Map<string, MarketMessage[]>();

function inboxDebug(label: string, payload?: unknown) {
  if (!INBOX_DEBUG) return;
  if (payload === undefined) {
    console.log(`[InboxDebug] ${label}`);
    return;
  }
  console.log(`[InboxDebug] ${label}`, payload);
}

function inboxDebugError(label: string, error: any) {
  if (!INBOX_DEBUG) return;
  console.log(`[InboxDebug] ${label}`, {
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });
}

function toDate(value: any): Date {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function asNonEmptyString(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized;
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    const normalized = asNonEmptyString(value);
    if (normalized) return normalized;
  }
  return '';
}

function extractMessageText(data: AnyRecord): string {
  return firstNonEmptyString([
    data.lastMessage,
    data.message,
    data.text,
    data.body,
    data.lastMessageText,
  ]);
}

function extractUsers(data: AnyRecord): string[] {
  const participants = Array.isArray(data.participants)
    ? data.participants.map((value) => asNonEmptyString(value)).filter(Boolean)
    : [];

  const extras = [
    data.senderId,
    data.receiverId,
    data.senderUid,
    data.receiverUid,
    data.fromUserId,
    data.toUserId,
    data.from,
    data.to,
    data.authorId,
    data.createdBy,
    data.buyerId,
    data.posterId,
    data.sellerId,
    data.userAId,
    data.userBId,
    data.participantA,
    data.participantB,
    data.userId,
  ]
    .map((value) => asNonEmptyString(value))
    .filter(Boolean);

  return [...new Set([...participants, ...extras])];
}

function extractChatId(data: AnyRecord, fallbackDocId?: string): string {
  const fromFields = firstNonEmptyString([
    data.chatId,
    data.conversationId,
    data.threadId,
    data.roomId,
    data.messageThreadId,
  ]);

  if (fromFields) return fromFields;
  if (fallbackDocId) return asNonEmptyString(fallbackDocId);

  const sender = firstNonEmptyString([data.senderId, data.senderUid, data.fromUserId, data.buyerId]);
  const receiver = firstNonEmptyString([data.receiverId, data.receiverUid, data.toUserId, data.posterId, data.sellerId]);
  const postId = asNonEmptyString(data.postId);

  if (sender && receiver && postId) {
    const [a, b] = [sender, receiver].sort((left, right) => left.localeCompare(right));
    return `${a}_${b}_${postId}`;
  }

  return '';
}

function looksRelatedToUser(data: AnyRecord, userId: string): boolean {
  const userIds = extractUsers(data);
  if (userIds.includes(userId)) return true;

  const chatId = extractChatId(data);
  if (chatId && chatId.includes(userId)) return true;

  return false;
}

function getConversationKey(participants: string[], userId: string, fallbackChatId: string): string {
  const otherUserId = participants.find((id) => id && id !== userId);
  if (otherUserId) return `peer:${otherUserId}`;
  return `chat:${fallbackChatId}`;
}

function buildDirectConversationId(userA: string, userB: string): string {
  const left = asNonEmptyString(userA);
  const right = asNonEmptyString(userB);
  const [minUid, maxUid] = [left, right].sort((a, b) => a.localeCompare(b));
  return `direct_${minUid}_${maxUid}`;
}

// Get user's chat list with real-time updates
export function useMarketChats(userId: string | null) {
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    const projectId =
      (firestore as any)?.app?.options?.projectId ||
      (firestore as any)?._databaseId?.projectId ||
      null;
    inboxDebug('useMarketChats:init', { userId, projectId });

    if (!userId) {
      setChats([]);
      setLoading(false);
      inboxDebug('useMarketChats:skip-no-user');
      return;
    }

    const memoryChats = memoryChatsByUser.get(userId);
    if (memoryChats && memoryChats.length > 0) {
      setChats(memoryChats);
      setLoading(false);
    }

    const cacheKey = `market_chats_${userId}`;
    (async () => {
      const cached = await getCachedData<any[]>(cacheKey);
      if (!isMounted || !cached || cached.length === 0) return;
      const normalizedCached = cached.map((chat) => ({
        ...chat,
        createdAt: toDate(chat.createdAt),
        updatedAt: toDate(chat.updatedAt),
      }));
      setChats(normalizedCached);
      setLoading(false);
    })();

    setLoading(true);
    setError(null);

    const directConversationsQuery = query(
      collection(firestore, 'conversations'),
      where('participantIds', 'array-contains', userId),
      limit(250)
    );

    const chatsByParticipantsQuery = query(
      collection(firestore, 'marketChats'),
      where('participants', 'array-contains', userId),
      limit(250)
    );
    const chatsByBuyerQuery = query(
      collection(firestore, 'marketChats'),
      where('buyerId', '==', userId),
      limit(250)
    );
    const chatsByPosterQuery = query(
      collection(firestore, 'marketChats'),
      where('posterId', '==', userId),
      limit(250)
    );

    const topLevelSentMessagesQuery = query(
      collection(firestore, 'marketMessages'),
      where('senderId', '==', userId),
      limit(500)
    );
    const topLevelReceivedMessagesQuery = query(
      collection(firestore, 'marketMessages'),
      where('receiverId', '==', userId),
      limit(500)
    );
    let loadedDirectConversations = false;
    let loadedChatsByParticipants = false;
    let loadedChatsByBuyer = false;
    let loadedChatsByPoster = false;
    let loadedTopLevelSent = false;
    let loadedTopLevelReceived = false;

    let directConversations: any[] = [];
    let chatsFromParticipants: any[] = [];
    let chatsFromBuyer: any[] = [];
    let chatsFromPoster: any[] = [];
    let topLevelSentMessages: any[] = [];
    let topLevelReceivedMessages: any[] = [];
    const previousDirectUnreadState = new Map<
      string,
      { unreadCount: number; lastMessageId: string; lastReadMessageId: string }
    >();

    const mergeChats = () => {
      const chatMap = new Map<string, any>();

      directConversations.forEach((conversation) => {
        const conversationId = asNonEmptyString(conversation.id || conversation.chatId);
        if (!conversationId) return;

        const participants = Array.isArray(conversation.participantIds)
          ? conversation.participantIds.map((value: unknown) => asNonEmptyString(value)).filter(Boolean)
          : [];
        if (!participants.includes(userId)) return;

        const lastMessage = conversation.lastMessage || {};
        const unreadCountByUser = conversation.unreadCountByUser || {};
        const lastReadByUser = conversation.lastReadMessageIdByUser || {};
        const explicitUnreadCount = Number(unreadCountByUser[userId] || 0);
        let fallbackUnreadCount = 0;
        const lastMessageId = asNonEmptyString(lastMessage?.id);
        const lastMessageSenderId = asNonEmptyString(lastMessage?.senderId);
        const lastReadMessageId = asNonEmptyString(lastReadByUser[userId]);
        const previous = previousDirectUnreadState.get(conversationId);
        if (
          explicitUnreadCount <= 0 &&
          lastMessageId &&
          lastMessageSenderId &&
          lastMessageSenderId !== userId &&
          lastReadMessageId !== lastMessageId
        ) {
          if (
            previous &&
            previous.lastReadMessageId === lastReadMessageId &&
            previous.lastMessageId &&
            previous.lastMessageId !== lastMessageId
          ) {
            fallbackUnreadCount = Math.max(1, Number(previous.unreadCount || 0) + 1);
          } else {
            fallbackUnreadCount = Math.max(1, Number(previous?.unreadCount || 0));
          }
        }
        const unreadCount = Math.max(explicitUnreadCount, fallbackUnreadCount);

        chatMap.set(conversationId, {
          ...conversation,
          id: conversationId,
          chatId: conversationId,
          participants,
          lastMessage: firstNonEmptyString([lastMessage.text, conversation.lastMessageText]),
          updatedAt: toDate(conversation.updatedAt || lastMessage.createdAt || conversation.createdAt),
          createdAt: toDate(conversation.createdAt || conversation.updatedAt || lastMessage.createdAt),
          unreadCount,
          isDirectConversation: true,
        });
      });

      [...chatsFromParticipants, ...chatsFromBuyer, ...chatsFromPoster].forEach((chat) => {
        const chatId = extractChatId(chat, chat.id);
        if (!chatId || !looksRelatedToUser(chat, userId)) return;

        const participants = extractUsers(chat);
        const existing = chatMap.get(chatId);
        const next = {
          ...chat,
          id: chatId,
          chatId,
          participants,
          postId: firstNonEmptyString([chat.postId, chat.marketPostId]),
          lastMessage: extractMessageText(chat),
          posterName: firstNonEmptyString([chat.posterName, chat.sellerName]),
          otherParticipantName: firstNonEmptyString([
            chat.otherParticipantName,
            chat.receiverName,
            chat.buyerName,
            chat.customerName,
          ]),
          updatedAt: toDate(chat.updatedAt || chat.lastMessageAt || chat.createdAt),
          createdAt: toDate(chat.createdAt || chat.updatedAt || chat.lastMessageAt),
          unreadCount: Number(chat.unreadCount || 0),
        };

        if (existing) {
          const mergedUnread = Math.max(Number(existing.unreadCount || 0), Number(next.unreadCount || 0));
          const existingUpdatedAt = toDate(existing.updatedAt).getTime();
          const nextUpdatedAt = toDate(next.updatedAt).getTime();
          chatMap.set(chatId, {
            ...(nextUpdatedAt >= existingUpdatedAt ? { ...existing, ...next } : { ...next, ...existing }),
            unreadCount: mergedUnread,
            participants:
              Array.isArray(existing.participants) && existing.participants.length > 0
                ? existing.participants
                : next.participants,
          });
          return;
        }

        chatMap.set(chatId, next);
      });

      const consumeMessage = (data: any) => {
        if (!looksRelatedToUser(data, userId)) return;

        const chatId = extractChatId(data);
        if (!chatId) return;
        const messageDate = toDate(data.createdAt || data.updatedAt);
        const senderId = firstNonEmptyString([data.senderId, data.senderUid, data.fromUserId, data.buyerId]);
        const receiverId = firstNonEmptyString([
          data.receiverId,
          data.receiverUid,
          data.toUserId,
          data.posterId,
          data.sellerId,
        ]);
        const messageText = extractMessageText(data);
        const postId = firstNonEmptyString([data.postId, data.marketPostId]);
        const participants = extractUsers(data);
        const senderName = firstNonEmptyString([data.senderName, data.fromName, data.authorName]);
        const receiverName = firstNonEmptyString([data.receiverName, data.toName]);
        const isUnreadForMe = receiverId === userId && data.read !== true;

        const existing = chatMap.get(chatId) || {
          id: chatId,
          chatId,
          participants,
          postId: postId || undefined,
          lastMessage: '',
          updatedAt: messageDate,
          createdAt: messageDate,
          unreadCount: 0,
          otherParticipantName: '',
        };

        const currentUpdatedAt = toDate(existing.updatedAt);
        if (messageDate.getTime() >= currentUpdatedAt.getTime()) {
          existing.lastMessage = messageText || existing.lastMessage;
          existing.updatedAt = messageDate;
          existing.postId = existing.postId || postId || undefined;
        }

        if (!existing.participants || existing.participants.length === 0) {
          existing.participants = participants.length ? participants : [senderId, receiverId].filter(Boolean);
        }

        if (!existing.otherParticipantName) {
          if (senderId === userId && receiverName) {
            existing.otherParticipantName = receiverName;
          } else if (receiverId === userId && senderName) {
            existing.otherParticipantName = senderName;
          }
        }

        if (isUnreadForMe) {
          existing.unreadCount = Number(existing.unreadCount || 0) + 1;
        }

        chatMap.set(chatId, existing);
      };

      topLevelSentMessages.forEach(consumeMessage);
      topLevelReceivedMessages.forEach(consumeMessage);

      const mergedByChat = [...chatMap.values()].sort(
        (a, b) => toDate(b.updatedAt).getTime() - toDate(a.updatedAt).getTime()
      );
      const conversationMap = new Map<string, any>();
      mergedByChat.forEach((chat) => {
        const participants = Array.isArray(chat.participants) ? chat.participants : [];
        const key = getConversationKey(participants, userId, String(chat.id || chat.chatId || ''));
        const existing = conversationMap.get(key);

        if (!existing) {
          conversationMap.set(key, {
            ...chat,
            unreadCount: Number(chat.unreadCount || 0),
            chatIds: [chat.id || chat.chatId].filter(Boolean),
          });
          return;
        }

        existing.unreadCount = Number(existing.unreadCount || 0) + Number(chat.unreadCount || 0);
        const currentIds = Array.isArray(existing.chatIds) ? existing.chatIds : [];
        if (chat.id || chat.chatId) {
          currentIds.push(chat.id || chat.chatId);
        }
        existing.chatIds = [...new Set(currentIds)];

        const existingUpdated = toDate(existing.updatedAt).getTime();
        const candidateUpdated = toDate(chat.updatedAt).getTime();
        if (candidateUpdated > existingUpdated) {
          existing.id = chat.id || chat.chatId || existing.id;
          existing.chatId = chat.chatId || chat.id || existing.chatId;
          existing.lastMessage = chat.lastMessage || existing.lastMessage;
          existing.updatedAt = chat.updatedAt;
          existing.postId = chat.postId || existing.postId;
          existing.participants = participants.length ? participants : existing.participants;
        }
      });

      const conversations = [...conversationMap.values()].sort(
        (a, b) => toDate(b.updatedAt).getTime() - toDate(a.updatedAt).getTime()
      );
      previousDirectUnreadState.clear();
      conversations.forEach((item) => {
        const conversationId = asNonEmptyString(item.id || item.chatId);
        if (!conversationId.startsWith('direct_')) return;
        const lastMessage = (item as any)?.lastMessage || {};
        const lastReadByUser = (item as any)?.lastReadMessageIdByUser || {};
        previousDirectUnreadState.set(conversationId, {
          unreadCount: Number((item as any)?.unreadCount || 0),
          lastMessageId: asNonEmptyString(lastMessage?.id),
          lastReadMessageId: asNonEmptyString(lastReadByUser[userId]),
        });
      });
      setChats(conversations);
      memoryChatsByUser.set(userId, conversations);
      cacheData(cacheKey, conversations, MARKET_CHATS_CACHE_TTL_MS).catch(() => {});
      inboxDebug('mergeChats:result', {
        source: {
          directConversations: directConversations.length,
          chatsParticipants: chatsFromParticipants.length,
          chatsBuyer: chatsFromBuyer.length,
          chatsPoster: chatsFromPoster.length,
          topLevelSent: topLevelSentMessages.length,
          topLevelReceived: topLevelReceivedMessages.length,
        },
        conversations: conversations.length,
        conversationIds: conversations.slice(0, 8).map((item) => item.id || item.chatId),
      });

      if (
        loadedDirectConversations &&
        loadedChatsByParticipants &&
        loadedChatsByBuyer &&
        loadedChatsByPoster &&
        loadedTopLevelSent &&
        loadedTopLevelReceived
      ) {
        setLoading(false);
        inboxDebug('mergeChats:all-streams-loaded');
      }
    };

    const normalizeDocs = (snapshot: any) =>
      snapshot.docs.map((docItem: any) => ({
        ...docItem.data(),
        id: docItem.id,
        __path: docItem.ref?.path,
      }));

    const unsubscribeDirectConversations: Unsubscribe = onSnapshot(
      directConversationsQuery,
      (snapshot) => {
        const docs = normalizeDocs(snapshot);
        directConversations = docs;
        loadedDirectConversations = true;
        mergeChats();
      },
      () => {
        loadedDirectConversations = true;
        mergeChats();
      }
    );

    const unsubscribeChatsByParticipants: Unsubscribe = onSnapshot(
      chatsByParticipantsQuery,
      (snapshot) => {
        const docs = normalizeDocs(snapshot);
        chatsFromParticipants = docs;
        loadedChatsByParticipants = true;
        inboxDebug('snapshot:chatsByParticipants', {
          count: docs.length,
          ids: docs.slice(0, 6).map((doc: any) => doc.id),
        });
        mergeChats();
        setError(null);
      },
      (err) => {
        console.error('Error fetching market chats by participants:', err);
        inboxDebugError('snapshot:chatsByParticipants:error', err);
        setError(err);
        loadedChatsByParticipants = true;
        mergeChats();
      }
    );

    const unsubscribeChatsByBuyer: Unsubscribe = onSnapshot(
      chatsByBuyerQuery,
      (snapshot) => {
        const docs = normalizeDocs(snapshot);
        chatsFromBuyer = docs;
        loadedChatsByBuyer = true;
        inboxDebug('snapshot:chatsByBuyer', {
          count: docs.length,
          ids: docs.slice(0, 6).map((doc: any) => doc.id),
        });
        mergeChats();
      },
      (err) => {
        inboxDebugError('snapshot:chatsByBuyer:error', err);
        loadedChatsByBuyer = true;
        mergeChats();
      }
    );

    const unsubscribeChatsByPoster: Unsubscribe = onSnapshot(
      chatsByPosterQuery,
      (snapshot) => {
        const docs = normalizeDocs(snapshot);
        chatsFromPoster = docs;
        loadedChatsByPoster = true;
        inboxDebug('snapshot:chatsByPoster', {
          count: docs.length,
          ids: docs.slice(0, 6).map((doc: any) => doc.id),
        });
        mergeChats();
      },
      (err) => {
        inboxDebugError('snapshot:chatsByPoster:error', err);
        loadedChatsByPoster = true;
        mergeChats();
      }
    );

    const unsubscribeTopLevelSent: Unsubscribe = onSnapshot(
      topLevelSentMessagesQuery,
      (snapshot) => {
        const docs = normalizeDocs(snapshot);
        topLevelSentMessages = docs;
        loadedTopLevelSent = true;
        inboxDebug('snapshot:topLevelSentMessages', {
          count: docs.length,
          chatIds: docs.slice(0, 6).map((doc: any) => doc.chatId),
        });
        mergeChats();
      },
      (err) => {
        inboxDebugError('snapshot:topLevelSentMessages:error', err);
        loadedTopLevelSent = true;
        mergeChats();
      }
    );

    const unsubscribeTopLevelReceived: Unsubscribe = onSnapshot(
      topLevelReceivedMessagesQuery,
      (snapshot) => {
        const docs = normalizeDocs(snapshot);
        topLevelReceivedMessages = docs;
        loadedTopLevelReceived = true;
        inboxDebug('snapshot:topLevelReceivedMessages', {
          count: docs.length,
          chatIds: docs.slice(0, 6).map((doc: any) => doc.chatId),
        });
        mergeChats();
      },
      (err) => {
        inboxDebugError('snapshot:topLevelReceivedMessages:error', err);
        loadedTopLevelReceived = true;
        mergeChats();
      }
    );

    return () => {
      isMounted = false;
      inboxDebug('useMarketChats:cleanup');
      unsubscribeDirectConversations();
      unsubscribeChatsByParticipants();
      unsubscribeChatsByBuyer();
      unsubscribeChatsByPoster();
      unsubscribeTopLevelSent();
      unsubscribeTopLevelReceived();
    };
  }, [userId]);

  return { chats, loading, error };
}

// Get metadata for a single market chat
export function useMarketChatMeta(chatId: string | null) {
  const [chat, setChat] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!chatId) {
      setChat(null);
      setLoading(false);
      setError(null);
      return;
    }

    const shouldReadConversationDoc = String(chatId).startsWith('direct_');
    let loadedConversationDirect = !shouldReadConversationDoc;
    let loadedDirect = shouldReadConversationDoc;
    let loadedFallback = shouldReadConversationDoc;
    let conversationDirect: any | null = null;
    let directChat: any | null = null;
    let fallbackChat: any | null = null;

    const syncState = () => {
      const next = conversationDirect || directChat || fallbackChat;
      setChat(next);
      if (loadedConversationDirect && loadedDirect && loadedFallback) {
        setLoading(false);
      }
    };

    const unsubscribeConversationDirect: Unsubscribe = shouldReadConversationDoc
      ? onSnapshot(
          doc(firestore, 'conversations', chatId),
          (snapshot) => {
            loadedConversationDirect = true;
            if (snapshot.exists()) {
              const data = snapshot.data();
              conversationDirect = {
                id: snapshot.id,
                chatId: snapshot.id,
                ...data,
                participants: Array.isArray(data.participantIds) ? data.participantIds : data.participants,
                updatedAt: toDate(data.updatedAt || data.lastMessage?.createdAt || data.createdAt),
                createdAt: toDate(data.createdAt || data.updatedAt || data.lastMessage?.createdAt),
                lastMessage: firstNonEmptyString([data.lastMessage?.text, data.lastMessageText]),
                unreadCountByUser: data.unreadCountByUser || {},
              };
            } else {
              conversationDirect = null;
            }
            setError(null);
            syncState();
          },
          () => {
            loadedConversationDirect = true;
            syncState();
          }
        )
      : () => {};

    const unsubscribeDirect: Unsubscribe = shouldReadConversationDoc
      ? () => {}
      : onSnapshot(
          doc(firestore, 'marketChats', chatId),
          (snapshot) => {
            loadedDirect = true;
            if (snapshot.exists()) {
              const data = snapshot.data();
              directChat = {
                id: snapshot.id,
                ...data,
                updatedAt: data.updatedAt?.toDate?.() || new Date(),
                createdAt: data.createdAt?.toDate?.() || new Date(),
              };
            } else {
              directChat = null;
            }
            setError(null);
            syncState();
          },
          (err) => {
            console.error('Error fetching market chat:', err);
            loadedDirect = true;
            setError(err);
            syncState();
          }
        );

    const fallbackQuery = shouldReadConversationDoc
      ? null
      : query(
          collection(firestore, 'marketChats'),
          where('chatId', '==', chatId),
          limit(1)
        );

    const unsubscribeFallback: Unsubscribe =
      shouldReadConversationDoc || !fallbackQuery
        ? () => {}
        : onSnapshot(
            fallbackQuery,
            (snapshot) => {
              loadedFallback = true;
              if (!snapshot.empty) {
                const first = snapshot.docs[0];
                const data = first.data();
                fallbackChat = {
                  id: asNonEmptyString(data.chatId) || first.id,
                  ...data,
                  updatedAt: toDate(data.updatedAt || data.lastMessageAt || data.createdAt),
                  createdAt: toDate(data.createdAt || data.updatedAt || data.lastMessageAt),
                };
              } else {
                fallbackChat = null;
              }
              syncState();
            },
            () => {
              loadedFallback = true;
              syncState();
            }
          );

    return () => {
      unsubscribeConversationDirect();
      unsubscribeDirect();
      unsubscribeFallback();
    };
  }, [chatId]);

  return { chat, loading, error };
}

// Get messages for a specific chat with real-time updates
export function useMarketChat(chatId: string | null) {
  const [messages, setMessages] = useState<MarketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!chatId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    const memoryMessages = memoryChatMessagesById.get(chatId);
    if (memoryMessages && memoryMessages.length > 0) {
      setMessages(memoryMessages);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }
    setError(null);

    const cacheKey = `market_chat_messages_${chatId}`;
    (async () => {
      const cached = await getCachedData<MarketMessage[]>(cacheKey);
      if (!isMounted || !cached || cached.length === 0) return;
      const normalizedCached = cached.map((item) => ({
        ...item,
        createdAt: toDate((item as any).createdAt),
      }));
      setMessages(normalizedCached);
      setLoading(false);
    })();

    // Primary and legacy chat-id field listeners to support older function payloads.
    const qByChatId = query(
      collection(firestore, 'marketMessages'),
      where('chatId', '==', chatId)
    );
    const qByConversationId = query(
      collection(firestore, 'marketMessages'),
      where('conversationId', '==', chatId)
    );
    const qByThreadId = query(
      collection(firestore, 'marketMessages'),
      where('threadId', '==', chatId)
    );
    const qConversationSubcollection = query(
      collection(firestore, 'conversations', chatId, 'messages'),
      limit(1000)
    );
    const qLegacySubcollection = query(
      collection(firestore, 'marketChats', chatId, 'messages')
    );
    const qParentByChatId = query(
      collection(firestore, 'marketChats'),
      where('chatId', '==', chatId),
      limit(25)
    );
    const qParentByConversationId = query(
      collection(firestore, 'marketChats'),
      where('conversationId', '==', chatId),
      limit(25)
    );
    const qParentByThreadId = query(
      collection(firestore, 'marketChats'),
      where('threadId', '==', chatId),
      limit(25)
    );

    let loadedMain = false;
    let loadedConversation = false;
    let loadedThread = false;
    let loadedConversationSubcollection = false;
    let loadedLegacySubcollection = false;
    let loadedParentByChatId = false;
    let loadedParentByConversationId = false;
    let loadedParentByThreadId = false;
    let mainDocs: AnyRecord[] = [];
    let conversationDocs: AnyRecord[] = [];
    let threadDocs: AnyRecord[] = [];
    let conversationSubcollectionDocs: AnyRecord[] = [];
    let legacySubcollectionDocs: AnyRecord[] = [];
    let resolvedParentSubcollectionDocs: AnyRecord[] = [];
    let parentDocIdsByChatId: string[] = [];
    let parentDocIdsByConversationId: string[] = [];
    let parentDocIdsByThreadId: string[] = [];
    let parentSubcollectionUnsubscribers: Unsubscribe[] = [];
    const parentSubcollectionDocsMap = new Map<string, AnyRecord[]>();

    const markLoadedIfReady = () => {
      if (
        loadedMain &&
        loadedConversation &&
        loadedThread &&
        loadedConversationSubcollection &&
        loadedLegacySubcollection &&
        loadedParentByChatId &&
        loadedParentByConversationId &&
        loadedParentByThreadId
      ) {
        setLoading(false);
      }
    };

    const mergeMessages = () => {
      const mergedById = new Map<string, AnyRecord>();

      [
        ...mainDocs,
        ...conversationDocs,
        ...threadDocs,
        ...conversationSubcollectionDocs,
        ...legacySubcollectionDocs,
        ...resolvedParentSubcollectionDocs,
      ].forEach((item) => {
        const dedupeKey = firstNonEmptyString([
          asNonEmptyString(item.__path),
          asNonEmptyString(item.id),
          `${extractChatId(item)}_${toDate(item.createdAt || item.updatedAt).getTime()}_${firstNonEmptyString([
            item.senderId,
            item.senderUid,
            item.fromUserId,
            item.buyerId,
          ])}`,
        ]);
        if (!dedupeKey) return;
        mergedById.set(dedupeKey, item);
      });

      const normalized = [...mergedById.values()]
        .map((data): MarketMessage => ({
          id: firstNonEmptyString([
            asNonEmptyString(data.id),
            asNonEmptyString(data.clientMessageId),
            `${extractChatId(data)}_${toDate(data.createdAt || data.updatedAt).getTime()}_${firstNonEmptyString([
              data.senderId,
              data.senderUid,
              data.fromUserId,
              data.buyerId,
            ])}`,
          ]),
          chatId: asNonEmptyString(data.chatId) || asNonEmptyString(data.conversationId) || asNonEmptyString(data.threadId) || chatId,
          senderId: firstNonEmptyString([data.senderId, data.senderUid, data.fromUserId, data.buyerId]),
          receiverId: firstNonEmptyString([
            data.receiverId,
            data.receiverUid,
            data.toUserId,
            data.posterId,
            data.sellerId,
          ]),
          postId: firstNonEmptyString([data.postId, data.marketPostId]),
          type: data.type,
          clientMessageId: asNonEmptyString(data.clientMessageId),
          message: extractMessageText(data),
          imageUrl: data.imageUrl,
          paymentLink: data.paymentLink,
          quoteCard: data.quoteCard,
          read: Boolean(data.read),
          createdAt: toDate(data.createdAt || data.updatedAt),
        }))
        .sort((left, right) => toDate(left.createdAt).getTime() - toDate(right.createdAt).getTime());

      setMessages(normalized);
      memoryChatMessagesById.set(chatId, normalized);
      cacheData(cacheKey, normalized, MARKET_CHAT_MESSAGES_CACHE_TTL_MS).catch(() => {});
      markLoadedIfReady();
    };

    const refreshParentSubcollectionListeners = () => {
      const resolvedParentIds = [
        ...new Set([
          ...parentDocIdsByChatId,
          ...parentDocIdsByConversationId,
          ...parentDocIdsByThreadId,
        ]),
      ].filter((docId) => docId && docId !== chatId);

      parentSubcollectionUnsubscribers.forEach((unsubscribe) => unsubscribe());
      parentSubcollectionUnsubscribers = [];
      parentSubcollectionDocsMap.clear();
      resolvedParentSubcollectionDocs = [];

      if (resolvedParentIds.length === 0) {
        mergeMessages();
        markLoadedIfReady();
        return;
      }

      resolvedParentIds.forEach((parentDocId) => {
        const unsubscribe = onSnapshot(
          query(collection(firestore, 'marketChats', parentDocId, 'messages')),
          (snapshot) => {
            const docs = snapshot.docs.map((docItem) => ({
              ...docItem.data(),
              id: docItem.id,
              chatId,
              __path: docItem.ref?.path,
            }));
            parentSubcollectionDocsMap.set(parentDocId, docs);
            resolvedParentSubcollectionDocs = [...parentSubcollectionDocsMap.values()].flat();
            mergeMessages();
          },
          () => {
            parentSubcollectionDocsMap.set(parentDocId, []);
            resolvedParentSubcollectionDocs = [...parentSubcollectionDocsMap.values()].flat();
            mergeMessages();
          }
        );
        parentSubcollectionUnsubscribers.push(unsubscribe);
      });
    };

    const unsubscribeMain: Unsubscribe = onSnapshot(
      qByChatId,
      (snapshot) => {
        mainDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          __path: docItem.ref?.path,
        }));
        loadedMain = true;
        setError(null);
        mergeMessages();
      },
      (err) => {
        console.error('Error fetching market chat messages:', err);
        setError(err);
        loadedMain = true;
        mergeMessages();
      }
    );

    const unsubscribeConversation: Unsubscribe = onSnapshot(
      qByConversationId,
      (snapshot) => {
        conversationDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          __path: docItem.ref?.path,
        }));
        loadedConversation = true;
        mergeMessages();
      },
      () => {
        loadedConversation = true;
        mergeMessages();
      }
    );

    const unsubscribeThread: Unsubscribe = onSnapshot(
      qByThreadId,
      (snapshot) => {
        threadDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          __path: docItem.ref?.path,
        }));
        loadedThread = true;
        mergeMessages();
      },
      () => {
        loadedThread = true;
        mergeMessages();
      }
    );

    const unsubscribeLegacySubcollection: Unsubscribe = onSnapshot(
      qLegacySubcollection,
      (snapshot) => {
        legacySubcollectionDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          chatId,
          __path: docItem.ref?.path,
        }));
        loadedLegacySubcollection = true;
        mergeMessages();
      },
      (err) => {
        // Some rulesets block this direct path if doc ID != chatId.
        // Do not hard-fail the thread when fallback parent listeners can still load messages.
        if (err?.code && err.code !== 'permission-denied') {
          setError(err);
        }
        loadedLegacySubcollection = true;
        mergeMessages();
      }
    );

    const unsubscribeConversationSubcollection: Unsubscribe = onSnapshot(
      qConversationSubcollection,
      (snapshot) => {
        conversationSubcollectionDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          chatId,
          __path: docItem.ref?.path,
        }));
        loadedConversationSubcollection = true;
        mergeMessages();
      },
      () => {
        loadedConversationSubcollection = true;
        mergeMessages();
      }
    );

    const unsubscribeParentByChatId: Unsubscribe = onSnapshot(
      qParentByChatId,
      (snapshot) => {
        parentDocIdsByChatId = snapshot.docs.map((docItem) => docItem.id);
        loadedParentByChatId = true;
        refreshParentSubcollectionListeners();
        markLoadedIfReady();
      },
      () => {
        loadedParentByChatId = true;
        refreshParentSubcollectionListeners();
        markLoadedIfReady();
      }
    );

    const unsubscribeParentByConversationId: Unsubscribe = onSnapshot(
      qParentByConversationId,
      (snapshot) => {
        parentDocIdsByConversationId = snapshot.docs.map((docItem) => docItem.id);
        loadedParentByConversationId = true;
        refreshParentSubcollectionListeners();
        markLoadedIfReady();
      },
      () => {
        loadedParentByConversationId = true;
        refreshParentSubcollectionListeners();
        markLoadedIfReady();
      }
    );

    const unsubscribeParentByThreadId: Unsubscribe = onSnapshot(
      qParentByThreadId,
      (snapshot) => {
        parentDocIdsByThreadId = snapshot.docs.map((docItem) => docItem.id);
        loadedParentByThreadId = true;
        refreshParentSubcollectionListeners();
        markLoadedIfReady();
      },
      () => {
        loadedParentByThreadId = true;
        refreshParentSubcollectionListeners();
        markLoadedIfReady();
      }
    );

    return () => {
      isMounted = false;
      unsubscribeMain();
      unsubscribeConversation();
      unsubscribeThread();
      unsubscribeConversationSubcollection();
      unsubscribeLegacySubcollection();
      unsubscribeParentByChatId();
      unsubscribeParentByConversationId();
      unsubscribeParentByThreadId();
      parentSubcollectionUnsubscribers.forEach((unsubscribe) => unsubscribe());
      parentSubcollectionUnsubscribers = [];
    };
  }, [chatId]);

  return { messages, loading, error };
}

// Get full conversation messages between two users (across chat sessions)
export function useMarketConversationMessages(userId: string | null, peerId: string | null) {
  const [messages, setMessages] = useState<MarketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!userId || !peerId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    const directConversationId = buildDirectConversationId(userId, peerId);
    const memoryConversationMessages = memoryConversationMessagesById.get(directConversationId);
    if (memoryConversationMessages && memoryConversationMessages.length > 0) {
      setMessages(memoryConversationMessages);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }
    setError(null);
    const cacheKey = `market_conversation_messages_${directConversationId}`;

    (async () => {
      const cached = await getCachedData<MarketMessage[]>(cacheKey);
      if (!isMounted || !cached || cached.length === 0) return;
      const normalizedCached = cached.map((item) => ({
        ...item,
        createdAt: toDate((item as any).createdAt),
      }));
      setMessages(normalizedCached);
      setLoading(false);
    })();

    const sentQuery = query(
      collection(firestore, 'marketMessages'),
      where('senderId', '==', userId),
      limit(1000)
    );
    const receivedQuery = query(
      collection(firestore, 'marketMessages'),
      where('receiverId', '==', userId),
      limit(1000)
    );
    const relatedChatsQuery = query(
      collection(firestore, 'marketChats'),
      where('participants', 'array-contains', userId),
      limit(300)
    );
    const directConversationMessagesQuery = query(
      collection(firestore, 'conversations', directConversationId, 'messages'),
      limit(1000)
    );

    let loadedDirectConversation = false;
    let loadedSent = false;
    let loadedReceived = false;
    let loadedChats = false;
    let directConversationDocs: AnyRecord[] = [];
    let sentDocs: AnyRecord[] = [];
    let receivedDocs: AnyRecord[] = [];
    let relatedChatParticipantsById = new Map<string, string[]>();
    const subcollectionDocsByParent = new Map<string, AnyRecord[]>();
    let subcollectionUnsubs: Unsubscribe[] = [];

    const setLoaded = () => {
      if (loadedDirectConversation && loadedSent && loadedReceived && loadedChats) {
        setLoading(false);
      }
    };

    const mergeAll = () => {
      const subDocs = [...subcollectionDocsByParent.values()].flat();
      const mergedByKey = new Map<string, AnyRecord>();

      [...directConversationDocs, ...sentDocs, ...receivedDocs, ...subDocs].forEach((item) => {
        const users = extractUsers(item);
        const parentParticipants = Array.isArray(item.__participants)
          ? item.__participants.map((value: unknown) => asNonEmptyString(value)).filter(Boolean)
          : [];
        const isBetweenParticipants =
          (parentParticipants.includes(userId) && parentParticipants.includes(peerId)) ||
          (users.includes(userId) && users.includes(peerId)) ||
          (firstNonEmptyString([item.senderId]) === userId &&
            firstNonEmptyString([item.receiverId]) === peerId) ||
          (firstNonEmptyString([item.senderId]) === peerId &&
            firstNonEmptyString([item.receiverId]) === userId);

        if (!isBetweenParticipants) return;

        const key = firstNonEmptyString([
          asNonEmptyString(item.__path),
          asNonEmptyString(item.id),
          `${extractChatId(item)}_${toDate(item.createdAt || item.updatedAt).getTime()}_${firstNonEmptyString([
            item.senderId,
            item.senderUid,
            item.fromUserId,
            item.buyerId,
          ])}`,
        ]);
        if (!key) return;
        mergedByKey.set(key, item);
      });

      const normalized = [...mergedByKey.values()]
        .map((data): MarketMessage => ({
          id: firstNonEmptyString([
            asNonEmptyString(data.id),
            asNonEmptyString(data.clientMessageId),
            `${extractChatId(data)}_${toDate(data.createdAt || data.updatedAt).getTime()}_${firstNonEmptyString([
              data.senderId,
              data.senderUid,
              data.fromUserId,
              data.buyerId,
            ])}`,
          ]),
          chatId:
            asNonEmptyString(data.chatId) ||
            asNonEmptyString(data.conversationId) ||
            asNonEmptyString(data.threadId) ||
            '',
          senderId: firstNonEmptyString([data.senderId, data.senderUid, data.fromUserId, data.buyerId]),
          receiverId: firstNonEmptyString([
            data.receiverId,
            data.receiverUid,
            data.toUserId,
            data.posterId,
            data.sellerId,
          ]),
          postId: firstNonEmptyString([data.postId, data.marketPostId]),
          type: data.type,
          clientMessageId: asNonEmptyString(data.clientMessageId),
          message: extractMessageText(data),
          imageUrl: data.imageUrl,
          paymentLink: data.paymentLink,
          quoteCard: data.quoteCard,
          read: Boolean(data.read),
          createdAt: toDate(data.createdAt || data.updatedAt),
        }))
        .sort((left, right) => toDate(left.createdAt).getTime() - toDate(right.createdAt).getTime());

      setMessages(normalized);
      memoryConversationMessagesById.set(directConversationId, normalized);
      cacheData(cacheKey, normalized, MARKET_CHAT_MESSAGES_CACHE_TTL_MS).catch(() => {});
      setLoaded();
    };

    const resubscribeSubcollections = (parentIds: string[]) => {
      subcollectionUnsubs.forEach((unsub) => unsub());
      subcollectionUnsubs = [];
      subcollectionDocsByParent.clear();

      if (parentIds.length === 0) {
        mergeAll();
        setLoaded();
        return;
      }

      parentIds.forEach((parentId) => {
        const unsub = onSnapshot(
          query(collection(firestore, 'marketChats', parentId, 'messages')),
          (snapshot) => {
            subcollectionDocsByParent.set(
              parentId,
              snapshot.docs.map((docItem) => ({
                ...docItem.data(),
                id: docItem.id,
                __participants: relatedChatParticipantsById.get(parentId) || [],
                __path: docItem.ref?.path,
              }))
            );
            mergeAll();
          },
          () => {
            subcollectionDocsByParent.set(parentId, []);
            mergeAll();
          }
        );
        subcollectionUnsubs.push(unsub);
      });
    };

    const unsubscribeSent = onSnapshot(
      sentQuery,
      (snapshot) => {
        sentDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          __path: docItem.ref?.path,
        }));
        loadedSent = true;
        mergeAll();
      },
      (err) => {
        loadedSent = true;
        setError(err);
        mergeAll();
      }
    );

    const unsubscribeDirectConversation = onSnapshot(
      directConversationMessagesQuery,
      (snapshot) => {
        directConversationDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          chatId: directConversationId,
          __path: docItem.ref?.path,
        }));
        loadedDirectConversation = true;
        mergeAll();
      },
      () => {
        loadedDirectConversation = true;
        mergeAll();
      }
    );

    const unsubscribeReceived = onSnapshot(
      receivedQuery,
      (snapshot) => {
        receivedDocs = snapshot.docs.map((docItem) => ({
          ...docItem.data(),
          id: docItem.id,
          __path: docItem.ref?.path,
        }));
        loadedReceived = true;
        mergeAll();
      },
      (err) => {
        loadedReceived = true;
        setError(err);
        mergeAll();
      }
    );

    const unsubscribeRelatedChats = onSnapshot(
      relatedChatsQuery,
      (snapshot) => {
        const parentIds = snapshot.docs
          .filter((docItem) => {
            const data = docItem.data();
            const participants = extractUsers(data);
            return participants.includes(peerId);
          })
          .map((docItem) => docItem.id);
        relatedChatParticipantsById = new Map(
          snapshot.docs.map((docItem) => {
            const participants = extractUsers(docItem.data());
            return [docItem.id, participants] as [string, string[]];
          })
        );

        loadedChats = true;
        resubscribeSubcollections(parentIds);
        mergeAll();
      },
      (err) => {
        loadedChats = true;
        setError(err);
        mergeAll();
      }
    );

    return () => {
      isMounted = false;
      unsubscribeDirectConversation();
      unsubscribeSent();
      unsubscribeReceived();
      unsubscribeRelatedChats();
      subcollectionUnsubs.forEach((unsub) => unsub());
      subcollectionUnsubs = [];
    };
  }, [userId, peerId]);

  return { messages, loading, error };
}

