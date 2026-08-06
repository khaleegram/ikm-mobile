import { router } from 'expo-router';

import { showToast } from '@/components/toast';
import { Alert } from '@/components/app-alert';
import { auth } from '@/lib/firebase/config';
import { chatApi } from '@/lib/api/chat';
import { snapshotFromMarketPost } from '@/lib/chat/enrich-inbox-snapshots';
import {
  migrateDealRoomQuery,
  navigateToDealRoom,
  prefetchDealRoom,
  seedDealRoomQuery,
} from '@/lib/chat/prefetch-deal-room';
import { useChatInboxCache } from '@/lib/stores/chat-inbox-cache';
import {
  buildPendingThreadId,
  chatThreadCache,
  isPendingThreadId,
} from '@/lib/stores/chat-thread-cache';
import { haptics } from '@/lib/utils/haptics';
import { getMarketPostPrimaryImage, getMarketPostVideoCover } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';
import type { ChatInboxItem, ChatMessage, ChatThread } from '@/types/chat';

const inFlightKeys = new Set<string>();

type StartPostQuoteChatParams = {
  post: MarketPost;
  buyerId: string;
  sellerName: string;
  /** Store logo / photo, when the caller already has it — paints the deal room avatar instantly instead of blank. */
  sellerAvatar?: string | null;
  mode: 'ask-price' | 'dm';
  marketLoginRoute: string;
  onBeforeNavigate?: () => void;
  /** Prefer omitting this — navigate to the real inbox deal room instead of a disconnected sheet. */
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
  const fromMemory = chatThreadCache.findByPostAndPeer(postId, peerId);
  const memId = String(fromMemory?.thread?.id || '').trim();

  const inbox = useChatInboxCache.getState().getItems(userId);
  const hit = inbox.find(
    (item) =>
      String(item.postId || '').trim() === postId && String(item.peerId || '').trim() === peerId
  );
  const inboxId = String(hit?.threadId || '').trim();
  if (inboxId) {
    chatThreadCache.seedFromInbox(hit!);
  }

  // Prefer a real UUID over a stale pending: id when both exist.
  const candidates = [memId, inboxId].filter(Boolean);
  const real = candidates.find((id) => id && !isPendingThreadId(id));
  if (real) return real;
  return candidates[0] || null;
}

function upsertLocalInbox(userId: string, item: ChatInboxItem) {
  const existing = useChatInboxCache.getState().getItems(userId);
  const next = [item, ...existing.filter((row) => row.threadId !== item.threadId)];
  useChatInboxCache.getState().setItems(userId, next);
  chatThreadCache.seedFromInbox(item);
}

function appendOptimisticQuote(
  threadId: string,
  message: ChatMessage
): ChatMessage[] {
  const cached = chatThreadCache.get(threadId);
  const prior = cached?.messages || [];
  const withoutDup = prior.filter(
    (m) => m.id !== message.id && m.clientMsgId !== message.clientMsgId
  );
  const messages = [...withoutDup, message];
  chatThreadCache.set(threadId, { messages });
  return messages;
}

/** Flip a still-pending optimistic quote bubble to a visible failed state instead of leaving it
 * saying "Pending" forever when the background send never lands. */
function markQuoteFailed(threadId: string, clientMessageId: string) {
  const cached = chatThreadCache.get(threadId);
  if (!cached?.messages?.length) return;
  const messages = cached.messages.map((m) =>
    m.id === clientMessageId || m.clientMsgId === clientMessageId
      ? { ...m, payload: { ...(m.payload || {}), sendStatus: 'failed', needsServerFlush: false } }
      : m
  );
  chatThreadCache.set(threadId, { messages });
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
      const cached = chatThreadCache.get(threadId);
      const messages = (cached?.messages || [])
        .filter(
          (m) => m.id !== input.clientMessageId && m.clientMsgId !== input.clientMessageId
        )
        .concat([{ ...saved, payload: { ...(saved.payload || {}), sendStatus: 'sent' } }]);
      chatThreadCache.set(threadId, { messages });
    })
    .catch((error: any) => {
      showToast(error?.message || 'Failed to send your message', 'error');
      markQuoteFailed(threadId, input.clientMessageId);
    });
}

/** Resend a quote bubble that's showing "Failed · Tap to retry" — reuses the original quote/body. */
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

  // Flip back to "sending" immediately so the bubble reads Pending, not Failed, while it retries.
  const cached = chatThreadCache.get(threadId);
  const messages = (cached?.messages || []).map((m) =>
    m.id === clientMessageId || m.clientMsgId === clientMessageId
      ? { ...m, payload: { ...(m.payload || {}), sendStatus: 'sending' } }
      : m
  );
  chatThreadCache.set(threadId, { messages });

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
    // Same screen as inbox deal rooms — never a disconnected feed-only chat.
    navigateToDealRoom(chatId, peerId);
  };

  const openRealRoom = (chatId: string, opts?: { thread?: ChatThread; messages?: ChatMessage[] }) => {
    const cached = chatThreadCache.get(chatId);
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

  // Existing real product room → seed Query, open UUID, prefetch. Never re-send quote.
  if (existingId && !isPendingThreadId(existingId)) {
    chatThreadCache.set(
      existingId,
      {
        thread: chatThreadCache.get(existingId)?.thread || {
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
        messages: chatThreadCache.get(existingId)?.messages || [],
      },
      { notify: false }
    );
    const inboxHit = useChatInboxCache
      .getState()
      .getItems(authUserId)
      .find((item) => item.threadId === existingId);
    if (inboxHit) {
      useChatInboxCache.getState().patchThread(authUserId, existingId, {
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

  // No real UUID locally (cold or stale pending:) → resolve on server before navigate.
  // Ban navigating with pending: when a real room already exists remotely.
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
          chatThreadCache.migrate(pendingLocal, realId);
          migrateDealRoomQuery(pendingLocal, realId);
          useChatInboxCache
            .getState()
            .replaceThreadId(authUserId, pendingLocal, realId, {
              postId,
              status: thread.status,
              postSnapshot: mergedSnapshot,
            });
        }

        chatThreadCache.set(realId, {
          thread: { ...thread, postSnapshot: mergedSnapshot },
          peer: {
            id: posterId,
            displayName: peerLabel,
            storeName: peerLabel,
            avatarUrl: sellerAvatar || null,
          },
        });
        upsertLocalInbox(authUserId, {
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
          messages: chatThreadCache.get(realId)?.messages,
        });
        return true;
      }
    } catch {
      // Fall through to pending optimistic room only when resolve fails.
    }
  }

  // Last resort: offline / API failure. Only then navigate with pending:.
  const pendingId =
    existingId && isPendingThreadId(existingId)
      ? existingId
      : buildPendingThreadId(postId, posterId);
  const optimistic = buildOptimisticQuote(pendingId);

  chatThreadCache.seedOptimisticRoom({
    threadId: pendingId,
    postId,
    buyerId: authUserId,
    sellerId: posterId,
    peerName: peerLabel,
    peerAvatar: sellerAvatar,
    postSnapshot,
    messages: alreadyInFlight
      ? chatThreadCache.get(pendingId)?.messages || [optimistic]
      : [optimistic],
  });
  seedDealRoomQuery(pendingId, {
    thread: chatThreadCache.get(pendingId)?.thread || null,
    peer: chatThreadCache.get(pendingId)?.peer || null,
    messages: chatThreadCache.get(pendingId)?.messages || [optimistic],
  });

  if (!alreadyInFlight) {
    inFlightKeys.add(inFlightKey);
    appendOptimisticQuote(pendingId, optimistic);
    upsertLocalInbox(authUserId, {
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
