import { Alert } from 'react-native';
import { router } from 'expo-router';

import { showToast } from '@/components/toast';
import { auth } from '@/lib/firebase/config';
import { buildDirectConversationId, marketMessagesApi } from '@/lib/api/market-messages';
import { chatApi } from '@/lib/api/chat';
import { isPostgresChatBackend } from '@/lib/config/chat-backend';
import { useMarketChatStore } from '@/lib/stores/marketChatStore';
import { haptics } from '@/lib/utils/haptics';
import { getMarketPostPrimaryImage, getMarketPostVideoCover } from '@/lib/utils/market-media';
import type { MarketMessage, MarketPost } from '@/types';

const inFlightKeys = new Set<string>();

type StartPostQuoteChatParams = {
  post: MarketPost;
  buyerId: string;
  sellerName: string;
  mode: 'ask-price' | 'dm';
  marketLoginRoute: string;
  onBeforeNavigate?: () => void;
  onOpenChat?: (params: { threadId: string; peerId: string }) => void;
};

function buildClientMessageId(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildQuotePreview(post: MarketPost): string {
  const hasPrice = typeof post.price === 'number' && post.price > 0;
  const locationText = [post.location?.city, post.location?.state].filter(Boolean).join(', ');
  if (hasPrice) {
    return `Post preview - NGN ${Number(post.price).toLocaleString()}${locationText ? ` - ${locationText}` : ''}`;
  }
  return `Post preview${locationText ? ` - ${locationText}` : ''}`;
}

function buildAutoText(mode: 'ask-price' | 'dm', sellerName: string): string {
  if (mode === 'ask-price') {
    return `Hi ${sellerName}, I'd like to ask for the price of this item.`;
  }
  return `Hi ${sellerName}, I'm interested in this post.`;
}

export async function startPostQuoteChat({
  post,
  buyerId,
  sellerName,
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

  const navigateToChat = (chatId: string, peerId: string) => {
    haptics.medium();
    onBeforeNavigate?.();
    router.push({
      pathname: '/(market)/messages/[chatId]',
      params: {
        chatId,
        peerId,
      },
    } as any);
  };

  if (isPostgresChatBackend()) {
    try {
      const { thread, isNew } = await chatApi.getOrCreateThread(postId, posterId);
      if (!alreadyInFlight && isNew) {
        inFlightKeys.add(inFlightKey);
        void chatApi
          .sendMessage(thread.id, {
            type: 'quote',
            body: autoText,
            clientMsgId: clientMessageId,
            quote: { postId, previewText: quotePreview, previewImage },
          })
          .catch((error: any) => {
            showToast(error?.message || 'Failed to send your message', 'error');
          })
          .finally(() => inFlightKeys.delete(inFlightKey));
      }
      if (onOpenChat) {
        haptics.medium();
        onBeforeNavigate?.();
        onOpenChat({ threadId: thread.id, peerId: posterId });
      } else {
        navigateToChat(thread.id, posterId);
      }
      return true;
    } catch (error: any) {
      showToast(error?.message || 'Unable to start chat', 'error');
      return false;
    }
  }

  const chatId = buildDirectConversationId(authUserId, posterId);

  if (!alreadyInFlight) {
    inFlightKeys.add(inFlightKey);

    const optimisticMessage: MarketMessage = {
      id: clientMessageId,
      chatId,
      senderId: authUserId,
      receiverId: posterId,
      postId,
      type: 'quote',
      text: autoText,
      clientMessageId,
      quoteCard: {
        postId,
        previewText: quotePreview,
        previewImage,
      },
      read: false,
      createdAt: new Date(),
    };
    useMarketChatStore.getState().stagePendingQuoteMessage(chatId, optimisticMessage);

    void (async () => {
      try {
        await marketMessagesApi.sendQuoteMessage(
          chatId,
          { postId, previewText: quotePreview, previewImage },
          autoText,
          { clientMessageId }
        );
      } catch (error: any) {
        haptics.error();
        showToast(error?.message || 'Failed to send your message', 'error');
      } finally {
        inFlightKeys.delete(inFlightKey);
      }
    })();
  }

  navigateToChat(chatId, posterId);
  return true;
}

export async function startAskPriceChat(
  params: Omit<StartPostQuoteChatParams, 'mode'>
): Promise<boolean> {
  return startPostQuoteChat({ ...params, mode: 'ask-price' });
}
