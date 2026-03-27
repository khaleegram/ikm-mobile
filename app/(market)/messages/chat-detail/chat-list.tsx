import React, { useCallback, useEffect, useRef } from 'react';
import { FlatList, Keyboard, Platform, Text, View, ViewToken } from 'react-native';

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
  peerAvatarUri?: string;
  onLatestVisibleIncomingMessage?: (messageId: string) => void;
  unreadCount: number;
  unreadDividerMessageId: string;
  flatListRef: React.RefObject<FlatList<MarketMessage>>;
};

export function ChatList({
  activeChatId,
  colors,
  currentUserId,
  flatListRef,
  insetsBottom,
  messages,
  onOpenOffer,
  peerAvatarUri,
  onLatestVisibleIncomingMessage,
  unreadCount,
  unreadDividerMessageId,
}: ChatListProps) {
  const currentUserIdRef = useRef(currentUserId);
  const onLatestVisibleIncomingMessageRef = useRef(onLatestVisibleIncomingMessage);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    onLatestVisibleIncomingMessageRef.current = onLatestVisibleIncomingMessage;
  }, [onLatestVisibleIncomingMessage]);

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

  const renderMessageItem = useCallback(
    ({ item }: { item: MarketMessage }) => {
      const shouldShowUnreadDivider =
        Boolean(unreadDividerMessageId) && String(item.id || '').trim() === unreadDividerMessageId;

      return (
        <>
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
          />
        </>
      );
    },
    [colors.border, currentUserId, onOpenOffer, peerAvatarUri, unreadCount, unreadDividerMessageId]
  );

  return (
    <FlatList
      ref={flatListRef}
      data={messages}
      inverted
      maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
      keyExtractor={(item) => getStableMessageKey(item, String(activeChatId || 'chat'))}
      initialNumToRender={16}
      maxToRenderPerBatch={12}
      windowSize={9}
      updateCellsBatchingPeriod={40}
      removeClippedSubviews
      contentContainerStyle={[
        styles.messagesContent,
        { paddingBottom: insetsBottom + 90 },
      ]}
      renderItem={renderMessageItem}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      onScrollBeginDrag={Keyboard.dismiss}
      onViewableItemsChanged={onViewableItemsChanged.current}
      viewabilityConfig={viewabilityConfig.current}
    />
  );
}
