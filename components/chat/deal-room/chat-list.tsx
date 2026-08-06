import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Text,
  View,
  ViewToken,
  type FlatList as FlatListType,
} from 'react-native';

import { MessageBubble } from '@/components/market/message-bubble';
import { MarketMessage } from '@/types';

import { styles } from './styles';
import { getMessageTimeMs, getStableMessageKey, lightBrown } from './utils';

type ChatListProps = {
  activeChatId: string | null;
  colors: any;
  currentUserId: string | null;
  insetsBottom: number;
  messages: MarketMessage[];
  onOpenOffer: (offer: { postId: string; sellerId: string; price: number; chatId?: string }) => void;
  onRetryVoice?: (messageId: string) => void;
  onRetryMessage?: (message: MarketMessage) => void;
  peerAvatarUri?: string;
  onLatestVisibleIncomingMessage?: (messageId: string) => void;
  /** Fired while scrolling — used to collapse/expand chrome for fuller chat. */
  onScrollOffsetChange?: (offsetY: number, deltaY: number) => void;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  unreadCount: number;
  unreadDividerMessageId: string;
  flatListRef: React.RefObject<FlatListType<MarketMessage> | null>;
};

export function ChatList({
  activeChatId,
  colors,
  currentUserId,
  flatListRef,
  insetsBottom,
  messages,
  onOpenOffer,
  onRetryVoice,
  onRetryMessage,
  peerAvatarUri,
  onLatestVisibleIncomingMessage,
  onScrollOffsetChange,
  onLoadOlder,
  loadingOlder = false,
  unreadCount,
  unreadDividerMessageId,
}: ChatListProps) {
  // Delay the older-page spinner so fast pages don't flash a loader.
  const [showOlderSpinner, setShowOlderSpinner] = useState(false);
  useEffect(() => {
    if (!loadingOlder) {
      setShowOlderSpinner(false);
      return;
    }
    const t = setTimeout(() => setShowOlderSpinner(true), 220);
    return () => clearTimeout(t);
  }, [loadingOlder]);

  const currentUserIdRef = useRef(currentUserId);
  const onLatestVisibleIncomingMessageRef = useRef(onLatestVisibleIncomingMessage);
  const onScrollOffsetChangeRef = useRef(onScrollOffsetChange);
  const lastOffsetYRef = useRef(0);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    onLatestVisibleIncomingMessageRef.current = onLatestVisibleIncomingMessage;
  }, [onLatestVisibleIncomingMessage]);

  useEffect(() => {
    onScrollOffsetChangeRef.current = onScrollOffsetChange;
  }, [onScrollOffsetChange]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const callback = onLatestVisibleIncomingMessageRef.current;
      const currentUser = currentUserIdRef.current;
      if (!callback || !currentUser) return;

      let latestVisibleIncoming: MarketMessage | null = null;
      viewableItems.forEach((viewable) => {
        if (!viewable.isViewable) return;
        const message = viewable.item as MarketMessage;
        if (!message) return;
        if (String(message.senderId || '') === currentUser) return;
        if (
          !latestVisibleIncoming ||
          getMessageTimeMs(message.createdAt) > getMessageTimeMs(latestVisibleIncoming.createdAt)
        ) {
          latestVisibleIncoming = message;
        }
      });

      const latestVisibleIncomingId = String((latestVisibleIncoming as any)?.id || '').trim();
      if (!latestVisibleIncomingId) return;
      callback(latestVisibleIncomingId);
    }
  );

  const viewabilityConfig = useRef({
    minimumViewTime: 120,
    itemVisiblePercentThreshold: 60,
  });

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const delta = y - lastOffsetYRef.current;
    lastOffsetYRef.current = y;
    onScrollOffsetChangeRef.current?.(y, delta);
  }, []);

  const renderMessageItem = useCallback(
    ({ item }: { item: MarketMessage }) => {
      const shouldShowUnreadDivider =
        Boolean(unreadDividerMessageId) && String(item.id || '').trim() === unreadDividerMessageId;

      return (
        <View>
          {shouldShowUnreadDivider ? (
            <View style={styles.unreadDividerWrap}>
              <View style={[styles.unreadDividerLine, { backgroundColor: colors.border }]} />
              <View style={[styles.unreadDividerPill, { backgroundColor: `${lightBrown}20` }]}>
                <Text style={[styles.unreadDividerText, { color: lightBrown }]}>
                  {unreadCount} unread message{unreadCount > 1 ? 's' : ''}
                </Text>
              </View>
              <View style={[styles.unreadDividerLine, { backgroundColor: colors.border }]} />
            </View>
          ) : null}

          <MessageBubble
            message={item}
            currentUserId={currentUserId}
            peerAvatarUri={peerAvatarUri}
            onOpenOffer={onOpenOffer}
            onRetryVoice={onRetryVoice}
            onRetryMessage={onRetryMessage}
          />
        </View>
      );
    },
    [
      colors.border,
      currentUserId,
      onOpenOffer,
      onRetryVoice,
      onRetryMessage,
      peerAvatarUri,
      unreadCount,
      unreadDividerMessageId,
    ]
  );

  const keyExtractor = useCallback(
    (item: MarketMessage) => getStableMessageKey(item, String(activeChatId || 'chat')),
    [activeChatId]
  );

  // Newest-first for inverted list so latest activity sits at the bottom of the deal room.
  const listData = useMemo(() => [...messages].reverse(), [messages]);

  const contentContainerStyle = useMemo(
    () => [styles.messagesContent, { paddingBottom: insetsBottom + 24, paddingTop: 16 }],
    [insetsBottom]
  );

  const extraData = useMemo(
    () => ({ unreadDividerMessageId, unreadCount, currentUserId, peerAvatarUri }),
    [currentUserId, peerAvatarUri, unreadCount, unreadDividerMessageId]
  );

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <FlatList
        ref={flatListRef}
        data={listData}
        inverted
        keyExtractor={keyExtractor}
        contentContainerStyle={contentContainerStyle}
        renderItem={renderMessageItem}
        extraData={extraData}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScrollBeginDrag={Keyboard.dismiss}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onEndReached={onLoadOlder}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          showOlderSpinner ? (
            <View style={{ paddingVertical: 12, alignItems: 'center' }}>
              <ActivityIndicator color={lightBrown} size="small" />
            </View>
          ) : null
        }
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={viewabilityConfig.current}
        removeClippedSubviews={false}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={11}
      />
    </View>
  );
}
