import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { type FlashListRef } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { marketMessagesApi } from '@/lib/api/market-messages';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useBlockedUserIds } from '@/lib/firebase/firestore/market-social';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { buildMarketOfferLink } from '@/lib/utils/market-offer-link';
import { MarketMessage } from '@/types';

import { ChatComposer } from './chat-detail/chat-composer';
import { ChatHeader } from './chat-detail/chat-header';
import { ChatList } from './chat-detail/chat-list';
import { OfferModal } from './chat-detail/offer-modal';
import { styles } from './chat-detail/styles';
import { useChatHeader } from './chat-detail/use-chat-header';
import { useChatMessages } from './chat-detail/use-chat-messages';
import { useChatRoute } from './chat-detail/use-chat-route';
import { useOfferLogic } from './chat-detail/use-offer-logic';
import { buildClientMessageId, lightBrown } from './chat-detail/utils';
import { useMarketChatStore } from '@/lib/stores/marketChatStore';

export default function ChatDetailScreen() {
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const marketLoginRoute = getLoginRouteForVariant('market');
  const userId = user?.uid || null;
  const { idSet: blockedIds } = useBlockedUserIds(userId);
  const setActiveMarketConversationId = useMarketChatStore((state) => state.setActiveMarketConversationId);

  const {
    activeChatId,
    directConversationId,
    legacyChatId,
    resolvedPeerId,
    setActiveChatId,
    goBackToInbox,
    syncRouteChatId,
  } = useChatRoute(userId);

  useFocusEffect(
    useCallback(() => {
      const openId = String(directConversationId || activeChatId || '').trim();
      setActiveMarketConversationId(openId || null);
      return () => setActiveMarketConversationId(null);
    }, [activeChatId, directConversationId])
  );

  const {
    contextPostId,
    displayMessages,
    error,
    legacyChat,
    legacySellerId,
    loading,
    renderedMessages,
    setPendingMessages,
    markLatestVisibleIncomingAsRead,
    unreadCount,
    unreadDividerMessageId,
  } = useChatMessages({
    activeChatId,
    legacyChatId,
    resolvedPeerId,
    userId,
  });

  const { headerAvatarUri, headerName } = useChatHeader({
    legacyChat,
    resolvedPeerId,
    userId,
  });

  const { canSendOffer, sellerId, showInlineOfferCta } = useOfferLogic({
    contextPostId,
    displayMessages,
    legacySellerId,
    userId,
  });
  const isBlockedPeer = Boolean(resolvedPeerId && blockedIds.has(String(resolvedPeerId)));

  const flatListRef = useRef<FlashListRef<MarketMessage>>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [offerVisible, setOfferVisible] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [sendingOffer, setSendingOffer] = useState(false);

  const applyResolvedChatId = useCallback(
    (chatId: string) => {
      const normalized = String(chatId || '').trim();
      if (!normalized || normalized === activeChatId) return;
      setActiveChatId(normalized);
      syncRouteChatId(normalized);
    },
    [activeChatId, setActiveChatId, syncRouteChatId]
  );

  const buildSendTargets = useCallback(() => {
    const primary = directConversationId || activeChatId;
    const fallbacks = [activeChatId, directConversationId]
      .map((id) => String(id || '').trim())
      .filter((id, index, arr) => Boolean(id) && id !== primary && arr.indexOf(id) === index);
    return { primary, fallbacks };
  }, [activeChatId, directConversationId]);

  const attemptSend = useCallback(
    async (
      text: string,
      imageUrl?: string,
      paymentLink?: string,
      options?: { clientMessageId?: string }
    ) => {
      const { primary, fallbacks } = buildSendTargets();
      if (!primary) {
        throw new Error('Unable to resolve chat id for this conversation.');
      }

      try {
        const sendResult = await marketMessagesApi.sendMessage(
          primary,
          text,
          imageUrl,
          paymentLink,
          options
        );
        return { chatId: primary, queued: Boolean(sendResult.queued) };
      } catch (primaryError) {
        for (const fallbackId of fallbacks) {
          try {
            const sendResult = await marketMessagesApi.sendMessage(
              fallbackId,
              text,
              imageUrl,
              paymentLink,
              options
            );
            return { chatId: fallbackId, queued: Boolean(sendResult.queued) };
          } catch {
            // Try next fallback id.
          }
        }
        throw primaryError;
      }
    },
    [buildSendTargets]
  );

  const handleOpenOffer = useCallback(
    (offer: { postId: string; sellerId: string; price: number; chatId?: string }) => {
      const targetChatId = offer.chatId || activeChatId || '';
      router.push(
        `/(market)/buy/${offer.postId}?offerPrice=${offer.price}&chatId=${targetChatId}&sellerId=${offer.sellerId}` as any
      );
    },
    [activeChatId]
  );

  const handleSend = async () => {
    if (isBlockedPeer) {
      showToast('You blocked this user. Unblock them to continue.', 'info');
      return;
    }
    if (!user) {
      Alert.alert('Login Required', 'Please log in to send messages', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }

    const trimmedMessage = messageText.trim();
    if (!trimmedMessage) return;

    const { primary } = buildSendTargets();
    if (!primary) {
      showToast('Unable to open this conversation right now.', 'error');
      return;
    }

    const optimisticMessageId = buildClientMessageId();
    const optimisticMessage: MarketMessage = {
      id: optimisticMessageId,
      chatId: primary,
      senderId: user.uid,
      receiverId: '',
      postId: contextPostId || '',
      text: trimmedMessage,
      clientMessageId: optimisticMessageId,
      read: false,
      createdAt: new Date(),
    };

    setPendingMessages((previous) => [...previous, optimisticMessage]);
    setMessageText('');
    haptics.medium();

    try {
      const result = await attemptSend(trimmedMessage, undefined, undefined, {
        clientMessageId: optimisticMessageId,
      });
      applyResolvedChatId(result.chatId);

      if (result.queued) {
        showToast('No network. Message queued and will send when online.', 'info');
      } else {
        haptics.success();
      }
    } catch (sendError: any) {
      setPendingMessages((previous) =>
        previous.filter((pendingMessage) => pendingMessage.id !== optimisticMessageId)
      );
      setMessageText((current) => current || trimmedMessage);
      console.error('Error sending message:', sendError);
      haptics.error();
      showToast(sendError?.message || 'Failed to send message', 'error');
    }
  };

  const handleSendOffer = async () => {
    if (isBlockedPeer) {
      showToast('You blocked this user. Unblock them to continue.', 'info');
      return;
    }
    if (!user || !contextPostId || !sellerId) return;

    const numericAmount = Number(offerAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      showToast('Enter a valid offer amount.', 'error');
      return;
    }

    try {
      setSendingOffer(true);
      haptics.medium();

      const { primary } = buildSendTargets();
      if (!primary) throw new Error('Unable to resolve chat id.');

      const offerLink = buildMarketOfferLink({
        postId: contextPostId,
        sellerId,
        price: numericAmount,
        chatId: primary,
      });
      const formattedAmount = `NGN ${numericAmount.toLocaleString()}`;
      const note = offerNote.trim();
      const offerText = note
        ? `Final offer: ${formattedAmount}\n${note}`
        : `Final offer: ${formattedAmount}. Tap Buy Offer to pay into escrow.`;
      const offerClientMessageId = buildClientMessageId();

      const result = await attemptSend(offerText, undefined, offerLink, {
        clientMessageId: offerClientMessageId,
      });
      applyResolvedChatId(result.chatId);

      if (result.queued) {
        showToast('No network. Offer queued and will send when online.', 'info');
      } else {
        showToast('Offer sent to buyer.', 'success');
      }

      setOfferVisible(false);
      setOfferAmount('');
      setOfferNote('');
      haptics.success();
    } catch (offerError: any) {
      console.error('Error sending offer:', offerError);
      haptics.error();
      showToast(offerError?.message || 'Unable to send offer right now.', 'error');
    } finally {
      setSendingOffer(false);
    }
  };

  const handlePickImage = async () => {
    if (isBlockedPeer) {
      showToast('You blocked this user. Unblock them to continue.', 'info');
      return;
    }
    if (!user) {
      Alert.alert('Login Required', 'Please log in to send images', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'We need access to your photos to send images.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) return;

      setSending(true);
      haptics.medium();
      const base64 = await convertImageToBase64(result.assets[0].uri);
      const mediaClientMessageId = buildClientMessageId();
      const sendResult = await attemptSend('', base64, undefined, {
        clientMessageId: mediaClientMessageId,
      });
      applyResolvedChatId(sendResult.chatId);
      haptics.success();
    } catch (pickError: any) {
      console.error('Error picking image:', pickError);
      haptics.error();
      showToast(pickError?.message || 'Failed to send image', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingHorizontal: 24 }]}>
        <View style={[styles.emptyContainer, { flex: 1 }]}>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: `${lightBrown}18`,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 8,
            }}>
            <IconSymbol name="message.fill" size={40} color={lightBrown} />
          </View>
          <Text style={[styles.text, { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }]}>
            Sign in to chat
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
            Your conversations sync across devices when you’re logged in.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: lightBrown, borderRadius: 14, paddingVertical: 14 }]}
            onPress={() => router.push(marketLoginRoute as any)}>
            <Text style={styles.buttonText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      <View style={styles.container}>
        <ChatHeader
          canSendOffer={canSendOffer}
          colors={colors}
          headerAvatarUri={headerAvatarUri}
          headerName={headerName}
          insetTop={insets.top}
          onBack={goBackToInbox}
          onOpenOffer={() => {
            haptics.light();
            setOfferVisible(true);
          }}
        />

        {/* Always render the chat list shell — no full-screen spinners.
            Messages stream in from cache/Firestore without blocking the UI. */}
        {displayMessages.length > 0 ? (
          <ChatList
            activeChatId={activeChatId}
            colors={colors}
            currentUserId={userId}
            flatListRef={flatListRef}
            insetsBottom={insets.bottom}
            messages={renderedMessages}
            onOpenOffer={handleOpenOffer}
            peerAvatarUri={headerAvatarUri}
            onLatestVisibleIncomingMessage={markLatestVisibleIncomingAsRead}
            unreadCount={unreadCount}
            unreadDividerMessageId={unreadDividerMessageId}
          />
        ) : (
          <View style={[styles.emptyContainer, { paddingHorizontal: 24 }]}>
            {loading ? (
              <>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    borderWidth: 2,
                    borderColor: `${lightBrown}40`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <ActivityIndicator size="small" color={lightBrown} />
                </View>
                <Text style={[styles.emptySubtext, { color: colors.textSecondary, marginTop: 12, fontWeight: '600' }]}>
                  Loading messages…
                </Text>
              </>
            ) : error ? (
              <>
                <IconSymbol name="exclamationmark.triangle.fill" size={40} color={colors.error} />
                <Text style={[styles.emptyText, { color: colors.error, fontWeight: '800', fontSize: 17 }]}>Couldn’t load chat</Text>
                <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>Check your connection and try opening the thread again.</Text>
              </>
            ) : (
              <>
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    backgroundColor: `${lightBrown}14`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <IconSymbol name="bubble.left.and.bubble.right.fill" size={32} color={lightBrown} />
                </View>
                <Text style={[styles.emptyText, { color: colors.text, fontSize: 17, fontWeight: '800' }]}>Say hello</Text>
                <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
                  Send a message to start the conversation.
                </Text>
              </>
            )}
          </View>
        )}

        {isBlockedPeer ? (
          <View
            style={{
              marginHorizontal: 12,
              marginBottom: Math.max(insets.bottom, 12),
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              minHeight: 52,
              paddingHorizontal: 14,
              alignItems: 'center',
              flexDirection: 'row',
            }}>
            <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: 13 }}>
              Messaging disabled because you blocked this user.
            </Text>
          </View>
        ) : (
          <ChatComposer
            colors={colors}
            messageText={messageText}
            onChangeMessageText={setMessageText}
            onOpenOffer={() => {
              haptics.light();
              setOfferVisible(true);
            }}
            onPickImage={handlePickImage}
            onSend={handleSend}
            sending={sending}
            showInlineOfferCta={showInlineOfferCta}
            insetBottom={insets.bottom}
          />
        )}
      </View>

      <OfferModal
        colors={colors}
        offerAmount={offerAmount}
        offerNote={offerNote}
        onChangeOfferAmount={setOfferAmount}
        onChangeOfferNote={setOfferNote}
        onClose={() => setOfferVisible(false)}
        onSendOffer={handleSendOffer}
        sendingOffer={sendingOffer}
        visible={offerVisible && !isBlockedPeer}
      />
    </KeyboardAvoidingView>
  );
}
