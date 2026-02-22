// Market Message API - conversation-first with legacy fallback
import {
  collection,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { auth, firestore } from '@/lib/firebase/config';
import { queueWrite } from '@/lib/utils/offline';

const CHAT_DEBUG = false;

function chatDebug(label: string, payload?: unknown) {
  if (!CHAT_DEBUG) return;
  if (payload === undefined) {
    console.log(`[ChatDebug] ${label}`);
    return;
  }
  console.log(`[ChatDebug] ${label}`, payload);
}

function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}

export function buildDirectConversationId(userA: string, userB: string): string {
  const left = asNonEmptyString(userA);
  const right = asNonEmptyString(userB);
  const [minUid, maxUid] = [left, right].sort((a, b) => a.localeCompare(b));
  return `direct_${minUid}_${maxUid}`;
}

function parseDirectConversationId(conversationId: string): { userA: string; userB: string } | null {
  const normalized = asNonEmptyString(conversationId);
  if (!normalized.startsWith('direct_')) return null;
  const parts = normalized.split('_');
  if (parts.length !== 3) return null;
  const userA = asNonEmptyString(parts[1]);
  const userB = asNonEmptyString(parts[2]);
  if (!userA || !userB) return null;
  return { userA, userB };
}

function isDirectConversationId(conversationId: string): boolean {
  return parseDirectConversationId(conversationId) !== null;
}

export function resolveDirectConversationPeerId(
  conversationId: string,
  currentUserId: string
): string | null {
  const parsed = parseDirectConversationId(conversationId);
  if (!parsed) return null;
  if (parsed.userA === currentUserId) return parsed.userB;
  if (parsed.userB === currentUserId) return parsed.userA;
  return null;
}

async function ensureDirectConversation(
  currentUserId: string,
  otherUserId: string,
  postId?: string
): Promise<{ conversationId: string; isNew: boolean }> {
  const conversationId = buildDirectConversationId(currentUserId, otherUserId);
  const conversationRef = doc(firestore, 'conversations', conversationId);
  const parsed = parseDirectConversationId(conversationId);
  if (!parsed) {
    throw new Error('Invalid direct conversation id');
  }

  const participantIds = [parsed.userA, parsed.userB];

  try {
    const updatePayload: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };
    if (postId) {
      updatePayload.lastContextPostId = postId;
    }
    await updateDoc(conversationRef, updatePayload);
    return { conversationId, isNew: false };
  } catch (error: any) {
    const errorCode = String(error?.code || '');
    if (errorCode !== 'not-found' && errorCode !== 'permission-denied') {
      throw error;
    }

    await setDoc(
      conversationRef,
      {
        type: 'direct',
        participantIds,
        unreadCountByUser: {
          [currentUserId]: 0,
          [otherUserId]: 0,
        },
        lastReadMessageIdByUser: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(postId ? { lastContextPostId: postId } : {}),
      },
      { merge: true }
    );
    return { conversationId, isNew: true };
  }
}

type QuoteCardPayload = {
  postId: string;
  previewText: string;
  previewImage?: string;
};

function shouldQueueForOffline(error: any): boolean {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code.includes('unavailable') ||
    code.includes('network-request-failed') ||
    code.includes('deadline-exceeded') ||
    message.includes('network') ||
    message.includes('offline')
  );
}

async function sendDirectConversationMessage(
  conversationId: string,
  message: string,
  imageUrl?: string,
  paymentLink?: string,
  quoteCard?: QuoteCardPayload,
  options?: { allowQueue?: boolean; clientMessageId?: string }
): Promise<{ messageId: string; queued?: boolean }> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error('Authentication required. Please log in.');
  }

  const trimmedMessage = message.trim();
  if (!trimmedMessage && !imageUrl && !paymentLink && !quoteCard) {
    throw new Error('Message, image, payment link, or quote card is required');
  }

  const senderId = currentUser.uid;
  const parsed = parseDirectConversationId(conversationId);
  const inferredOtherUserId =
    parsed?.userA === senderId ? parsed.userB : parsed?.userB === senderId ? parsed.userA : '';

  if (!inferredOtherUserId) {
    throw new Error('Unable to determine chat participants.');
  }

  const allowQueue = options?.allowQueue !== false;

  try {
    await ensureDirectConversation(senderId, inferredOtherUserId, quoteCard?.postId);

    const conversationRef = doc(firestore, 'conversations', conversationId);
    const messageRef = doc(collection(conversationRef, 'messages'));
    const clientMessageId =
      asNonEmptyString(options?.clientMessageId) ||
      `cm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const messageType: 'text' | 'media' | 'quote' = quoteCard
      ? 'quote'
      : imageUrl
      ? 'media'
      : 'text';
    const messagePreview = quoteCard?.previewText || trimmedMessage || (imageUrl ? 'Image' : 'Message');
    const createdAt = serverTimestamp();

    const batch = writeBatch(firestore);
    batch.set(
      messageRef,
      {
        clientMessageId,
        senderId,
        receiverId: inferredOtherUserId,
        chatId: conversationId,
        type: messageType,
        text: trimmedMessage,
        message: trimmedMessage,
        ...(quoteCard ? { quoteCard, postId: quoteCard.postId } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(paymentLink ? { paymentLink } : {}),
        read: false,
        createdAt,
      },
      { merge: true }
    );

    batch.set(
      conversationRef,
      {
        updatedAt: createdAt,
        lastMessage: {
          id: messageRef.id,
          text: messagePreview,
          senderId,
          createdAt,
          type: messageType,
        },
        [`unreadCountByUser.${senderId}`]: 0,
        [`unreadCountByUser.${inferredOtherUserId}`]: increment(1),
        [`lastReadMessageIdByUser.${senderId}`]: messageRef.id,
      },
      { merge: true }
    );

    await batch.commit();
    return { messageId: messageRef.id };
  } catch (error: any) {
    if (!allowQueue || !shouldQueueForOffline(error) || Boolean(imageUrl)) {
      throw error;
    }

    const queuedId = `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await queueWrite({
      id: queuedId,
      type: 'marketMessage',
      action: 'create',
      data: {
        chatId: conversationId,
        message: trimmedMessage,
        paymentLink: paymentLink || undefined,
        quoteCard: quoteCard || undefined,
        clientMessageId: clientMessageId || undefined,
      },
      timestamp: Date.now(),
    });
    return { messageId: queuedId, queued: true };
  }
}

