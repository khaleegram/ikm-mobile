// Market Message API - conversation-first with legacy fallback
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { auth, firestore } from '@/lib/firebase/config';
import { parseMarketOfferLink } from '@/lib/utils/market-offer-link';
import { queueWrite, removeQueuedWrite } from '@/lib/utils/offline';

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

function buildQueuedMessageWriteId(chatId: string, clientMessageId: string): string {
  const normalizedChatId = asNonEmptyString(chatId);
  const normalizedClientId = asNonEmptyString(clientMessageId);
  return `marketMessage:${normalizedChatId}:${normalizedClientId}`;
}

async function assertNotBlockedByCurrentUser(currentUserId: string, otherUserId: string): Promise<void> {
  const blockerId = asNonEmptyString(currentUserId);
  const blockedId = asNonEmptyString(otherUserId);
  if (!blockerId || !blockedId) return;
  const blockRef = doc(firestore, 'marketBlocks', `${blockerId}_${blockedId}`);
  const blockSnap = await getDoc(blockRef);
  if (blockSnap.exists()) {
    throw new Error('You blocked this user. Unblock them to send messages.');
  }
}

async function sendDirectConversationMessage(
  conversationId: string,
  text: string,
  imageUrl?: string,
  paymentLink?: string,
  quoteCard?: QuoteCardPayload,
  options?: { allowQueue?: boolean; clientMessageId?: string }
): Promise<{ messageId: string; queued?: boolean }> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error('Authentication required. Please log in.');
  }

  const trimmedText = text.trim();
  if (!trimmedText && !imageUrl && !paymentLink && !quoteCard) {
    throw new Error('Message, image, payment link, or quote card is required');
  }

  const senderId = currentUser.uid;
  const parsed = parseDirectConversationId(conversationId);
  const inferredOtherUserId =
    parsed?.userA === senderId ? parsed.userB : parsed?.userB === senderId ? parsed.userA : '';

  if (!inferredOtherUserId) {
    throw new Error('Unable to determine chat participants.');
  }
  await assertNotBlockedByCurrentUser(senderId, inferredOtherUserId);

  const allowQueue = options?.allowQueue !== false;
  const clientMessageId =
    asNonEmptyString(options?.clientMessageId) ||
    `cm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const queueId = buildQueuedMessageWriteId(conversationId, clientMessageId);
  const queuedPayload = {
    id: queueId,
    type: 'marketMessage' as const,
    action: 'create' as const,
    data: {
      chatId: conversationId,
      text: trimmedText,
      imageUrl: imageUrl || undefined,
      paymentLink: paymentLink || undefined,
      quoteCard: quoteCard || undefined,
      clientMessageId: clientMessageId || undefined,
    },
    timestamp: Date.now(),
  };

  let queuedForReplay = false;

  const queueForReplay = async () => {
    if (!allowQueue || queuedForReplay) return;
    await queueWrite(queuedPayload);
    queuedForReplay = true;
  };

  if (allowQueue) {
    try {
      await queueForReplay();
    } catch (queueError) {
      // Proceed with direct send attempt even if local queue write fails.
      console.error('Unable to queue outgoing message before send:', queueError);
    }
  }

  try {
    await ensureDirectConversation(senderId, inferredOtherUserId, quoteCard?.postId);

    const conversationRef = doc(firestore, 'conversations', conversationId);
    const messageRef = doc(collection(conversationRef, 'messages'));
    const isOfferMessage = Boolean(paymentLink && parseMarketOfferLink(paymentLink));
    const messageType: 'text' | 'media' | 'quote' | 'offer' = quoteCard
      ? 'quote'
      : imageUrl
      ? 'media'
      : isOfferMessage
      ? 'offer'
      : 'text';
    const messagePreview = quoteCard?.previewText || trimmedText || (isOfferMessage ? 'Offer' : imageUrl ? 'Image' : 'Message');
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
        text: trimmedText,
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
        [`lastReadMessageIdByUser.${senderId}`]: messageRef.id,
      },
      { merge: true }
    );

    await batch.commit();

    if (queuedForReplay) {
      await removeQueuedWrite(queueId);
    }

    return { messageId: messageRef.id };
  } catch (error: any) {
    if (allowQueue && shouldQueueForOffline(error)) {
      if (!queuedForReplay) {
        try {
          await queueForReplay();
        } catch (queueError) {
          console.error('Unable to queue outgoing message after failed send:', queueError);
        }
      }
      return { messageId: queueId, queued: true };
    }

    if (queuedForReplay) {
      await removeQueuedWrite(queueId).catch(() => {});
    }
    throw error;
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
    text: string,
    imageUrl?: string,
    paymentLink?: string,
    options?: { clientMessageId?: string }
  ): Promise<{ messageId: string; queued?: boolean }> => {
    const trimmedText = text.trim();
    if (!trimmedText && !imageUrl && !paymentLink) {
      throw new Error('Message, image, or payment link is required');
    }

    if (isDirectConversationId(chatId)) {
      return sendDirectConversationMessage(chatId, trimmedText, imageUrl, paymentLink, undefined, {
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
    text?: string;
    message?: string;
    imageUrl?: string;
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
      asNonEmptyString(data.text || data.message),
      data.imageUrl,
      data.paymentLink,
      data.quoteCard,
      { allowQueue: false, clientMessageId: data.clientMessageId }
    );
    return { messageId: sent.messageId };
  },

  markAsRead: async (chatId: string, lastReadMessageId: string): Promise<void> => {
    if (!isDirectConversationId(chatId)) return;

    const currentUser = auth.currentUser;
    if (!currentUser?.uid) return;

    const latestMessageId = asNonEmptyString(lastReadMessageId);
    if (!latestMessageId) return;
    const conversationRef = doc(firestore, 'conversations', chatId);

    try {
      await updateDoc(conversationRef, {
        [`lastReadMessageIdByUser.${currentUser.uid}`]: latestMessageId,
      });
    } catch (error: any) {
      const code = String(error?.code || '');
      if (code === 'not-found') return;

      // Fallback merge avoids contention failures on highly active chats.
      await setDoc(
        conversationRef,
        {
          lastReadMessageIdByUser: {
            [currentUser.uid]: latestMessageId,
          },
        },
        { merge: true }
      );
    }
  },
};
