import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { type FlashListRef } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DealProductHero } from '@/components/chat/deal-product-hero';
import { DealStageBar } from '@/components/chat/deal-stage-bar';
import { DealOrderProgressBar } from '@/components/chat/deal-order-progress-bar';
import { NegotiationTimeline } from '@/components/chat/negotiation-timeline';
import { OfferActionBar } from '@/components/chat/offer-action-bar';
import { OfferInlinePanel } from '@/components/chat/offer-inline-panel';
import { ProductRoomSwitcher } from '@/components/chat/product-room-switcher';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { chatMessageToMarketMessage } from '@/lib/chat/map-messages';
import {
  enrichInboxRoomsWithPosts,
  snapshotFromMarketPost,
} from '@/lib/chat/enrich-inbox-snapshots';
import { useBlockedUserIds } from '@/lib/firebase/firestore/market-social';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPost, useMarketPostsByIds } from '@/lib/firebase/firestore/market-posts';
import { useOrder } from '@/lib/firebase/firestore/orders';
import { useChatInbox } from '@/lib/hooks/use-chat-inbox';
import { useChatThread } from '@/lib/hooks/use-chat-thread';
import type { VoiceRecordingResult } from '@/lib/hooks/use-voice-recorder';
import { useTheme } from '@/lib/theme/theme-context';
import { orderApi } from '@/lib/api/orders';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { uploadImage } from '@/lib/utils/image-upload';
import { MarketMessage, MarketPost } from '@/types';
import { AnimatedPressable } from '@/components/animated-pressable';

import { ChatComposer } from './chat-composer';
import { ChatHeader } from './chat-header';
import { ChatList } from './chat-list';
import { styles } from './styles';
import { useChatRoute } from './use-chat-route';
import { buildClientMessageId, lightBrown } from './utils';
import { useMarketChatStore } from '@/lib/stores/marketChatStore';

type PostgresChatDetailProps = {
  embeddedThreadId?: string | null;
  embeddedPeerId?: string | null;
  embedded?: boolean;
  onClose?: () => void;
};

