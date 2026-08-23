import { router } from 'expo-router';

import { showToast } from '@/components/toast';
import { Alert } from '@/components/app-alert';
import { auth } from '@/lib/firebase/config';
import { chatApi } from '@/lib/api/chat';
import { snapshotFromMarketPost } from '@/lib/chat/enrich-inbox-snapshots';
import {
  findThreadQueryByPostAndPeer,
  getInboxItems,
  getThreadQueryData,
  migrateChatThreadQuery,
  patchInboxThread,
  patchThreadQueryData,
  replaceInboxThreadId,
  seedOptimisticThreadRoom,
  upsertInboxItem,
} from '@/lib/chat/chat-query-cache';
import {
  migrateDealRoomQuery,
  navigateToDealRoom,
  prefetchDealRoom,
  seedDealRoomQuery,
} from '@/lib/chat/prefetch-deal-room';
import { buildPendingThreadId, isPendingThreadId } from '@/lib/chat/thread-id';
import { haptics } from '@/lib/utils/haptics';
import { getMarketPostPrimaryImage, getMarketPostVideoCover } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';
import type { ChatInboxItem, ChatMessage, ChatThread } from '@/types/chat';

const inFlightKeys = new Set<string>();

type StartPostQuoteChatParams = {
  post: MarketPost;
  buyerId: string;
  sellerName: string;
  sellerAvatar?: string | null;
  mode: 'ask-price' | 'dm';
  marketLoginRoute: string;
  onBeforeNavigate?: () => void;
  onOpenChat?: (params: { threadId: string; peerId: string }) => void;
};

