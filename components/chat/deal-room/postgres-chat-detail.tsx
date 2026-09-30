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

import { ProductDealBand } from '@/components/chat/deal-room/product-deal-band';
import { OfferActionBar } from '@/components/chat/offer-action-bar';
import { OfferInlinePanel } from '@/components/chat/offer-inline-panel';
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
import { Alert } from '@/components/app-alert';

import type { ChatInboxItem } from '@/types/chat';

import { DealCheckoutSheet } from '@/components/chat/deal-room/deal-checkout-sheet';
import { DealActionsSheet, type DealSheetAction } from '@/components/chat/deal-room/deal-actions-sheet';
import { DealActionRibbon, type DealRibbonAction } from '@/components/chat/deal-room/deal-action-ribbon';
import { DisputeCaseSheet } from '@/components/chat/deal-room/dispute-case-sheet';
import { ReviewSheet } from '@/components/chat/deal-room/review-sheet';
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
  // Once a price is agreed (offer accepted) the number is locked — no more offer entry points.
  const offersLocked = isInOrder || threadStatus === 'accepted';
  const canNegotiateOffers = !offersLocked;
  // Block every offer entry point (header, hero, inline panel) until a pending thread has
  // resolved to a real server UUID — the API rejects offers on `pending:` ids.
  const canSendOffer = canNegotiateOffers && !isBlockedPeer && !roomConnecting;
  const { order: linkedOrder } = useDealOrder(linkedOrderIdFromThread || null, threadId || null);
  const invalidateOrder = useInvalidateOrder();
  const [shippingBusy, setShippingBusy] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutUnitPrice, setCheckoutUnitPrice] = useState(0);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);

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
  const escrowHeld =
    String((linkedOrder as any)?.escrowStatus || 'held') !== 'released' &&
    String((linkedOrder as any)?.escrowStatus || '') !== 'refunded';
  const canBuyerDispute = Boolean(
    buyerForOrderActions &&
      actionOrderId &&
      escrowHeld &&
      !['Completed', 'Cancelled', 'Disputed'].includes(orderStatusRaw) &&
      !milestoneHints.received
  );
  const canLeaveReview = Boolean(
    buyerForOrderActions &&
      actionOrderId &&
      (orderStatusRaw === 'Completed' || orderStatusRaw === 'Received' || milestoneHints.received)
  );
  // AvailabilityCheck buyers use the dedicated wait/cancel row; sellers can still cancel.
  const canCancelOrder = Boolean(
    actionOrderId &&
      (((isBuyer || isSeller) &&
        ['Paid', 'Processing', 'Accepted', 'Preparing'].includes(orderStatus)) ||
        (isSeller && orderStatus === 'AvailabilityCheck'))
  );
  const canSellerAccept = Boolean(isSeller && actionOrderId && orderStatus === 'Paid');
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
        sellerId,
        offersLocked
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
  }, [linkedOrder?.sentPhotoUrl, messages, offersLocked, thread, threadId, peerId]);

  const handleMarkShipped = useCallback(() => {
    if (!actionOrderId || shippingBusy) return;
    Alert.alert("I've sent it", 'Add a photo of the parcel? Buyers like seeing it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send without photo',
        onPress: () => {
          void (async () => {
            try {
              setShippingBusy(true);
              await orderApi.markAsSent(actionOrderId);
              haptics.success();
              showToast('Marked as sent — the buyer can see it now.', 'success');
              await invalidateOrder(actionOrderId);
            } catch (error: any) {
              showToast(error?.message || 'Could not update the order.', 'error');
            } finally {
              setShippingBusy(false);
            }
          })();
        },
      },
      {
        text: 'Add photo',
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
              showToast('Marked as sent — the buyer can see it now.', 'success');
              await invalidateOrder(actionOrderId);
            } catch (error: any) {
              showToast(error?.message || 'Could not update the order.', 'error');
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
    Alert.alert('Need more time?', 'Tell the buyer how long before you can send it.', [
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
                reason: 'Needs a bit more time to send',
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
                reason: 'Needs more time to send',
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
      "You can't supply this?",
      'The buyer can cancel for a refund or chat with you to sort it out. This posts into the deal room.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: "Can't supply it",
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                setOrderActionBusy(true);
                await orderApi.markAsNotAvailable({
                  orderId: actionOrderId,
                  reason: "Seller can't supply this item",
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
              : 'Cancelled — refund on the way.',
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
    Alert.alert('Did you get it?', 'Only confirm once the item is in your hands — this releases the money.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Yes, I got it',
        onPress: () => {
          void (async () => {
            try {
              setOrderActionBusy(true);
              await orderApi.markAsReceived(actionOrderId);
              haptics.success();
              showToast('Received — thanks!', 'success');
              await invalidateOrder(actionOrderId);
              setReviewOpen(true);
            } catch (error: any) {
              showToast(error?.message || 'Could not confirm.', 'error');
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
    haptics.light();
    setDisputeOpen(true);
  }, [actionOrderId, orderActionBusy]);

  const handleCancelOrder = useCallback(() => {
    if (!actionOrderId || orderActionBusy) return;
    Alert.alert(
      'Cancel this order?',
      'A refund goes back to the original payment method.',
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
                showToast('Cancelled — refund on the way.', 'success');
                await invalidateOrder(actionOrderId);
              } catch (error: any) {
                showToast(error?.message || 'Could not cancel.', 'error');
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
        showToast('Accepted — buyer can now pay.', 'success');
        await invalidateOrder(actionOrderId);
      } catch (error: any) {
        showToast(error?.message || 'Could not accept.', 'error');
      } finally {
        setOrderActionBusy(false);
      }
    })();
  }, [actionOrderId, orderActionBusy, invalidateOrder]);

  const handleOpenOffer = useCallback(
    (offer: { postId: string; sellerId: string; price: number; chatId?: string }) => {
      const price = Number(offer.price);
      if (!(price > 0) || !offer.postId) return;
      setCheckoutUnitPrice(price);
      setCheckoutOpen(true);
    },
    []
  );

  const handleOpenPost = useCallback((postId: string) => {
    const id = String(postId || '').trim();
    if (!id) return;
    haptics.light();
    router.push(`/(market)/post/${id}` as any);
  }, []);

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

  // ---- One ribbon, one primary, everything else behind the sheet ----

  /** Dismiss the sheet first, then open whichever modal the row launches. */
  const runSheetAction = useCallback((fn: () => void) => {
    setActionsSheetOpen(false);
    // Let the sheet finish closing before another modal slides in.
    setTimeout(fn, 260);
  }, []);

  /** Buyer accepted an offer but hasn't paid yet — the room's only job is checkout. */
  const canCompletePurchase = Boolean(
    !isInOrder && !pendingOfferMessage && acceptedOfferMessage?.offer && isBuyer
  );

  /** While a price is on the table the offer card owns the phase — the ribbon steps aside. */
  const showPendingOfferCard = Boolean(pendingOfferMessage?.offer && !isInOrder);

  const dealPrimaryAction = useMemo<DealRibbonAction | null>(() => {
    if (canSellerAccept) {
      return { label: 'Accept order', onPress: handleSellerAcceptOrder, busy: orderActionBusy };
    }
    if (canConfirmReceipt) {
      return {
        label: 'I got it',
        icon: 'checkmark.circle.fill',
        tone: 'success',
        onPress: handleConfirmReceipt,
        busy: orderActionBusy,
      };
    }
    if (canMarkShipped) {
      return {
        label: "I've sent it",
        icon: 'shippingbox.fill',
        onPress: handleMarkShipped,
        busy: shippingBusy || orderActionBusy,
      };
    }
    if (canBuyerRespondAvailability) {
      return {
        label: 'I can wait',
        onPress: () => handleBuyerAvailabilityResponse('wait'),
        busy: orderActionBusy,
      };
    }
    if (canCompletePurchase) {
      return {
        label: 'Complete purchase',
        icon: 'bag.fill',
        onPress: () => {
          const offer = acceptedOfferMessage?.offer;
          if (!offer || !thread) return;
          handleOpenOffer({
            postId: thread.postId,
            sellerId: thread.sellerId,
            price: offer.amount,
            chatId: threadId || undefined,
          });
        },
      };
    }
    if (canLeaveReview) {
      return {
        label: 'Rate seller',
        icon: 'star.fill',
        onPress: () => setReviewOpen(true),
      };
    }
    return null;
  }, [
    acceptedOfferMessage,
    canBuyerRespondAvailability,
    canCompletePurchase,
    canConfirmReceipt,
    canLeaveReview,
    canMarkShipped,
    canSellerAccept,
    handleBuyerAvailabilityResponse,
    handleConfirmReceipt,
    handleMarkShipped,
    handleOpenOffer,
    handleSellerAcceptOrder,
    orderActionBusy,
    shippingBusy,
    thread,
    threadId,
  ]);

  const dealSecondaryActions = useMemo<DealSheetAction[]>(() => {
    const out: DealSheetAction[] = [];

    if (canBuyerDispute) {
      out.push({
        id: 'dispute',
        label: 'Open a dispute',
        hint: 'Money stays held until support decides.',
        icon: 'exclamationmark.bubble.fill',
        tone: 'danger',
        onPress: () => runSheetAction(handleOpenDispute),
      });
    }
    if (canLeaveReview && dealPrimaryAction?.label !== 'Rate seller') {
      out.push({
        id: 'review',
        label: 'Rate seller',
        icon: 'star.fill',
        onPress: () => runSheetAction(() => setReviewOpen(true)),
      });
    }
    if (canSellerUpdateAvailability) {
      out.push({
        id: 'need-time',
        label: 'I need more time',
        hint: 'Buyer can wait or cancel for a refund.',
        icon: 'clock.fill',
        onPress: handleSellerNeedsTime,
      });
      out.push({
        id: 'unavailable',
        label: "I can't supply this",
        hint: 'The buyer gets a refund.',
        icon: 'xmark',
        tone: 'danger',
        onPress: handleSellerUnavailable,
      });
    }
    if (canBuyerRespondAvailability) {
      out.push({
        id: 'cancel-refund',
        label: 'Cancel & refund',
        icon: 'xmark',
        tone: 'danger',
        onPress: () => handleBuyerAvailabilityResponse('cancel'),
      });
    } else if (canCancelOrder) {
      out.push({
        id: 'cancel',
        label: 'Cancel order',
        hint: 'Refunds the payment to the buyer.',
        icon: 'xmark',
        tone: 'danger',
        onPress: handleCancelOrder,
      });
    }
    if (linkedOrderId) {
      out.push({
        id: 'order-details',
        label: 'View order details',
        icon: 'doc.text.fill',
        onPress: () =>
          runSheetAction(() =>
            router.push(`/(market)/orders/${encodeURIComponent(linkedOrderId)}` as any)
          ),
      });
    }

    return out;
  }, [
    canBuyerDispute,
    canBuyerRespondAvailability,
    canCancelOrder,
    canLeaveReview,
    canSellerUpdateAvailability,
    dealPrimaryAction?.label,
    handleBuyerAvailabilityResponse,
    handleCancelOrder,
    handleOpenDispute,
    handleSellerNeedsTime,
    handleSellerUnavailable,
    linkedOrderId,
    runSheetAction,
  ]);

  /** One sentence of context so the sheet's rows need no explaining. */
  const dealActionsNote = useMemo(() => {
    if (canBuyerDispute) {
      return 'Money is held safely. Open a dispute if something is wrong — it stays held until support decides.';
    }
    if (canBuyerRespondAvailability) {
      return 'Seller needs more time. Wait, or cancel for a full refund.';
    }
    if (canSellerUpdateAvailability) {
      return Number.isFinite(waitTimeDays) && waitTimeDays > 0
        ? `You told the buyer ~${waitTimeDays} day(s) — send it as soon as it's ready, or update them below.`
        : "Send it as soon as it's ready, or update the buyer below.";
    }
    if (canLeaveReview) {
      return 'Item received. Rating the seller closes this deal.';
    }
    if (canCancelOrder) {
      return 'Cancelling refunds the buyer to their original payment method.';
    }
    return undefined;
  }, [
    canBuyerDispute,
    canBuyerRespondAvailability,
    canCancelOrder,
    canLeaveReview,
    canSellerUpdateAvailability,
    waitTimeDays,
  ]);

  // Reading older messages: keep just the primary-action line, and drop the status-only
  // line entirely so the chat gets the full screen back.
  const ribbonAnimatedStyle = useAnimatedStyle(() => {
    const collapsedMax = dealPrimaryAction ? 48 : 0;
    return {
      maxHeight: interpolate(chromeProgress.value, [0, 1], [collapsedMax, 62]),
      opacity: interpolate(chromeProgress.value, [0, 1], [dealPrimaryAction ? 1 : 0, 1]),
      overflow: 'hidden' as const,
    };
  }, [dealPrimaryAction]);

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

    const sendPickedUris = async (uris: string[]) => {
      if (!uris.length) return;
      setSending(true);
      try {
        const { chatApi } = await import('@/lib/api/chat');
        // Several photos become one album: still one attachment per message, but they share an
        // albumId so the deal room renders them as a single grid instead of a stack of bubbles.
        const albumId = uris.length > 1 ? buildClientMessageId() : undefined;
        for (let i = 0; i < uris.length; i += 1) {
          const uploaded = await uploadImage(
            uris[i],
            buildUserMediaPath('chatImages', user.uid, `${Date.now()}_${i}_image.jpg`)
          );
          const saved = await chatApi.sendMessage(threadId, {
            type: 'image',
            attachment: { url: uploaded.url, mimeType: 'image/jpeg' },
            clientMsgId: buildClientMessageId(),
            ...(albumId
              ? { payload: { albumId, albumIndex: i, albumCount: uris.length } }
              : {}),
          });
          appendMessage(saved);
        }
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
          await sendPickedUris([result.assets[0].uri]);
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
          // Multi-select so a whole set of photos goes out as one album grid. `allowsEditing`
          // cannot be combined with multiple selection, so the library skips cropping.
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            selectionLimit: 10,
            quality: 0.8,
          });
          if (result.canceled || !result.assets.length) return;
          await sendPickedUris(result.assets.map((asset) => asset.uri));
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
        threadId={threadId ?? undefined}
        peerId={peerId}
        callsDisabled={!peerId || isBlockedPeer || roomConnecting}
      />

      <ProductDealBand
        currentThreadId={threadId}
        peerId={peerId}
        rooms={enrichedInboxRooms}
        snapshot={resolvedPostSnapshot}
        postId={thread?.postId}
        linkedOrderId={linkedOrderId || null}
      />

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
            onOpenPost={handleOpenPost}
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

      {!showPendingOfferCard ? (
        <Animated.View style={ribbonAnimatedStyle}>
          <DealActionRibbon
            viewer={isSeller ? 'seller' : 'buyer'}
            threadStatus={thread?.status}
            orderStatus={linkedOrder?.status}
            escrowStatus={(linkedOrder as any)?.escrowStatus}
            refundStatus={(linkedOrder as any)?.refundStatus}
            availabilityStatus={(linkedOrder as any)?.availabilityStatus}
            waitTimeDays={(linkedOrder as any)?.waitTimeDays}
            hasLinkedOrder={Boolean(linkedOrderId) || showOrderProgress}
            primary={dealPrimaryAction}
            secondaryCount={keyboardOpen ? 0 : dealSecondaryActions.length}
            onOpenActions={() => setActionsSheetOpen(true)}
            compact={keyboardOpen || chromeCollapsed}
          />
        </Animated.View>
      ) : null}

      {pendingOfferMessage?.offer && !isInOrder ? (
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

      <DealCheckoutSheet
        visible={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        post={
          hydratedThreadPost ||
          (thread?.postId
            ? ({
                id: thread.postId,
                posterId: thread.sellerId,
                price: checkoutUnitPrice,
                title: resolvedPostSnapshot?.title || 'Item',
                images: resolvedPostSnapshot?.imageUrl
                  ? [String(resolvedPostSnapshot.imageUrl)]
                  : [],
              } as MarketPost)
            : null)
        }
        unitPrice={checkoutUnitPrice}
        threadId={threadId}
        onPaid={async (orderId) => {
          setCheckoutOpen(false);
          await invalidateOrder(orderId, userId);
          showToast('Paid — money held safely.', 'success');
        }}
      />
      <DisputeCaseSheet
        visible={disputeOpen}
        orderId={actionOrderId}
        onClose={() => setDisputeOpen(false)}
        onOpened={() => {
          void invalidateOrder(actionOrderId);
        }}
      />
      <ReviewSheet
        visible={reviewOpen}
        orderId={actionOrderId}
        sellerName={headerStoreName}
        onClose={() => setReviewOpen(false)}
      />
      <DealActionsSheet
        visible={actionsSheetOpen}
        onClose={() => setActionsSheetOpen(false)}
        note={dealActionsNote}
        actions={dealSecondaryActions}
      />
    </KeyboardAvoidingView>
  );
}