export function PostgresChatDetail({
  embeddedThreadId = null,
  embeddedPeerId = null,
  embedded = false,
  onClose,
}: PostgresChatDetailProps = {}) {
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const marketLoginRoute = getLoginRouteForVariant('market');
  const userId = user?.uid || null;
  const { idSet: blockedIds } = useBlockedUserIds(userId);
  const setActiveMarketConversationId = useMarketChatStore((s) => s.setActiveMarketConversationId);

  const route = useChatRoute(userId);
  const threadId = embeddedThreadId || route.activeChatId;
  const resolvedPeerId = embeddedPeerId || route.resolvedPeerId;
  const goBackToInbox = embedded ? () => onClose?.() : route.goBack;

  const {
    thread,
    peer,
    messages,
    loading,
    error,
    sendText,
    sendVoice,
    createOffer,
    respondToOffer,
    markRead,
    appendMessage,
  } = useChatThread({ threadId, userId, enabled: Boolean(threadId && userId) });

  const inbox = useChatInbox(userId);
  const needsThreadPostHydration = Boolean(
    thread?.postId &&
      !String(thread?.postSnapshot?.title || '').trim() &&
      !String(thread?.postSnapshot?.imageUrl || '').trim()
  );
  const { post: hydratedThreadPost } = useMarketPost(needsThreadPostHydration ? thread?.postId || null : null);
  const resolvedPostSnapshot = useMemo(() => {
    const existing = thread?.postSnapshot;
    if (existing && (String(existing.title || '').trim() || String(existing.imageUrl || '').trim())) {
      return existing;
    }
    return snapshotFromMarketPost(hydratedThreadPost) || existing || null;
  }, [hydratedThreadPost, thread?.postSnapshot]);

  const siblingPostIds = useMemo(
    () =>
      inbox.items
        .filter((item) => {
          const snap = item.postSnapshot || {};
          return !String(snap.title || '').trim() && !String(snap.imageUrl || '').trim();
        })
        .map((item) => item.postId)
        .filter(Boolean),
    [inbox.items]
  );
  const { posts: siblingHydratedPosts } = useMarketPostsByIds(siblingPostIds, 40);
  const siblingPostsById = useMemo(() => {
    const map: Record<string, MarketPost | undefined> = {};
    siblingHydratedPosts.forEach((post) => {
      if (post.id) map[post.id] = post;
    });
    return map;
  }, [siblingHydratedPosts]);
  const enrichedInboxRooms = useMemo(
    () => enrichInboxRoomsWithPosts(inbox.items, siblingPostsById),
    [inbox.items, siblingPostsById]
  );

  useFocusEffect(
    useCallback(() => {
      setActiveMarketConversationId(threadId || null);
      if (threadId) void markRead();
      return () => setActiveMarketConversationId(null);
    }, [threadId, markRead, setActiveMarketConversationId])
  );

  const peerId = peer?.id || resolvedPeerId || '';
  const isBlockedPeer = Boolean(peerId && blockedIds.has(String(peerId)));
  const openPeerHub = useCallback(() => {
    if (!peerId) return;
    haptics.light();
    router.push(`/(market)/messages/peer/${peerId}` as any);
  }, [peerId]);
  const isSeller = Boolean(userId && thread && userId === thread.sellerId);
  const isBuyer = Boolean(userId && thread && userId === thread.buyerId);
  const threadStatus = String(thread?.status || '');
  const isInOrder = ['in_order', 'order_active', 'completed', 'closed'].includes(threadStatus);
  const linkedOrderId = String(thread?.linkedOrderId || '').trim();
  const showOrderProgress = Boolean(linkedOrderId) || isInOrder;
  const canNegotiateOffers = !isInOrder;
  const canSendOffer = canNegotiateOffers && !isBlockedPeer;
  const { order: linkedOrder } = useOrder(linkedOrderId || null);
  const [shippingBusy, setShippingBusy] = useState(false);

  const canMarkShipped = Boolean(
    isSeller &&
      linkedOrder &&
      ['Accepted', 'Preparing', 'Processing'].includes(String(linkedOrder.status || ''))
  );

  const presenceSubtitle = useMemo(() => {
    if (!peer) return 'Product deal room';
    if (peer.presence === 'online') return 'Online · deal room';
    if (peer.presence === 'last_seen' && peer.lastSeenAt) {
      return `Last seen ${new Date(peer.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return 'Product deal room';
  }, [peer]);

  const pendingOfferMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m.offer || m.offer.status !== 'pending') continue;
      if (m.senderId && m.senderId !== userId) return m;
    }
    return null;
  }, [messages, userId]);

  const acceptedOfferMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.offer?.status === 'accepted') return m;
    }
    return null;
  }, [messages]);

  const flatListRef = useRef<FlashListRef<MarketMessage>>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [offerVisible, setOfferVisible] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [sendingOffer, setSendingOffer] = useState(false);
  const voiceRetryRef = useRef<Map<string, VoiceRecordingResult>>(new Map());

  const renderedMessages = useMemo(() => {
    if (!threadId || !thread) return [];
    const shippedPhoto = String(linkedOrder?.sentPhotoUrl || '').trim();
    return messages.map((message) => {
      const mapped = chatMessageToMarketMessage(
        message,
        threadId,
        thread.postId,
        peerId,
        thread.sellerId
      );
      if (
        mapped.type === 'system' &&
        mapped.systemEvent === 'order_shipped' &&
        !mapped.milestonePhotoUrl &&
        shippedPhoto
      ) {
        return { ...mapped, milestonePhotoUrl: shippedPhoto };
      }
      return mapped;
    });
  }, [linkedOrder?.sentPhotoUrl, messages, thread, threadId, peerId]);

  const handleMarkShipped = useCallback(() => {
    if (!linkedOrder?.id || shippingBusy) return;
    Alert.alert('Mark as Shipped', 'Attach a dispatch proof photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Ship without proof',
        onPress: () => {
          void (async () => {
            try {
              setShippingBusy(true);
              await orderApi.markAsSent(linkedOrder.id!);
              haptics.success();
              showToast('Order marked as shipped.', 'success');
            } catch (error: any) {
              showToast(error?.message || 'Unable to mark as shipped.', 'error');
            } finally {
              setShippingBusy(false);
            }
          })();
        },
      },
      {
        text: 'Attach proof',
        onPress: () => {
          void (async () => {
            try {
              setShippingBusy(true);
              const { status } = await ImagePicker.requestCameraPermissionsAsync();
              if (status !== 'granted') {
                const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (lib.status !== 'granted') {
                  Alert.alert('Permission Required', 'Camera or photo access is needed.');
                  return;
                }
              }
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
              });
              if (result.canceled || !result.assets[0]) return;
              const uploaded = await uploadImage(
                result.assets[0].uri,
                `orderProof/${user?.uid || 'seller'}/${Date.now()}_dispatch.jpg`
              );
              await orderApi.markAsSent(linkedOrder.id!, uploaded.url);
              haptics.success();
              showToast('Order marked as shipped.', 'success');
            } catch (error: any) {
              showToast(error?.message || 'Unable to mark as shipped.', 'error');
            } finally {
              setShippingBusy(false);
            }
          })();
        },
      },
    ]);
  }, [linkedOrder?.id, shippingBusy, user?.uid]);

  const handleOpenOffer = useCallback(
    (offer: { postId: string; sellerId: string; price: number; chatId?: string }) => {
      router.push(
        `/(market)/buy/${offer.postId}?offerPrice=${offer.price}&chatId=${threadId || ''}&sellerId=${offer.sellerId}` as any
      );
    },
    [threadId]
  );

  const handleSend = async () => {
    if (isBlockedPeer) {
      showToast('You blocked this user. Unblock them to continue.', 'info');
      return;
    }
    if (!user || !threadId) return;
    const trimmed = messageText.trim();
    if (!trimmed) return;

    setMessageText('');
    haptics.medium();
    try {
      await sendText(trimmed, buildClientMessageId());
      haptics.success();
    } catch (sendError: any) {
      setMessageText(trimmed);
      showToast(sendError?.message || 'Failed to send message', 'error');
    }
  };

  const handleSendOffer = async () => {
    if (isBlockedPeer || !user || !threadId) return;
    const numericAmount = Number(offerAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      showToast('Enter a valid offer amount.', 'error');
      return;
    }
    try {
      setSendingOffer(true);
      await createOffer(numericAmount, offerNote.trim() || undefined, buildClientMessageId());
      setOfferVisible(false);
      setOfferAmount('');
      setOfferNote('');
      showToast('Offer sent.', 'success');
      haptics.success();
    } catch (offerError: any) {
      showToast(offerError?.message || 'Unable to send offer', 'error');
    } finally {
      setSendingOffer(false);
    }
  };

  const handleVoiceRecorded = useCallback(
    (recorded: VoiceRecordingResult) => {
      if (!user || !threadId || isBlockedPeer) return;

      const clientMsgId = buildClientMessageId();
      const optimisticId = `local-voice-${clientMsgId}`;
      voiceRetryRef.current.set(optimisticId, recorded);

      // Fire-and-forget: bubble is painted inside sendVoice before any network work.
      void sendVoice({
        localUri: recorded.uri,
        durationMs: recorded.durationMs,
        mime: recorded.mime,
        clientMsgId,
        optimisticId,
      })
        .then(() => {
          voiceRetryRef.current.delete(optimisticId);
          haptics.success();
        })
        .catch((error: any) => {
          showToast(error?.message || "Couldn't send voice note", 'error');
          haptics.warning();
        });
    },
    [isBlockedPeer, sendVoice, threadId, user]
  );

  const handleRetryVoice = useCallback(
    (messageId: string) => {
      const recorded = voiceRetryRef.current.get(messageId);
      if (!recorded) {
        showToast('Voice note unavailable to retry.', 'error');
        return;
      }
      void sendVoice({
        localUri: recorded.uri,
        durationMs: recorded.durationMs,
        mime: recorded.mime,
        optimisticId: messageId,
      })
        .then(() => {
          voiceRetryRef.current.delete(messageId);
          haptics.success();
        })
        .catch((error: any) => {
          showToast(error?.message || "Couldn't send voice note", 'error');
          haptics.warning();
        });
    },
    [sendVoice]
  );

  const handlePickImage = async () => {
    if (isBlockedPeer || !user || !threadId) return;

    const sendPickedUri = async (uri: string) => {
      setSending(true);
      try {
        const uploaded = await uploadImage(
          uri,
          `chatImages/${user.uid}/${Date.now()}_image.jpg`
        );
        const { chatApi } = await import('@/lib/api/chat');
        const saved = await chatApi.sendMessage(threadId, {
          type: 'image',
          attachment: { url: uploaded.url, mimeType: 'image/jpeg' },
          clientMsgId: buildClientMessageId(),
        });
        appendMessage(saved);
        haptics.success();
      } catch (pickError: any) {
        showToast(pickError?.message || 'Failed to send image', 'error');
      } finally {
        setSending(false);
      }
    };

    Alert.alert('Attach photo', undefined, [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Camera access is required to take a photo.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            quality: 0.8,
          });
          if (result.canceled || !result.assets[0]) return;
          await sendPickedUri(result.assets[0].uri);
        },
      },
      {
        text: 'Photo library',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'We need access to your photos to send images.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            quality: 0.8,
          });
          if (result.canceled || !result.assets[0]) return;
          await sendPickedUri(result.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingHorizontal: 24 }]}>
        <Text style={{ color: colors.text }}>Sign in to chat</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      <ChatHeader
        canSendOffer={canSendOffer}
        colors={colors}
        headerAvatarUri={peer?.avatarUrl || undefined}
        headerName={peer?.displayName || 'Deal room'}
        headerSubtitle={presenceSubtitle}
        insetTop={insets.top}
        onBack={goBackToInbox}
        onOpenPeerHub={!embedded && peerId ? openPeerHub : undefined}
        onOpenOffer={() => {
          if (!canSendOffer) return;
          haptics.light();
          setOfferVisible(true);
        }}
      />

      <ProductRoomSwitcher
        currentThreadId={threadId}
        peerId={peerId}
        rooms={enrichedInboxRooms}
      />

      <DealProductHero
        postId={thread?.postId}
        snapshot={resolvedPostSnapshot}
        peerName={peer?.displayName}
        threadStatus={thread?.status}
        linkedOrderId={linkedOrderId || null}
        canMakeOffer={canSendOffer}
        onMakeOffer={() => setOfferVisible(true)}
      />

      {showOrderProgress ? (
        <DealOrderProgressBar orderStatus={linkedOrder?.status || 'Paid'} />
      ) : (
        <DealStageBar status={thread?.status} />
      )}

      {canMarkShipped ? (
        <AnimatedPressable
          style={{
            marginHorizontal: 12,
            marginBottom: 4,
            marginTop: 2,
            borderRadius: 12,
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: lightBrown,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: shippingBusy ? 0.7 : 1,
          }}
          disabled={shippingBusy}
          onPress={handleMarkShipped}
          scaleValue={0.97}>
          {shippingBusy ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <IconSymbol name="shippingbox.fill" size={16} color="#FFFFFF" />
          )}
          <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13 }}>
            Mark shipped
          </Text>
        </AnimatedPressable>
      ) : null}

      {canNegotiateOffers ? <NegotiationTimeline messages={messages} /> : null}

      {canNegotiateOffers && pendingOfferMessage?.offer ? (
        <OfferActionBar
          offerId={pendingOfferMessage.offer.id}
          amount={pendingOfferMessage.offer.amount}
          currency={pendingOfferMessage.offer.currency}
          lowball={(pendingOfferMessage.offer as { lowball?: boolean }).lowball}
          isBuyer={isBuyer}
          status="pending"
          onAccept={async () => {
            await respondToOffer(pendingOfferMessage.offer!.id, 'accept');
            haptics.success();
          }}
          onDecline={async () => {
            await respondToOffer(pendingOfferMessage.offer!.id, 'decline');
          }}
          onCounter={async (amount) => {
            await respondToOffer(pendingOfferMessage.offer!.id, 'counter', { amount });
            haptics.success();
          }}
        />
      ) : null}

      {canNegotiateOffers && !pendingOfferMessage && acceptedOfferMessage?.offer && isBuyer ? (
        <OfferActionBar
          offerId={acceptedOfferMessage.offer.id}
          amount={acceptedOfferMessage.offer.amount}
          currency={acceptedOfferMessage.offer.currency}
          isBuyer
          status="accepted"
          onAccept={async () => {}}
          onDecline={async () => {}}
          onCounter={async () => {}}
          onBuy={() =>
            handleOpenOffer({
              postId: thread!.postId,
              sellerId: thread!.sellerId,
              price: acceptedOfferMessage.offer!.amount,
              chatId: threadId || undefined,
            })
          }
        />
      ) : null}

      <OfferInlinePanel
        visible={offerVisible && canSendOffer}
        colors={colors}
        offerAmount={offerAmount}
        offerNote={offerNote}
        sending={sendingOffer}
        onChangeOfferAmount={setOfferAmount}
        onChangeOfferNote={setOfferNote}
        onSend={handleSendOffer}
        onClose={() => setOfferVisible(false)}
      />

      <View style={{ flex: 1, minHeight: 0 }}>
        {renderedMessages.length > 0 || (loading && thread) ? (
          <ChatList
            activeChatId={threadId}
            colors={colors}
            currentUserId={userId}
            flatListRef={flatListRef}
            insetsBottom={0}
            messages={renderedMessages}
            onOpenOffer={handleOpenOffer}
            onRetryVoice={handleRetryVoice}
            peerAvatarUri={peer?.avatarUrl || undefined}
            unreadCount={0}
            unreadDividerMessageId=""
          />
        ) : (
          <View style={[styles.emptyContainer, { paddingHorizontal: 24 }]}>
            {loading ? (
              <>
                <ActivityIndicator color={lightBrown} />
                <Text style={[styles.emptySubtext, { color: colors.textSecondary, marginTop: 12 }]}>
                  Opening deal room…
                </Text>
              </>
            ) : error ? (
              <>
                <IconSymbol name="exclamationmark.triangle.fill" size={40} color={colors.error} />
                <Text style={[styles.emptyText, { color: colors.error }]}>{error.message}</Text>
              </>
            ) : (
              <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
                This is your private deal room for this product. Send a note or make an offer.
              </Text>
            )}
          </View>
        )}
      </View>

      {!isBlockedPeer ? (
        <ChatComposer
          colors={colors}
          messageText={messageText}
          onChangeMessageText={setMessageText}
          onOpenOffer={() => {
            if (!canSendOffer) return;
            setOfferVisible(true);
          }}
          onPickImage={handlePickImage}
          onSend={handleSend}
          sending={sending}
          showInlineOfferCta={canSendOffer && isSeller}
          showOfferAction={canSendOffer}
          insetBottom={embedded ? 12 : insets.bottom}
          enableVoice
          voiceBusy={false}
          voiceDisabled={sending}
          onVoiceRecorded={handleVoiceRecorded}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
