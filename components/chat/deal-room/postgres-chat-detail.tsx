import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type FlatList,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DealProductHero } from '@/components/chat/deal-product-hero';
import { DealStatusStrip } from '@/components/chat/deal-status-strip';
import { OfferActionBar } from '@/components/chat/offer-action-bar';
import { OfferInlinePanel } from '@/components/chat/offer-inline-panel';
import { ProductRoomSwitcher } from '@/components/chat/product-room-switcher';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { chatMessageToMarketMessage } from '@/lib/chat/map-messages';
import { enrichInboxRoomsWithPosts, productTitleOrFallback, snapshotFromMarketPost } from '@/lib/chat/enrich-inbox-snapshots';
import { useBlockedUserIds } from '@/lib/hooks/use-social';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPost, useMarketPostsByIds } from '@/lib/hooks/use-market-post';
import { useDealOrder, useInvalidateOrder } from '@/lib/hooks/use-order';
import { useChatThread } from '@/lib/hooks/use-chat-thread';
import type { VoiceRecordingResult } from '@/lib/hooks/use-voice-recorder';
import { useTheme } from '@/lib/theme/theme-context';
import { orderApi } from '@/lib/api/orders';
import { chatApi } from '@/lib/api/chat';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { buildUserMediaPath } from '@/lib/utils/media-path';
import { uploadImage } from '@/lib/utils/image-upload';
import { retryQuoteMessage } from '@/lib/utils/market-ask-price-chat';
import { chatVoicePlayer } from '@/lib/chat/voice-player';
import {
  findThreadQueryByPostAndPeer,
  getInboxItems,
  getThreadQueryData,
  migrateChatThreadQuery,
  patchThreadQueryData,
  replaceInboxThreadId,
  seedThreadFromInbox,
  setThreadQueryData,
} from '@/lib/chat/chat-query-cache';
import { isPendingThreadId, parsePendingThreadId } from '@/lib/chat/thread-id';
import { mergeThreadMessages } from '@/lib/chat/thread-messages';
import { useMarketChatStore } from '@/lib/stores/marketChatStore';
import { MarketMessage, MarketPost } from '@/types';
import { AnimatedPressable } from '@/components/animated-pressable';
import { Alert } from '@/components/app-alert';

import type { ChatInboxItem } from '@/types/chat';

import { ChatComposer } from './chat-composer';
import { ChatHeader } from './chat-header';
import { ChatList } from './chat-list';
import { styles } from './styles';
import { useChatRoute } from './use-chat-route';
import { buildClientMessageId, lightBrown } from './utils';

const EMPTY_INBOX_ITEMS: ChatInboxItem[] = [];

type PostgresChatDetailProps = {
  embeddedThreadId?: string | null;
  embeddedPeerId?: string | null;
  embedded?: boolean;
  onClose?: () => void;
  onThreadIdResolved?: (threadId: string) => void;
};

