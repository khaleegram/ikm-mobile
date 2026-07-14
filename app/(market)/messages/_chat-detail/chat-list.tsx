import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Keyboard, Platform, Text, View, ViewToken } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';

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
  peerAvatarUri?: string;
  onLatestVisibleIncomingMessage?: (messageId: string) => void;
  unreadCount: number;
  unreadDividerMessageId: string;
  flatListRef: React.RefObject<FlashListRef<MarketMessage> | null>;
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

      // FlashList requires a single host view — Fragments drop/zero-height items.
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
          />
        </View>
      );
    },
    [colors.border, currentUserId, onOpenOffer, onRetryVoice, peerAvatarUri, unreadCount, unreadDividerMessageId]
  );

  // Newest-first for inverted list so latest activity sits at the bottom of the deal room.
  const listData = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <FlashList
        ref={flatListRef}
        data={listData}
        inverted
        drawDistance={450}
        keyExtractor={(item) => getStableMessageKey(item, String(activeChatId || 'chat'))}
        contentContainerStyle={[
          styles.messagesContent,
          { paddingBottom: insetsBottom + 24, paddingTop: 16 },
        ]}
        renderItem={renderMessageItem}
        extraData={{ unreadDividerMessageId, unreadCount, currentUserId, peerAvatarUri }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScrollBeginDrag={Keyboard.dismiss}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={viewabilityConfig.current}
      />
    </View>
  );
}
