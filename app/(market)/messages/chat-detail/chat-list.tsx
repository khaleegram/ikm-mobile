import React, { useCallback } from 'react';
import { FlatList, Keyboard, Platform, Text, View } from 'react-native';

import { MessageBubble } from '@/components/market/message-bubble';
import { MarketMessage } from '@/types';

import { styles } from './styles';
import { getStableMessageKey, lightBrown } from './utils';

type ChatListProps = {
  activeChatId: string | null;
  colors: any;
  currentUserId: string | null;
  insetsBottom: number;
  keyboardVisible: boolean;
  messages: MarketMessage[];
  onOpenOffer: (offer: { postId: string; sellerId: string; price: number; chatId?: string }) => void;
  onScrollToLatest: (animated?: boolean) => void;
  peerAvatarUri?: string;
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
  keyboardVisible,
  messages,
  onOpenOffer,
  onScrollToLatest,
  peerAvatarUri,
  unreadCount,
  unreadDividerMessageId,
}: ChatListProps) {
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
        { paddingBottom: keyboardVisible ? 110 : insetsBottom + 90 },
      ]}
      renderItem={renderMessageItem}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      onScrollBeginDrag={Keyboard.dismiss}
      onContentSizeChange={() => {
        if (keyboardVisible) {
          onScrollToLatest(false);
        }
      }}
    />
  );
}