export function PostgresChatDetail({
  embeddedThreadId = null,
  embeddedPeerId = null,
  embedded = false,
  onClose,
  onThreadIdResolved,
}: PostgresChatDetailProps = {}) {
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const marketLoginRoute = getLoginRouteForVariant('market');
  const userId = user?.uid || null;
  const queryClient = useQueryClient();
  const [inboxVersion, setInboxVersion] = useState(0);
  const { idSet: blockedIds } = useBlockedUserIds(userId);
  const setActiveMarketConversationId = useMarketChatStore((s) => s.setActiveMarketConversationId);

  useEffect(() => {
    if (!userId) return;
    return queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (key[0] === 'chat' && key[1] === 'inbox' && key[2] === userId) {
        setInboxVersion((v) => v + 1);
      }
    });
  }, [userId, queryClient]);

  // 1 = expanded chrome (product tabs + card), 0 = collapsed for fuller chat
  const chromeProgress = useSharedValue(1);
  const chromeCollapsedRef = useRef(false);
  const [chromeCollapsed, setChromeCollapsed] = useState(false);
  const lastChatOffsetRef = useRef(0);
  const keyboardVisibleRef = useRef(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [resolvedThreadId, setResolvedThreadId] = useState<string | null>(null);
  const onThreadIdResolvedRef = useRef(onThreadIdResolved);
  onThreadIdResolvedRef.current = onThreadIdResolved;

  const route = useChatRoute(userId);
  const routeOrEmbeddedId = embeddedThreadId || route.activeChatId;
  const threadIdBase = routeOrEmbeddedId;
  const threadId = resolvedThreadId || threadIdBase;
  const resolvedPeerId = embeddedPeerId || route.resolvedPeerId;
  const goBackToInbox = embedded ? () => onClose?.() : route.goBack;

  React.useEffect(() => {
    setResolvedThreadId(null);
  }, [threadIdBase]);

  // Bind pending → real UUID once. Do NOT cancel on unrelated re-renders (that left feed chats orphaned).
  React.useEffect(() => {
    if (!threadIdBase || !userId || !isPendingThreadId(threadIdBase)) return;
    const pending = parsePendingThreadId(threadIdBase);
    if (!pending) return;

    const localHit = findThreadQueryByPostAndPeer(pending.postId, pending.peerId);
    const localId = String(localHit?.thread?.id || '').trim();
    if (localId && !isPendingThreadId(localId)) {
      migrateChatThreadQuery(threadIdBase, localId);
      setResolvedThreadId(localId);
      replaceInboxThreadId(userId, threadIdBase, localId);
      return;
    }

    let alive = true;

    void (async () => {
      try {
        const { thread, isNew } = await chatApi.getOrCreateThread(pending.postId, pending.peerId);

        migrateChatThreadQuery(threadIdBase, thread.id);

        const priorCached =
          getThreadQueryData(thread.id) || getThreadQueryData(threadIdBase);
        const priorSnap = priorCached?.thread?.postSnapshot || {};
        const serverSnap = thread.postSnapshot || {};
        const mergedSnapshot = {
          ...serverSnap,
          ...priorSnap,
          title: String(priorSnap.title || serverSnap.title || '').trim() || 'Product',
          imageUrl: priorSnap.imageUrl || serverSnap.imageUrl || null,
        };
        setThreadQueryData(thread.id, {
          thread: { ...thread, postSnapshot: mergedSnapshot },
          peer: priorCached?.peer || undefined,
        });

        replaceInboxThreadId(userId, threadIdBase, thread.id, {
          lastPreview:
            getThreadQueryData(thread.id)?.messages?.slice(-1)[0]?.body || 'New conversation',
          lastAt: new Date().toISOString(),
          postId: thread.postId,
          status: thread.status,
          postSnapshot: mergedSnapshot,
        });

        const cached = getThreadQueryData(thread.id);
        const pendingFlush = (cached?.messages || []).find(
          (m) => (m.payload as any)?.needsServerFlush && m.type === 'quote'
        );

        if (pendingFlush && isNew) {
          const quote = (pendingFlush.payload as any)?.quote || {
            postId: pending.postId,
            previewText: String(pendingFlush.body || ''),
            previewImage: (pendingFlush.payload as any)?.previewImage,
          };
          try {
            const saved = await chatApi.sendMessage(thread.id, {
              type: 'quote',
              body: String(pendingFlush.body || ''),
              clientMsgId: pendingFlush.clientMsgId || pendingFlush.id,
              quote,
            });
            patchThreadQueryData(thread.id, {
              messages: (cached?.messages || [])
                .filter((m) => m.id !== pendingFlush.id && m.clientMsgId !== pendingFlush.clientMsgId)
                .concat([
                  {
                    ...saved,
                    payload: { ...(saved.payload || {}), sendStatus: 'sent' },
                  },
                ]),
            });
            replaceInboxThreadId(userId, thread.id, thread.id, {
              lastPreview: String(saved.body || pendingFlush.body || ''),
              lastAt: saved.createdAt || new Date().toISOString(),
            });
          } catch (err: any) {
            if (alive) showToast(err?.message || 'Failed to send your message', 'error');
            const latestCached = getThreadQueryData(thread.id);
            patchThreadQueryData(thread.id, {
              messages: (latestCached?.messages || cached?.messages || []).map((m) =>
                m.id === pendingFlush.id || m.clientMsgId === pendingFlush.clientMsgId
                  ? {
                      ...m,
                      payload: { ...(m.payload || {}), sendStatus: 'failed', needsServerFlush: false },
                    }
                  : m
              ),
            });
          }
        } else {
          if (pendingFlush && !isNew) {
            patchThreadQueryData(thread.id, {
              messages: (cached?.messages || []).filter(
                (m) =>
                  m.id !== pendingFlush.id &&
                  m.clientMsgId !== pendingFlush.clientMsgId &&
                  !(m.payload as any)?.needsServerFlush
              ),
            });
          }
          void chatApi
            .getMessages(thread.id)
            .then((page) => {
              const current = getThreadQueryData(thread.id);
              patchThreadQueryData(thread.id, {
                messages: mergeThreadMessages(current?.messages || [], page.messages),
              });
            })
            .catch(() => {});
        }

        if (!alive) return;
        setResolvedThreadId(thread.id);
        onThreadIdResolvedRef.current?.(thread.id);
        if (!embedded) {
          try {
            router.replace({
              pathname: '/(market)/messages/[chatId]',
              params: { chatId: thread.id, peerId: pending.peerId },
            } as any);
          } catch {
            try {
              router.setParams({ chatId: thread.id, peerId: pending.peerId } as any);
            } catch {
              // ignore
            }
          }
        }
      } catch (err: any) {
        if (alive) showToast(err?.message || 'Unable to open deal room', 'error');
      }
    })();

    return () => {
      alive = false;
    };
  }, [threadIdBase, userId, embedded]);

  const {
    thread,
    peer,
    peerAvatarUrl,
    messages,
    loading,
    error,
    sendText,
    sendVoice,
    createOffer,
    respondToOffer,
    markRead,
    appendMessage,
    loadOlder,
    hasMore,
    loadingOlder,
  } = useChatThread({ threadId, userId, enabled: Boolean(threadId && userId) });

  // Always load the live post so deal chrome uses posts.title (not stale caption snapshots).
  const { post: hydratedThreadPost } = useMarketPost(thread?.postId || null);
  const resolvedPostSnapshot = useMemo(() => {
    const cachedSnap =
      (threadId ? getThreadQueryData(threadId)?.thread?.postSnapshot : null) ||
      (threadIdBase ? getThreadQueryData(threadIdBase)?.thread?.postSnapshot : null) ||
      null;
    const inboxSnap =
      (userId && threadId
        ? getInboxItems(userId).find((row) => row.threadId === threadId)?.postSnapshot
        : null) || null;
    const existing = thread?.postSnapshot || cachedSnap || inboxSnap || null;
    const fromPost = snapshotFromMarketPost(hydratedThreadPost);
    if (fromPost) {
      return {
        ...(existing || {}),
        ...fromPost,
        title: productTitleOrFallback(hydratedThreadPost?.title || existing?.title),
        imageUrl: fromPost.imageUrl || existing?.imageUrl || null,
      };
    }
    return {
      ...(existing || {}),
      title: productTitleOrFallback(existing?.title),
      imageUrl:
        existing?.imageUrl ||
        (existing as any)?.coverImageUrl ||
        (existing as any)?.thumbnailUrl ||
        null,
    };
  }, [hydratedThreadPost, thread?.postSnapshot, threadId, threadIdBase, userId, inboxVersion]);

  const cachedInboxItems = useMemo(
    () => (userId ? getInboxItems(userId) : EMPTY_INBOX_ITEMS),
    [userId, inboxVersion]
  );
  const siblingRooms = useMemo(() => {
    const pid = String(resolvedPeerId || peer?.id || '').trim();
    if (!pid) return EMPTY_INBOX_ITEMS;
    return cachedInboxItems.filter((item) => String(item.peerId || '').trim() === pid);
  }, [cachedInboxItems, resolvedPeerId, peer?.id]);
  const siblingPostIds = useMemo(
    () =>
      [...new Set(siblingRooms.map((item) => String(item.postId || '').trim()).filter(Boolean))],
    [siblingRooms]
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
    () => enrichInboxRoomsWithPosts(siblingRooms, siblingPostsById),
    [siblingRooms, siblingPostsById]
  );

  // Unread divider (WhatsApp-style): snapshot the unread count when the room opens — before
  // markRead zeroes it — then place a stable divider before the first unread incoming message.
  const [openUnreadCount, setOpenUnreadCount] = useState(0);
  const [unreadDividerId, setUnreadDividerId] = useState('');
  const unreadSnapshotThreadRef = useRef<string | null>(null);

  React.useEffect(() => {
    const id = threadId || '';
    const items = userId ? getInboxItems(userId) : [];
    const item = items.find((row) => row.threadId === id);
    unreadSnapshotThreadRef.current = id;
    setOpenUnreadCount(Number(item?.unreadCount || 0));
    setUnreadDividerId('');
  }, [threadId, userId, inboxVersion]);

  React.useEffect(() => {
    if (!openUnreadCount || unreadDividerId) return;
    if (unreadSnapshotThreadRef.current !== (threadId || '')) return;
    const incoming = messages.filter((m) => String(m.senderId || '') !== String(userId || ''));
    if (!incoming.length) return;
    const target = incoming[Math.max(0, incoming.length - openUnreadCount)];
    if (target?.id) setUnreadDividerId(String(target.id));
  }, [messages, openUnreadCount, unreadDividerId, threadId, userId]);

  useFocusEffect(
    useCallback(() => {
      setActiveMarketConversationId(threadId || null);
      // Don't hit the API with a `pending:` id — it 400s and can interrupt resolution.
      if (threadId && !isPendingThreadId(threadId)) void markRead();
      // Reset chrome whenever this deal room is focused
      chromeCollapsedRef.current = false;
      setChromeCollapsed(false);
      chromeProgress.value = 1;

      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
      const showSub = Keyboard.addListener(showEvent, () => {
        keyboardVisibleRef.current = true;
        setKeyboardOpen(true);
        chromeCollapsedRef.current = true;
        setChromeCollapsed(true);
        chromeProgress.value = withTiming(0, { duration: 180 });
      });
      const hideSub = Keyboard.addListener(hideEvent, () => {
        keyboardVisibleRef.current = false;
        setKeyboardOpen(false);
        // Only re-expand if we're still near the latest messages
        if (lastChatOffsetRef.current >= 28) return;
        chromeCollapsedRef.current = false;
        setChromeCollapsed(false);
        chromeProgress.value = withTiming(1, { duration: 220 });
      });

      return () => {
        setActiveMarketConversationId(null);
        showSub.remove();
        hideSub.remove();
        void chatVoicePlayer.stop();
      };
    }, [threadId, markRead, setActiveMarketConversationId, chromeProgress])
  );

  const peerId = peer?.id || resolvedPeerId || '';
  const roomConnecting = isPendingThreadId(threadId);
  const isBlockedPeer = Boolean(peerId && blockedIds.has(String(peerId)));

  // Instant header/cover hints from inbox — don't wait on getThread for name/avatar.
  const inboxRoomHint = useMemo(() => {
    if (!userId) return null;
    const items = getInboxItems(userId);
    return (
      items.find((row) => row.threadId === threadId) ||
      items.find((row) => row.threadId === threadIdBase) ||
      (peerId
        ? items.find(
            (row) =>
              String(row.peerId || '') === peerId &&
              String(row.postId || '') === String(thread?.postId || '')
          )
        : null) ||
      null
    );
  }, [userId, threadId, threadIdBase, peerId, thread?.postId, inboxVersion]);

  React.useEffect(() => {
    if (!threadId || !inboxRoomHint) return;
    seedThreadFromInbox(inboxRoomHint);
  }, [threadId, inboxRoomHint]);

  const openStoreProfile = useCallback(() => {
    if (!peerId) return;
    haptics.light();
    // Seller store when viewing as buyer; buyer profile still uses seller route for public card.
    router.push(`/(market)/seller/${peerId}` as any);
  }, [peerId]);
  const isSellerOnThread = Boolean(userId && thread && userId === thread.sellerId);
  const isBuyerOnThread = Boolean(userId && thread && userId === thread.buyerId);

  /** Prefer store name — paint from inbox/route immediately, refine when peer loads. */
  const headerStoreName = useMemo(() => {
    if (peer) {
      const store = String(peer.storeName || '').trim();
      if (store) return store;
      const display = String(peer.displayName || '').trim();
      if (display && !display.includes('@') && display !== 'User' && display !== 'Store') {
        return display;
      }
    }
    const fromInbox = String(inboxRoomHint?.peerName || '').trim();
    if (fromInbox && !fromInbox.includes('@') && fromInbox !== 'User' && fromInbox !== 'Seller') {
      return fromInbox;
    }
    return '';
  }, [peer, inboxRoomHint?.peerName]);
  const headerAvatarUri =
    peerAvatarUrl || peer?.avatarUrl || inboxRoomHint?.peerAvatar || undefined;
  // Only spin when we truly have nothing to show for the title.
  const headerLoading = Boolean(peerId && !headerStoreName);
  const threadStatus = String(thread?.status || '');
  const isInOrder = ['in_order', 'order_active', 'completed', 'closed'].includes(threadStatus);
  const linkedOrderIdFromThread = String(thread?.linkedOrderId || '').trim();
  const showOrderProgress = Boolean(linkedOrderIdFromThread) || isInOrder;
  const canNegotiateOffers = !isInOrder;
  // Block every offer entry point (header, hero, inline panel) until a pending thread has
  // resolved to a real server UUID — the API rejects offers on `pending:` ids.
  const canSendOffer = canNegotiateOffers && !isBlockedPeer && !roomConnecting;
  const { order: linkedOrder } = useDealOrder(linkedOrderIdFromThread || null, threadId || null);
  const invalidateOrder = useInvalidateOrder();
  const [shippingBusy, setShippingBusy] = useState(false);

  // Prefer order party ids when thread roles are thin/stale — buyer tools must not disappear.
  const isBuyer = Boolean(
    userId &&
      (isBuyerOnThread || (linkedOrder && userId === linkedOrder.customerId))
  );
  const isSeller = Boolean(
    userId && (isSellerOnThread || (linkedOrder && userId === linkedOrder.sellerId))
  );

  const actionOrderId = String(linkedOrder?.id || linkedOrderIdFromThread || '').trim();
  const linkedOrderId = actionOrderId;

  // Chat milestones are a live signal when the order Query is still stale.
  const milestoneHints = useMemo(() => {
    let shipped = false;
    let received = false;
    let unavailable = false;
    let needsTime = false;
    for (const m of messages) {
      const ev = String((m as any).systemEvent || m.type || '').toLowerCase();
      if (ev === 'order_shipped') shipped = true;
      if (ev === 'order_delivered' || ev === 'order_received' || ev === 'buyer_confirmed') {
        received = true;
      }
      if (ev === 'item_unavailable') unavailable = true;
      if (ev === 'seller_needs_time') needsTime = true;
    }
    return { shipped, received, unavailable, needsTime };
  }, [messages]);

  const orderStatusRaw = String(linkedOrder?.status || '');
  const orderStatus =
    orderStatusRaw ||
    (milestoneHints.received
      ? 'Received'
      : milestoneHints.shipped
        ? 'Sent'
        : milestoneHints.unavailable || milestoneHints.needsTime
          ? 'AvailabilityCheck'
          : isInOrder
            ? 'Processing'
            : '');
  const availabilityStatus = String((linkedOrder as any)?.availabilityStatus || '');
  const waitTimeDays = Number((linkedOrder as any)?.waitTimeDays);
  // "Need more time" → AvailabilityCheck, but seller can still ship early when ready.
  const isAvailabilityWait = Boolean(
    orderStatus === 'AvailabilityCheck' &&
      availabilityStatus !== 'not_available' &&
      (availabilityStatus === 'waiting_buyer_response' ||
        availabilityStatus === 'waiting_restock' ||
        (Number.isFinite(waitTimeDays) && waitTimeDays > 0) ||
        milestoneHints.needsTime)
  );
  const canMarkShipped = Boolean(
    isSeller &&
      actionOrderId &&
      (['Accepted', 'Preparing', 'Processing', 'Paid'].includes(orderStatus) || isAvailabilityWait)
  );
  const canSellerUpdateAvailability = Boolean(
    isSeller &&
      actionOrderId &&
      ['Accepted', 'Preparing', 'Processing', 'Paid'].includes(orderStatus)
  );
  const canBuyerRespondAvailability = Boolean(
    isBuyer &&
      actionOrderId &&
      orderStatus === 'AvailabilityCheck' &&
      !milestoneHints.shipped
  );
  // If thread roles are missing but this user isn't the seller, treat them as buyer for post-ship tools.
  const buyerForOrderActions = Boolean(isBuyer || (actionOrderId && !isSeller && (isInOrder || milestoneHints.shipped)));
  const canConfirmReceipt = Boolean(
    buyerForOrderActions &&
      actionOrderId &&
      (orderStatus === 'Sent' || milestoneHints.shipped) &&
      !['Received', 'Completed', 'Cancelled', 'Disputed'].includes(orderStatusRaw) &&
      !milestoneHints.received
  );
  const canBuyerDispute = Boolean(
    buyerForOrderActions &&
      actionOrderId &&
      (orderStatus === 'Sent' || milestoneHints.shipped) &&
      !['Completed', 'Cancelled', 'Disputed'].includes(orderStatusRaw) &&
      !milestoneHints.received
  );
  // AvailabilityCheck buyers use the dedicated wait/cancel row; sellers can still cancel.
  const canCancelOrder = Boolean(
    actionOrderId &&
      (((isBuyer || isSeller) &&
        ['Paid', 'Processing', 'Accepted', 'Preparing'].includes(orderStatus)) ||
        (isSeller && orderStatus === 'AvailabilityCheck'))
  );
  const canSellerAccept = Boolean(isSeller && actionOrderId && orderStatus === 'Paid');
  const showOrderPhaseDock = Boolean(
    canMarkShipped ||
      canSellerUpdateAvailability ||
      canBuyerRespondAvailability ||
      canConfirmReceipt ||
      canSellerAccept ||
      canCancelOrder
  );
  const [orderActionBusy, setOrderActionBusy] = useState(false);

  const presenceSubtitle = useMemo(() => {
    if (!peer) return 'Deal room';
    if (peer.presence === 'online') return 'Online · tap for store';
    if (peer.presence === 'last_seen' && peer.lastSeenAt) {
      return `Last seen ${new Date(peer.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · store`;
    }
    return 'Tap for store profile';
  }, [peer]);

  const pendingOfferMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m.offer || m.offer.status !== 'pending') continue;
      return m;
    }
    return null;
  }, [messages]);

  const pendingOfferFromBuyer = Boolean(
    pendingOfferMessage?.senderId && thread?.buyerId && pendingOfferMessage.senderId === thread.buyerId
  );
  const canRespondToPendingOffer = Boolean(
    pendingOfferMessage?.senderId && userId && pendingOfferMessage.senderId !== userId
  );

  const acceptedOfferMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.offer?.status === 'accepted') return m;
    }
    return null;
  }, [messages]);

  const flatListRef = useRef<FlatList<MarketMessage>>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [offerVisible, setOfferVisible] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [sendingOffer, setSendingOffer] = useState(false);
  const voiceRetryRef = useRef<Map<string, VoiceRecordingResult>>(new Map());

  const setChromeExpanded = useCallback(
    (expanded: boolean) => {
      const currentlyExpanded = !chromeCollapsedRef.current;
      if (expanded === currentlyExpanded) return;
      chromeCollapsedRef.current = !expanded;
      setChromeCollapsed(!expanded);
      chromeProgress.value = withTiming(expanded ? 1 : 0, { duration: expanded ? 220 : 180 });
    },
    [chromeProgress]
  );

  const handleChatScroll = useCallback(
    (offsetY: number, _deltaY: number) => {
      const absY = Math.abs(offsetY);
      lastChatOffsetRef.current = absY;
      // Keep cards collapsed while typing
      if (keyboardVisibleRef.current) {
        setChromeExpanded(false);
        return;
      }
      // Any scroll away from the latest messages collapses chrome
      if (absY > 20) {
        setChromeExpanded(false);
      } else {
        setChromeExpanded(true);
      }
    },
    [setChromeExpanded]
  );

  const chromeAnimatedStyle = useAnimatedStyle(() => ({
    // Keep a little room for the product card; never fully erase chrome to opacity 0
    maxHeight: interpolate(chromeProgress.value, [0, 1], [56, 220]),
    opacity: interpolate(chromeProgress.value, [0, 1], [0.92, 1]),
    overflow: 'hidden' as const,
  }));

  const hasSellerOfferAlready = useMemo(
    () =>
      messages.some(
        (m) =>
          m.senderId === userId &&
          (m.type === 'offer' || m.type === 'counter' || m.offer != null)
      ),
    [messages, userId]
  );

  const buyerAskedForPrice = useMemo(() => {
    const buyerId = String(thread?.buyerId || '').trim();
    if (!buyerId) return false;
    return messages.some((m) => {
      if (String(m.senderId || '') !== buyerId) return false;
      return /ask for the price|asked for (the )?price/i.test(String(m.body || ''));
    });
  }, [messages, thread?.buyerId]);

  const showInlineOfferCta = Boolean(
    canSendOffer &&
      isSeller &&
      !pendingOfferMessage &&
      !acceptedOfferMessage &&
      !hasSellerOfferAlready &&
      !['accepted', 'offer_sent', 'in_order', 'order_active', 'completed', 'closed'].includes(
        threadStatus
      )
  );

  const renderedMessages = useMemo(() => {
    if (!threadId) return [];
    const postId = String(thread?.postId || '').trim();
    const sellerId = String(thread?.sellerId || '').trim();
    const shippedPhoto = String(linkedOrder?.sentPhotoUrl || '').trim();
    return messages.map((message) => {
      const mapped = chatMessageToMarketMessage(
        message,
        threadId,
        postId,
        peerId,
        sellerId
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
    if (!actionOrderId || shippingBusy) return;
    Alert.alert('Mark as Shipped', 'Attach a dispatch proof photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Ship without proof',
        onPress: () => {
          void (async () => {
            try {
              setShippingBusy(true);
              await orderApi.markAsSent(actionOrderId);
              haptics.success();
              showToast('Order marked as shipped.', 'success');
              await invalidateOrder(actionOrderId);
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
              if (!user?.uid) return;
              const uploaded = await uploadImage(
                result.assets[0].uri,
                buildUserMediaPath('orderProof', user.uid, `${Date.now()}_dispatch.jpg`)
              );
              await orderApi.markAsSent(actionOrderId, uploaded.url);
              haptics.success();
              showToast('Order marked as shipped.', 'success');
              await invalidateOrder(actionOrderId);
            } catch (error: any) {
              showToast(error?.message || 'Unable to mark as shipped.', 'error');
            } finally {
              setShippingBusy(false);
            }
          })();
        },
      },
    ]);
  }, [actionOrderId, shippingBusy, user?.uid, invalidateOrder]);

  const handleSellerNeedsTime = useCallback(() => {
    if (!actionOrderId || orderActionBusy) return;
    Alert.alert('Need more time?', 'Tell the buyer how long before you can ship.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: '2 days',
        onPress: () => {
          void (async () => {
            try {
              setOrderActionBusy(true);
              await orderApi.markAsNotAvailable({
                orderId: actionOrderId,
                waitTimeDays: 2,
                reason: 'Needs a bit more time to prepare/ship',
              });
              haptics.success();
              showToast('Buyer notified — 2 days.', 'success');
              await invalidateOrder(actionOrderId);
            } catch (error: any) {
              showToast(error?.message || 'Could not update order.', 'error');
            } finally {
              setOrderActionBusy(false);
            }
          })();
        },
      },
      {
        text: '4 days',
        onPress: () => {
          void (async () => {
            try {
              setOrderActionBusy(true);
              await orderApi.markAsNotAvailable({
                orderId: actionOrderId,
                waitTimeDays: 4,
                reason: 'Needs more time to prepare/ship',
              });
              haptics.success();
              showToast('Buyer notified — 4 days.', 'success');
              await invalidateOrder(actionOrderId);
            } catch (error: any) {
              showToast(error?.message || 'Could not update order.', 'error');
            } finally {
              setOrderActionBusy(false);
            }
          })();
        },
      },
    ]);
  }, [actionOrderId, orderActionBusy, invalidateOrder]);

  const handleSellerUnavailable = useCallback(() => {
    if (!actionOrderId || orderActionBusy) return;
    Alert.alert(
      'Item not available?',
      'Buyer can cancel for a refund or chat with you to resolve. This posts into the deal room.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Mark unavailable',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                setOrderActionBusy(true);
                await orderApi.markAsNotAvailable({
                  orderId: actionOrderId,
                  reason: 'Item no longer available',
                });
                haptics.success();
                showToast('Buyer notified in chat.', 'success');
                await invalidateOrder(actionOrderId);
              } catch (error: any) {
                showToast(error?.message || 'Could not update order.', 'error');
              } finally {
                setOrderActionBusy(false);
              }
            })();
          },
        },
      ]
    );
  }, [actionOrderId, orderActionBusy, invalidateOrder]);

  const handleBuyerAvailabilityResponse = useCallback(
    (response: 'wait' | 'cancel') => {
      if (!actionOrderId || orderActionBusy) return;
      void (async () => {
        try {
          setOrderActionBusy(true);
          await orderApi.respondToAvailability({ orderId: actionOrderId, response });
          haptics.success();
          await invalidateOrder(actionOrderId);
          showToast(
            response === 'wait'
              ? 'Got it — waiting on seller.'
              : 'Order cancelled. Refund to your payment method is processing.',
            'success'
          );
        } catch (error: any) {
          showToast(error?.message || 'Could not respond.', 'error');
        } finally {
          setOrderActionBusy(false);
        }
      })();
    },
    [actionOrderId, orderActionBusy, invalidateOrder]
  );

  const handleConfirmReceipt = useCallback(() => {
    if (!actionOrderId || orderActionBusy) return;
    Alert.alert('Confirm receipt?', 'Only confirm if you have received the item.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Confirm received',
        onPress: () => {
          void (async () => {
            try {
              setOrderActionBusy(true);
              await orderApi.markAsReceived(actionOrderId);
              haptics.success();
              showToast('Order confirmed. Thank you!', 'success');
              await invalidateOrder(actionOrderId);
            } catch (error: any) {
              showToast(error?.message || 'Unable to confirm receipt.', 'error');
            } finally {
              setOrderActionBusy(false);
            }
          })();
        },
      },
    ]);
  }, [actionOrderId, orderActionBusy, invalidateOrder]);

  const handleOpenDispute = useCallback(() => {
    if (!actionOrderId || orderActionBusy) return;
    Alert.alert('Open dispute?', 'Use this if the item has issues or was not received.', [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Open dispute',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              setOrderActionBusy(true);
              await orderApi.updateStatus(actionOrderId, 'Disputed');
              haptics.success();
              showToast('Dispute opened.', 'success');
              await invalidateOrder(actionOrderId);
            } catch (error: any) {
              showToast(error?.message || 'Unable to open dispute.', 'error');
            } finally {
              setOrderActionBusy(false);
            }
          })();
        },
      },
    ]);
  }, [actionOrderId, orderActionBusy, invalidateOrder]);

  const handleCancelOrder = useCallback(() => {
    if (!actionOrderId || orderActionBusy) return;
    Alert.alert(
      'Cancel order?',
      'A refund will be sent to the original payment method when eligible.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel & refund',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                setOrderActionBusy(true);
                if (orderStatus === 'AvailabilityCheck' && isBuyer) {
                  await orderApi.respondToAvailability({
                    orderId: actionOrderId,
                    response: 'cancel',
                  });
                } else {
                  await orderApi.updateStatus(actionOrderId, 'Cancelled');
                }
                haptics.success();
                showToast('Order cancelled. Refund is processing.', 'success');
                await invalidateOrder(actionOrderId);
              } catch (error: any) {
                showToast(error?.message || 'Unable to cancel order.', 'error');
              } finally {
                setOrderActionBusy(false);
              }
            })();
          },
        },
      ]
    );
  }, [actionOrderId, orderActionBusy, invalidateOrder, orderStatus, isBuyer]);

  const handleSellerAcceptOrder = useCallback(() => {
    if (!actionOrderId || orderActionBusy) return;
    void (async () => {
      try {
        setOrderActionBusy(true);
        await orderApi.updateStatus(actionOrderId, 'Accepted');
        haptics.success();
        showToast('Order accepted.', 'success');
        await invalidateOrder(actionOrderId);
      } catch (error: any) {
        showToast(error?.message || 'Unable to accept order.', 'error');
      } finally {
        setOrderActionBusy(false);
      }
    })();
  }, [actionOrderId, orderActionBusy, invalidateOrder]);

  const handleOpenOffer = useCallback(
    (offer: { postId: string; sellerId: string; price: number; chatId?: string }) => {
      const price = Number(offer.price);
      if (!(price > 0) || !offer.postId) return;
      router.push(
        `/(market)/buy/${encodeURIComponent(offer.postId)}?offerPrice=${encodeURIComponent(String(price))}&chatId=${encodeURIComponent(offer.chatId || threadId || '')}&sellerId=${encodeURIComponent(offer.sellerId)}` as any
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
    if (isBlockedPeer || !user || !threadId || roomConnecting) return;
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
      showToast(isBuyer ? 'Buying offer sent.' : 'Offer sent.', 'success');
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

  const handleRetryMessage = useCallback(
    (message: MarketMessage) => {
      if (!threadId || isPendingThreadId(threadId)) return;
      haptics.light();
      if (message.type === 'quote') {
        retryQuoteMessage(threadId, {
          id: String(message.id || ''),
          clientMessageId: message.clientMessageId,
          text: message.text,
          quoteCard: message.quoteCard,
        });
        return;
      }
      const body = String(message.text || message.message || '').trim();
      if (!body) return;
      void sendText(body, message.clientMessageId || String(message.id || '')).catch(
        (err: any) => {
          showToast(err?.message || 'Failed to send message', 'error');
        }
      );
    },
    [threadId, sendText]
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
    if (isBlockedPeer || !user || !threadId || roomConnecting) return;

    const sendPickedUri = async (uri: string) => {
      setSending(true);
      try {
        const uploaded = await uploadImage(
          uri,
          buildUserMediaPath('chatImages', user.uid, `${Date.now()}_image.jpg`)
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
      behavior="padding"
      keyboardVerticalOffset={0}>
      <ChatHeader
        canSendOffer={canSendOffer}
        colors={colors}
        headerAvatarUri={headerAvatarUri}
        headerName={headerStoreName}
        headerLoading={headerLoading}
        headerSubtitle={
          roomConnecting ? 'Opening deal…' : presenceSubtitle
        }
        isVerified={Boolean(peer?.isVerified)}
        insetTop={insets.top}
        onBack={goBackToInbox}
        onOpenProfile={!embedded && peerId ? openStoreProfile : undefined}
        onOpenOffer={() => {
          if (!canSendOffer) return;
          haptics.light();
          setOfferVisible(true);
        }}
      />

      <Animated.View
        style={chromeAnimatedStyle}
        pointerEvents={chromeCollapsed ? 'none' : 'box-none'}>
        <ProductRoomSwitcher
          currentThreadId={threadId}
          peerId={peerId}
          rooms={enrichedInboxRooms}
        />

        <DealProductHero
          postId={thread?.postId}
          snapshot={resolvedPostSnapshot}
          peerName={headerStoreName || undefined}
          threadStatus={thread?.status}
          linkedOrderId={linkedOrderId || null}
          canMakeOffer={canSendOffer}
          onMakeOffer={() => setOfferVisible(true)}
        />
      </Animated.View>

      <View style={{ flex: 1, minHeight: 0 }}>
        {renderedMessages.length > 0 ? (
          <ChatList
            activeChatId={threadId}
            colors={colors}
            currentUserId={userId}
            flatListRef={flatListRef}
            insetsBottom={0}
            messages={renderedMessages}
            onOpenOffer={handleOpenOffer}
            onRetryVoice={handleRetryVoice}
            onRetryMessage={handleRetryMessage}
            peerAvatarUri={headerAvatarUri}
            onScrollOffsetChange={handleChatScroll}
            onLoadOlder={hasMore ? loadOlder : undefined}
            loadingOlder={loadingOlder}
            unreadCount={openUnreadCount}
            unreadDividerMessageId={unreadDividerId}
          />
        ) : loading && !thread && !inboxRoomHint ? (
          <View style={[styles.emptyContainer, { paddingHorizontal: 24 }]}>
            <ActivityIndicator color={lightBrown} />
            <Text style={[styles.emptySubtext, { color: colors.textSecondary, marginTop: 12 }]}>
              Loading messages…
            </Text>
          </View>
        ) : (
          <View style={[styles.emptyContainer, { paddingHorizontal: 24 }]}>
            {error ? (
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

      {!keyboardOpen ? (
        <DealStatusStrip
          threadStatus={thread?.status}
          orderStatus={linkedOrder?.status}
          escrowStatus={(linkedOrder as any)?.escrowStatus}
          refundStatus={(linkedOrder as any)?.refundStatus}
          availabilityStatus={(linkedOrder as any)?.availabilityStatus}
          waitTimeDays={(linkedOrder as any)?.waitTimeDays}
          hasLinkedOrder={Boolean(linkedOrderId) || showOrderProgress}
        />
      ) : null}

      {/* Buyer post-ship tools stay visible even with keyboard up — confirm/dispute can't vanish. */}
      {canConfirmReceipt || canBuyerDispute ? (
        <View style={{ marginHorizontal: 12, marginBottom: 4, marginTop: 2, gap: 8 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
            Package marked shipped — confirm when it arrives, or raise a complaint.
          </Text>
          {canConfirmReceipt ? (
            <AnimatedPressable
              style={{
                borderRadius: 12,
                paddingVertical: 12,
                paddingHorizontal: 12,
                backgroundColor: '#10B981',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: orderActionBusy ? 0.7 : 1,
              }}
              disabled={orderActionBusy}
              onPress={handleConfirmReceipt}
              scaleValue={0.97}>
              <IconSymbol name="checkmark.circle.fill" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>
                Confirm receipt
              </Text>
            </AnimatedPressable>
          ) : null}
          {canBuyerDispute ? (
            <TouchableOpacity
              style={{
                borderRadius: 12,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: `${colors.error}55`,
                backgroundColor: colors.card,
                alignItems: 'center',
                opacity: orderActionBusy ? 0.7 : 1,
              }}
              disabled={orderActionBusy}
              onPress={handleOpenDispute}>
              <Text style={{ color: colors.error, fontWeight: '700', fontSize: 13 }}>
                Raise complaint / dispute
              </Text>
            </TouchableOpacity>
          ) : null}
          {linkedOrderId ? (
            <TouchableOpacity
              style={{ alignItems: 'center', paddingVertical: 2 }}
              onPress={() => {
                haptics.light();
                router.push(`/(market)/orders/${encodeURIComponent(linkedOrderId)}` as any);
              }}>
              <Text style={{ color: lightBrown, fontWeight: '700', fontSize: 12 }}>
                View order details
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {!keyboardOpen && showOrderPhaseDock && !canConfirmReceipt ? (
        <View style={{ marginHorizontal: 12, marginBottom: 4, marginTop: 2, gap: 8 }}>
          {canSellerAccept ? (
            <AnimatedPressable
              style={{
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: lightBrown,
                alignItems: 'center',
                opacity: orderActionBusy ? 0.7 : 1,
              }}
              disabled={orderActionBusy}
              onPress={handleSellerAcceptOrder}
              scaleValue={0.97}>
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13 }}>Accept order</Text>
            </AnimatedPressable>
          ) : null}

          {canMarkShipped && isAvailabilityWait ? (
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
              {Number.isFinite(waitTimeDays) && waitTimeDays > 0
                ? `You told the buyer ~${waitTimeDays} day(s) — ship as soon as it's ready.`
                : "Ship as soon as it's ready — no need to wait out the delay."}
            </Text>
          ) : null}
          {canMarkShipped ? (
            <AnimatedPressable
              style={{
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: lightBrown,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: shippingBusy || orderActionBusy ? 0.7 : 1,
              }}
              disabled={shippingBusy || orderActionBusy}
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

          {canSellerUpdateAvailability ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  alignItems: 'center',
                  opacity: orderActionBusy ? 0.7 : 1,
                }}
                disabled={orderActionBusy}
                onPress={handleSellerNeedsTime}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                  Need more time
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: `${colors.error}55`,
                  backgroundColor: colors.card,
                  alignItems: 'center',
                  opacity: orderActionBusy ? 0.7 : 1,
                }}
                disabled={orderActionBusy}
                onPress={handleSellerUnavailable}>
                <Text style={{ color: colors.error, fontWeight: '700', fontSize: 12 }}>
                  Not available
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {canBuyerRespondAvailability ? (
            <>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                Seller needs more time — wait, or cancel for a refund.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    paddingVertical: 10,
                    backgroundColor: lightBrown,
                    alignItems: 'center',
                    opacity: orderActionBusy ? 0.7 : 1,
                  }}
                  disabled={orderActionBusy}
                  onPress={() => handleBuyerAvailabilityResponse('wait')}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12 }}>
                    I can wait
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: 'center',
                    opacity: orderActionBusy ? 0.7 : 1,
                  }}
                  disabled={orderActionBusy}
                  onPress={() => handleBuyerAvailabilityResponse('cancel')}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                    Cancel & refund
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          {canCancelOrder ? (
            <TouchableOpacity
              style={{
                borderRadius: 12,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                alignItems: 'center',
                opacity: orderActionBusy ? 0.7 : 1,
              }}
              disabled={orderActionBusy}
              onPress={handleCancelOrder}>
              <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: 12 }}>
                Cancel order
              </Text>
            </TouchableOpacity>
          ) : null}

          {linkedOrderId ? (
            <TouchableOpacity
              style={{ alignItems: 'center', paddingVertical: 4 }}
              onPress={() => {
                haptics.light();
                router.push(`/(market)/orders/${encodeURIComponent(linkedOrderId)}` as any);
              }}>
              <Text style={{ color: lightBrown, fontWeight: '700', fontSize: 12 }}>
                View order details
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {canNegotiateOffers && pendingOfferMessage?.offer ? (
        <OfferActionBar
          offerId={pendingOfferMessage.offer.id}
          amount={pendingOfferMessage.offer.amount}
          currency={pendingOfferMessage.offer.currency}
          lowball={(pendingOfferMessage.offer as { lowball?: boolean }).lowball}
          canRespond={canRespondToPendingOffer}
          offerFrom={pendingOfferFromBuyer ? 'buyer' : 'seller'}
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
          canRespond={false}
          offerFrom={
            acceptedOfferMessage.senderId === thread?.buyerId ? 'buyer' : 'seller'
          }
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
        role={isBuyer ? 'buyer' : 'seller'}
        offerAmount={offerAmount}
        offerNote={offerNote}
        sending={sendingOffer}
        onChangeOfferAmount={setOfferAmount}
        onChangeOfferNote={setOfferNote}
        onSend={handleSendOffer}
        onClose={() => setOfferVisible(false)}
      />

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
          // Never spin the send button for roomConnecting — that felt like a stuck deal.
          // Pending rooms show "Opening deal…" in the header instead.
          sending={sending}
          showInlineOfferCta={showInlineOfferCta && !roomConnecting}
          inlineOfferCtaLabel={
            buyerAskedForPrice ? 'Buyer asked for price — send offer' : 'Send offer'
          }
          showOfferAction={canSendOffer && !roomConnecting}
          insetBottom={
            keyboardOpen
              ? Platform.OS === 'ios'
                ? 8
                : 6
              : embedded
                ? 10
                : Math.max(insets.bottom, 10)
          }
          enableVoice
          voiceBusy={false}
          voiceDisabled={sending || roomConnecting}
          onVoiceRecorded={handleVoiceRecorded}
          offerActionLabel={isBuyer ? 'Make buying offer' : 'Make offer'}
          onInputFocus={() => {
            keyboardVisibleRef.current = true;
            setKeyboardOpen(true);
            setChromeExpanded(false);
          }}
        />
      ) : (
        <View
          style={{
            marginHorizontal: 12,
            marginBottom: Math.max(insets.bottom, 12),
            marginTop: 8,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            backgroundColor: colors.card,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
            You blocked this user
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
            Messaging and offers are disabled in this deal room.
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
