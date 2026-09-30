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

/**
 * One rendered chat row. Photos sent together arrive as separate single-attachment messages
 * sharing an `albumId`, so consecutive ones collapse into a single grid row here.
 */
type ChatRow =
  | { kind: 'single'; key: string; message: MarketMessage }
  | { kind: 'album'; key: string; lead: MarketMessage; photos: string[]; memberIds: string[] };

const ALBUM_MAX_PHOTOS = 10;

/**
 * Collapse consecutive messages that belong to the same album into one row.
 *
 * Only *consecutive* runs are merged: if someone sends three photos, then a message, then two
 * more, the two groups stay separate even for a repeated albumId, which matches how the
 * conversation actually read.
 */
function buildChatRows(messages: MarketMessage[], chatId: string): ChatRow[] {
  const rows: ChatRow[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    const albumId = String(message.albumId || '').trim();

    if (albumId) {
      const photos: string[] = [];
      const memberIds: string[] = [];
      let cursor = index;
      let senderId = String(message.senderId || '');

      while (cursor < messages.length) {
        const candidate = messages[cursor];
        if (String(candidate.albumId || '').trim() !== albumId) break;
        // An album is one sender's burst of photos, never a mixed back-and-forth.
        if (String(candidate.senderId || '') !== senderId) break;
        if (!candidate.imageUrl) break;
        // Only photos join an album; a message carrying text must render on its own.
        if (String(candidate.text || candidate.message || '').trim()) break;
        photos.push(candidate.imageUrl);
        memberIds.push(String(candidate.id || ''));
        cursor += 1;
        senderId = String(candidate.senderId || '');
      }

      if (photos.length > 1 && photos.length <= ALBUM_MAX_PHOTOS) {
        rows.push({
          kind: 'album',
          key: `album:${albumId}`,
          // The newest message carries the row's timestamp/read state, and an inverted list
          // renders it in place of the whole group.
          lead: messages[cursor - 1],
          photos,
          memberIds,
        });
        index = cursor;
        continue;
      }
    }

    rows.push({
      kind: 'single',
      key: getStableMessageKey(message, chatId),
      message,
    });
    index += 1;
  }

  return rows;
}

type ChatListProps = {
  activeChatId: string | null;
  colors: any;
  currentUserId: string | null;
  insetsBottom: number;
  messages: MarketMessage[];
  onOpenOffer: (offer: { postId: string; sellerId: string; price: number; chatId?: string }) => void;
  onRetryVoice?: (messageId: string) => void;
  onRetryMessage?: (message: MarketMessage) => void;
  /** Open the product a quote message points at. */
  onOpenPost?: (postId: string) => void;
  peerAvatarUri?: string;
  onLatestVisibleIncomingMessage?: (messageId: string) => void;
  /** Fired while scrolling — used to collapse/expand chrome for fuller chat. */
  onScrollOffsetChange?: (offsetY: number, deltaY: number) => void;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  unreadCount: number;
  unreadDividerMessageId: string;
  // Rows may be album groups, so this is intentionally `any` in the item slot; the parent only
  // forwards the ref and never calls item-typed methods on it.
  flatListRef: React.RefObject<FlatListType<any> | null>;
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
  onOpenPost,
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
        const row = viewable.item as ChatRow;
        if (!row) return;
        // An album row stands in for its newest member for ordering purposes.
        const message = row.kind === 'album' ? row.lead : row.message;
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
    ({ item }: { item: ChatRow }) => {
      const shouldShowUnreadDivider =
        Boolean(unreadDividerMessageId) &&
        (item.kind === 'album'
          ? item.memberIds.includes(unreadDividerMessageId)
          : String(item.message.id || '').trim() === unreadDividerMessageId);

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
            message={item.kind === 'album' ? item.lead : item.message}
            albumPhotos={item.kind === 'album' ? item.photos : undefined}
            currentUserId={currentUserId}
            peerAvatarUri={peerAvatarUri}
            onOpenOffer={onOpenOffer}
            onRetryVoice={onRetryVoice}
            onRetryMessage={onRetryMessage}
            onOpenPost={onOpenPost}
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
      onOpenPost,
      peerAvatarUri,
      unreadCount,
      unreadDividerMessageId,
    ]
  );

  const keyExtractor = useCallback((item: ChatRow) => item.key, []);

  // Album runs are grouped in chronological order, then the whole list is reversed so the
  // inverted FlatList still puts the newest row at the bottom of the deal room.
  const chatRows = useMemo(
    () => buildChatRows(messages, String(activeChatId || 'chat')),
    [messages, activeChatId]
  );
  const listData = useMemo(() => [...chatRows].reverse(), [chatRows]);

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