export const marketMessagesApi = {
  createChat: async (
    buyerId: string,
    posterId: string,
    postId?: string
  ): Promise<{ chatId: string; chat: any }> => {
    chatDebug('createChat:start', { buyerId, posterId, postId });
    const direct = await ensureDirectConversation(buyerId, posterId, postId);
    return {
      chatId: direct.conversationId,
      chat: {
        id: direct.conversationId,
        chatId: direct.conversationId,
        type: 'direct',
        participantIds: [buyerId, posterId],
      },
    };
  },

  getOrCreateConversationChat: async (
    currentUserId: string,
    otherUserId: string,
    postId?: string
  ): Promise<{ chatId: string; chat: any; isNew: boolean }> => {
    chatDebug('getOrCreateConversationChat:start', { currentUserId, otherUserId, postId });
    const created = await ensureDirectConversation(currentUserId, otherUserId, postId);
    return {
      chatId: created.conversationId,
      chat: null,
      isNew: created.isNew,
    };
  },

  sendMessage: async (
    chatId: string,
    message: string,
    imageUrl?: string,
    paymentLink?: string,
    options?: { clientMessageId?: string }
  ): Promise<{ messageId: string; queued?: boolean }> => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !imageUrl && !paymentLink) {
      throw new Error('Message, image, or payment link is required');
    }

    if (isDirectConversationId(chatId)) {
      return sendDirectConversationMessage(chatId, trimmedMessage, imageUrl, paymentLink, undefined, {
        clientMessageId: options?.clientMessageId,
      });
    }
    throw new Error('Direct conversation ID is required for market messaging.');
  },

  sendQuoteMessage: async (
    chatId: string,
    quoteCard: QuoteCardPayload,
    message: string = '',
    options?: { clientMessageId?: string }
  ): Promise<{ messageId: string; queued?: boolean }> => {
    if (!quoteCard?.postId || !quoteCard?.previewText) {
      throw new Error('Quote card requires postId and previewText.');
    }

    if (isDirectConversationId(chatId)) {
      return sendDirectConversationMessage(chatId, message, undefined, undefined, quoteCard, {
        clientMessageId: options?.clientMessageId,
      });
    }

    return marketMessagesApi.sendMessage(chatId, message || quoteCard.previewText, undefined, undefined, {
      clientMessageId: options?.clientMessageId,
    });
  },

  sendQueuedMessage: async (data: {
    chatId: string;
    message: string;
    paymentLink?: string;
    quoteCard?: QuoteCardPayload;
    clientMessageId?: string;
  }): Promise<{ messageId: string }> => {
    const chatId = asNonEmptyString(data.chatId);
    if (!isDirectConversationId(chatId)) {
      throw new Error('Direct conversation ID is required for market messaging.');
    }

    const sent = await sendDirectConversationMessage(
      chatId,
      asNonEmptyString(data.message),
      undefined,
      data.paymentLink,
      data.quoteCard,
      { allowQueue: false, clientMessageId: data.clientMessageId }
    );
    return { messageId: sent.messageId };
  },

  markAsRead: async (chatId: string, messageIds: string[]): Promise<void> => {
    if (!isDirectConversationId(chatId)) return;

    const currentUser = auth.currentUser;
    if (!currentUser?.uid) return;

    const latestMessageId = asNonEmptyString(messageIds[messageIds.length - 1] || '');
    if (!latestMessageId) return;
    const conversationRef = doc(firestore, 'conversations', chatId);

    try {
      await updateDoc(conversationRef, {
        [`unreadCountByUser.${currentUser.uid}`]: 0,
        [`lastReadMessageIdByUser.${currentUser.uid}`]: latestMessageId,
      });
    } catch (error: any) {
      const code = String(error?.code || '');
      if (code === 'not-found') return;

      // Fallback merge avoids contention failures on highly active chats.
      await setDoc(
        conversationRef,
        {
          unreadCountByUser: {
            [currentUser.uid]: 0,
          },
          lastReadMessageIdByUser: {
            [currentUser.uid]: latestMessageId,
          },
        },
        { merge: true }
      );
    }
  },
};