function buildClientMessageId(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildQuotePreview(post: MarketPost): string {
  const title = String(post.title || '').trim().slice(0, 80);
  return title || 'Product';
}

function buildAutoText(mode: 'ask-price' | 'dm', sellerName: string): string {
  if (mode === 'ask-price') {
    return `Hi ${sellerName}, I'd like to ask for the price of this item.`;
  }
  return 'Is this available?';
}

function findCachedThreadId(userId: string, postId: string, peerId: string): string | null {
  const fromQuery = findThreadQueryByPostAndPeer(postId, peerId);
  const memId = String(fromQuery?.thread?.id || '').trim();

  const inbox = getInboxItems(userId);
  const hit = inbox.find(
    (item) =>
      String(item.postId || '').trim() === postId && String(item.peerId || '').trim() === peerId
  );
  const inboxId = String(hit?.threadId || '').trim();

  const candidates = [memId, inboxId].filter(Boolean);
  const real = candidates.find((id) => id && !isPendingThreadId(id));
  if (real) return real;
  return candidates[0] || null;
}

function appendOptimisticQuote(threadId: string, message: ChatMessage): ChatMessage[] {
  const cached = getThreadQueryData(threadId);
  const prior = cached?.messages || [];
  const withoutDup = prior.filter(
    (m) => m.id !== message.id && m.clientMsgId !== message.clientMsgId
  );
  const messages = [...withoutDup, message];
  patchThreadQueryData(threadId, { messages });
  return messages;
}

function markQuoteFailed(threadId: string, clientMessageId: string) {
  const cached = getThreadQueryData(threadId);
  if (!cached?.messages?.length) return;
  const messages = cached.messages.map((m) =>
    m.id === clientMessageId || m.clientMsgId === clientMessageId
      ? { ...m, payload: { ...(m.payload || {}), sendStatus: 'failed', needsServerFlush: false } }
      : m
  );
  patchThreadQueryData(threadId, { messages });
}

export function flushQuoteInBackground(
  threadId: string,
  input: {
    body: string;
    clientMessageId: string;
    postId: string;
    quotePreview: string;
    previewImage?: string;
  }
) {
  if (isPendingThreadId(threadId)) return;
  void chatApi
    .sendMessage(threadId, {
      type: 'quote',
      body: input.body,
      clientMsgId: input.clientMessageId,
      quote: {
        postId: input.postId,
        previewText: input.quotePreview,
        previewImage: input.previewImage,
      },
    })
    .then((saved) => {
      const cached = getThreadQueryData(threadId);
      const messages = (cached?.messages || [])
        .filter(
          (m) => m.id !== input.clientMessageId && m.clientMsgId !== input.clientMessageId
        )
        .concat([{ ...saved, payload: { ...(saved.payload || {}), sendStatus: 'sent' } }]);
      patchThreadQueryData(threadId, { messages });
    })
    .catch((error: any) => {
      showToast(error?.message || 'Failed to send your message', 'error');
      markQuoteFailed(threadId, input.clientMessageId);
    });
}

export function retryQuoteMessage(
  threadId: string,
  message: {
    id: string;
    clientMessageId?: string;
    text?: string;
    quoteCard?: { postId: string; previewText: string; previewImage?: string };
  }
) {
  if (!threadId || isPendingThreadId(threadId)) return;
  const clientMessageId = String(message.clientMessageId || message.id || '').trim();
  if (!clientMessageId) return;
  const body = String(message.text || '').trim();
  const quote = message.quoteCard;

  const cached = getThreadQueryData(threadId);
  const messages = (cached?.messages || []).map((m) =>
    m.id === clientMessageId || m.clientMsgId === clientMessageId
      ? { ...m, payload: { ...(m.payload || {}), sendStatus: 'sending' } }
      : m
  );
  patchThreadQueryData(threadId, { messages });

  flushQuoteInBackground(threadId, {
    body,
    clientMessageId,
    postId: String(quote?.postId || ''),
    quotePreview: String(quote?.previewText || body || 'Product'),
    previewImage: quote?.previewImage,
  });
}

export async function startPostQuoteChat({
  post,
  buyerId,
  sellerName,
  sellerAvatar,
  mode,
  marketLoginRoute,
  onBeforeNavigate,
  onOpenChat,
}: StartPostQuoteChatParams): Promise<boolean> {
  const authUserId = String(auth.currentUser?.uid || buyerId || '').trim();
  if (!authUserId) {
    Alert.alert('Login Required', 'Please log in to message sellers', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
    ]);
    return false;
  }

  const postId = String(post.id || '').trim();
  const posterId = String(post.posterId || '').trim();
  if (!postId || !posterId) {
    showToast('Unable to start chat for this post', 'error');
    return false;
  }

  if (authUserId === posterId) {
    showToast('You cannot message yourself on your own post', 'info');
    return false;
  }

  const inFlightKey = `${authUserId}:${postId}:${mode}`;
  const alreadyInFlight = inFlightKeys.has(inFlightKey);

  const quotePreview = buildQuotePreview(post);
  const autoText = buildAutoText(mode, sellerName.trim() || 'Seller');
  const previewImage =
    getMarketPostVideoCover(post) || getMarketPostPrimaryImage(post) || undefined;
  const clientMessageId = buildClientMessageId();
  const postSnapshot = snapshotFromMarketPost(post) || {
    title: quotePreview,
    imageUrl: previewImage || null,
  };
  const peerLabel = sellerName.trim() || 'Seller';

  const openChat = (chatId: string, peerId: string) => {
    haptics.medium();
    onBeforeNavigate?.();
    if (onOpenChat) {
      onOpenChat({ threadId: chatId, peerId });
      return;
    }
    navigateToDealRoom(chatId, peerId);
  };

  const openRealRoom = (chatId: string, opts?: { thread?: ChatThread; messages?: ChatMessage[] }) => {
    const cached = getThreadQueryData(chatId);
    seedDealRoomQuery(chatId, {
      thread: opts?.thread ||
        cached?.thread || {
          id: chatId,
          postId,
          buyerId: authUserId,
          sellerId: posterId,
          status: 'browsing',
          postSnapshot,
        },
      peer: {
        id: posterId,
        displayName: peerLabel,
        storeName: peerLabel,
        avatarUrl: sellerAvatar || cached?.peer?.avatarUrl || null,
      },
      messages: opts?.messages ?? cached?.messages ?? [],
    });
    openChat(chatId, posterId);
    void prefetchDealRoom(chatId);
  };

  const buildOptimisticQuote = (threadId: string): ChatMessage => ({
    id: clientMessageId,
    threadId,
    senderId: authUserId,
    type: 'quote',
    body: autoText,
    clientMsgId: clientMessageId,
    payload: {
      postId,
      previewText: quotePreview,
      previewImage,
      sendStatus: 'sending',
      needsServerFlush: true,
      quote: { postId, previewText: quotePreview, previewImage },
    },
    createdAt: new Date().toISOString(),
  });

  const existingId = findCachedThreadId(authUserId, postId, posterId);

  if (existingId && !isPendingThreadId(existingId)) {
    seedDealRoomQuery(existingId, {
      thread: getThreadQueryData(existingId)?.thread || {
        id: existingId,
        postId,
        buyerId: authUserId,
        sellerId: posterId,
        status: 'browsing',
        postSnapshot,
      },
      peer: {
        id: posterId,
        displayName: peerLabel,
        storeName: peerLabel,
        avatarUrl: sellerAvatar || null,
      },
      messages: getThreadQueryData(existingId)?.messages || [],
    });
    const inboxHit = getInboxItems(authUserId).find((item) => item.threadId === existingId);
    if (inboxHit) {
      patchInboxThread(authUserId, existingId, {
        peerName: peerLabel,
        peerAvatar: sellerAvatar || inboxHit.peerAvatar,
        postSnapshot: {
          ...(inboxHit.postSnapshot || {}),
          ...postSnapshot,
          imageUrl: postSnapshot.imageUrl || inboxHit.postSnapshot?.imageUrl || null,
        },
      });
    }
    openRealRoom(existingId);
    return true;
  }

  if (!alreadyInFlight) {
    inFlightKeys.add(inFlightKey);
    setTimeout(() => inFlightKeys.delete(inFlightKey), 12_000);
    try {
      const { thread, isNew } = await chatApi.getOrCreateThread(postId, posterId);
      const realId = String(thread.id || '').trim();
      if (realId && !isPendingThreadId(realId)) {
        const mergedSnapshot = {
          ...(thread.postSnapshot || {}),
          ...postSnapshot,
          imageUrl:
            postSnapshot.imageUrl ||
            (thread.postSnapshot as any)?.imageUrl ||
            null,
          title: postSnapshot.title || (thread.postSnapshot as any)?.title || 'Product',
        };
        const pendingLocal =
          existingId && isPendingThreadId(existingId) ? existingId : null;
        if (pendingLocal) {
          migrateChatThreadQuery(pendingLocal, realId);
          migrateDealRoomQuery(pendingLocal, realId);
          replaceInboxThreadId(authUserId, pendingLocal, realId, {
            postId,
            status: thread.status,
            postSnapshot: mergedSnapshot,
          });
        }

        seedDealRoomQuery(realId, {
          thread: { ...thread, postSnapshot: mergedSnapshot },
          peer: {
            id: posterId,
            displayName: peerLabel,
            storeName: peerLabel,
            avatarUrl: sellerAvatar || null,
          },
        });
        upsertInboxItem(authUserId, {
          threadId: realId,
          peerId: posterId,
          peerName: peerLabel,
          peerAvatar: sellerAvatar || undefined,
          postId,
          postSnapshot: mergedSnapshot,
          status: thread.status || 'browsing',
          lastPreview: isNew ? autoText : 'Continue conversation',
          unreadCount: 0,
          lastAt: new Date().toISOString(),
        });

        if (isNew) {
          const optimistic = buildOptimisticQuote(realId);
          appendOptimisticQuote(realId, optimistic);
          flushQuoteInBackground(realId, {
            body: autoText,
            clientMessageId,
            postId,
            quotePreview,
            previewImage,
          });
        }

        openRealRoom(realId, {
          thread: { ...thread, postSnapshot: mergedSnapshot },
          messages: getThreadQueryData(realId)?.messages,
        });
        return true;
      }
    } catch {
      // Fall through to pending optimistic room only when resolve fails.
    }
  }

  const pendingId =
    existingId && isPendingThreadId(existingId)
      ? existingId
      : buildPendingThreadId(postId, posterId);
  const optimistic = buildOptimisticQuote(pendingId);

  seedOptimisticThreadRoom({
    threadId: pendingId,
    postId,
    buyerId: authUserId,
    sellerId: posterId,
    peerName: peerLabel,
    peerAvatar: sellerAvatar,
    postSnapshot,
    messages: alreadyInFlight
      ? getThreadQueryData(pendingId)?.messages || [optimistic]
      : [optimistic],
  });
  seedDealRoomQuery(pendingId, {
    thread: getThreadQueryData(pendingId)?.thread || null,
    peer: getThreadQueryData(pendingId)?.peer || null,
    messages: getThreadQueryData(pendingId)?.messages || [optimistic],
  });

  if (!alreadyInFlight) {
    inFlightKeys.add(inFlightKey);
    appendOptimisticQuote(pendingId, optimistic);
    upsertInboxItem(authUserId, {
      threadId: pendingId,
      peerId: posterId,
      peerName: peerLabel,
      peerAvatar: sellerAvatar || undefined,
      postId,
      postSnapshot,
      status: 'browsing',
      lastPreview: autoText,
      unreadCount: 0,
      lastAt: new Date().toISOString(),
    });
    setTimeout(() => inFlightKeys.delete(inFlightKey), 12_000);
  }

  openChat(pendingId, posterId);
  return true;
}

export async function startAskPriceChat(
  params: Omit<StartPostQuoteChatParams, 'mode'>
): Promise<boolean> {
  return startPostQuoteChat({ ...params, mode: 'ask-price' });
}
