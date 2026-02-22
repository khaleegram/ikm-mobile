import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useTheme } from '@/lib/theme/theme-context';
import { useMarketChats } from '@/lib/firebase/firestore/market-messages';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { buildDirectConversationId, resolveDirectConversationPeerId } from '@/lib/api/market-messages';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { SafeImage } from '@/components/safe-image';

const lightBrown = '#A67C52';

function resolveProfileName(profile: any, fallback: string) {
  const first = String(profile?.firstName || '').trim();
  const last = String(profile?.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const display = String(profile?.displayName || '').trim();
  if (display) return display;
  const store = String(profile?.storeName || '').trim();
  if (store) return store;
  return fallback;
}

function initialsFromName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

type ChatRowProps = {
  item: any;
  userId: string;
  colors: any;
};

function ChatRow({ item, userId, colors }: ChatRowProps) {
  const unreadCount = item.unreadCount || 0;
  const lastMessage = item.lastMessage || '';
  const participants = Array.isArray(item.participants) ? item.participants : [];
  const otherParticipantFromList = participants.find((p: string) => p && p !== userId) || null;
  const otherParticipantId =
    otherParticipantFromList ||
    resolveDirectConversationPeerId(String(item.id || item.chatId || ''), userId) ||
    (item.posterId && item.posterId !== userId ? String(item.posterId) : null) ||
    (item.buyerId && item.buyerId !== userId ? String(item.buyerId) : null) ||
    (item.receiverId && item.receiverId !== userId ? String(item.receiverId) : null);
  const { user: otherUserProfile, loading: otherProfileLoading } = useUserProfile(otherParticipantId);

  const targetConversationId = otherParticipantId
    ? buildDirectConversationId(userId, String(otherParticipantId))
    : String(item.id || item.chatId || '');
  const chatIds = Array.isArray((item as any).chatIds)
    ? (item as any).chatIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const legacyChatId =
    chatIds.find((value: string) => value && !value.startsWith('direct_')) ||
    (String(item.id || item.chatId || '').startsWith('direct_') ? '' : String(item.id || item.chatId || ''));
  const fallbackName =
    item.posterName ||
    item.otherParticipantName ||
    'Conversation';
  const chatName = resolveProfileName(otherUserProfile, otherProfileLoading ? 'Loading...' : fallbackName);
  const avatarUri = otherUserProfile?.storeLogoUrl || (otherUserProfile as any)?.photoURL || undefined;

  return (
    <TouchableOpacity
      style={[
        styles.chatItem,
        {
          backgroundColor: colors.card,
        },
      ]}
      onPress={() =>
        router.push(
          `/(market)/messages/${targetConversationId}${
            otherParticipantId || legacyChatId
              ? `?${
                  [
                    otherParticipantId ? `peerId=${encodeURIComponent(String(otherParticipantId))}` : null,
                    legacyChatId ? `legacyChatId=${encodeURIComponent(legacyChatId)}` : null,
                  ]
                    .filter(Boolean)
                    .join('&')
                }`
              : ''
          }` as any
        )
      }>
      <View style={[styles.avatar, { backgroundColor: colors.backgroundSecondary }]}>
        {avatarUri ? (
          <SafeImage uri={avatarUri} style={styles.avatarImage} />
        ) : (
          <Text style={[styles.avatarFallback, { color: colors.textSecondary }]}>
            {initialsFromName(chatName)}
          </Text>
        )}
      </View>
      <View style={styles.chatContent}>
        <View style={styles.chatHeader}>
          <Text style={[styles.chatName, { color: colors.text }]} numberOfLines={1}>
            {chatName}
          </Text>
          <Text style={[styles.chatTime, { color: colors.textSecondary }]}>
            {formatRelativeTime(item.updatedAt || new Date())}
          </Text>
        </View>
        <View style={styles.chatPreviewRow}>
          <Text
            style={[styles.chatPreview, { color: unreadCount > 0 ? colors.text : colors.textSecondary }]}
            numberOfLines={1}>
            {lastMessage || 'Tap to open chat'}
          </Text>
          {unreadCount > 0 ? (
            <View style={[styles.unreadInlinePill, { backgroundColor: `${lightBrown}18` }]}>
              <Text style={[styles.unreadInlineText, { color: lightBrown }]}>
                {unreadCount} unread
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {unreadCount > 0 && (
        <View style={[styles.badge, { backgroundColor: lightBrown }]}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
const MemoChatRow = memo(ChatRow);

export default function MessagesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { chats, loading, error } = useMarketChats(user?.uid || null);
  const [activeFilter, setActiveFilter] = useState<'chats' | 'unread'>('chats');
  const marketLoginRoute = getLoginRouteForVariant('market');

  const unreadTotal = useMemo(
    () =>
      chats.reduce((total, chat) => {
        const value = Number((chat as any)?.unreadCount || 0);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0),
    [chats]
  );
  const filteredChats = useMemo(() => {
    if (activeFilter === 'unread') {
      return chats.filter((chat) => Number((chat as any)?.unreadCount || 0) > 0);
    }
    return chats;
  }, [activeFilter, chats]);
  const renderChatRow = useCallback(
    ({ item }: { item: any }) => <MemoChatRow item={item} userId={user?.uid || ''} colors={colors} />,
    [colors, user?.uid]
  );

  const renderHeader = () => (
    <View
      style={[
        styles.appHeaderWrap,
        {
          paddingTop: insets.top + 6,
          backgroundColor: colors.background,
        },
      ]}>
      <View style={styles.headerRow}>
        <View style={[styles.titleChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="message.fill" size={16} color={lightBrown} />
          <Text style={[styles.titleChipText, { color: colors.text }]}>Messages</Text>
        </View>
        <View style={styles.filtersRow}>
          <TouchableOpacity
            style={[
              styles.filterChipLegacy,
              {
                backgroundColor:
                  activeFilter === 'chats' ? `${lightBrown}18` : colors.backgroundSecondary,
              },
            ]}
            onPress={() => setActiveFilter('chats')}>
            <IconSymbol
              name="message"
              size={12}
              color={activeFilter === 'chats' ? lightBrown : colors.textSecondary}
            />
            <Text
              style={[
                styles.filterChipLegacyText,
                { color: activeFilter === 'chats' ? lightBrown : colors.textSecondary },
              ]}>
              Chats
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.filterChipLegacy,
              {
                backgroundColor:
                  activeFilter === 'unread' ? `${lightBrown}18` : colors.backgroundSecondary,
              },
            ]}
            onPress={() => setActiveFilter('unread')}>
            <IconSymbol
              name="envelope.fill"
              size={12}
              color={activeFilter === 'unread' ? lightBrown : colors.textSecondary}
            />
            <Text
              style={[
                styles.filterChipLegacyText,
                { color: activeFilter === 'unread' ? lightBrown : colors.textSecondary },
              ]}>
              {unreadTotal > 0 ? `Unread (${unreadTotal})` : 'Unread'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <IconSymbol name="message" size={64} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Please log in to view messages</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Log in to see your conversations with sellers
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: lightBrown }]}
            onPress={() => router.push(marketLoginRoute as any)}>
            <Text style={styles.buttonText}>Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading && chats.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      </View>
    );
  }

  if (chats.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <IconSymbol name="message" size={64} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No messages yet</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Start a conversation by tapping Ask for Price on a post.
          </Text>
          {error ? (
            <Text style={[styles.errorHint, { color: colors.error }]}>
              Some chats could not load. Open a post and start a new chat to refresh your inbox.
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderHeader()}
      {filteredChats.length === 0 && activeFilter === 'unread' ? (
        <View style={styles.emptyContainer}>
          <IconSymbol name="checkmark.circle.fill" size={54} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No unread chats</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>You are all caught up.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredChats}
          keyExtractor={(item, index) => String(item.id || item.chatId || `chat-${index}`)}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          ItemSeparatorComponent={() => <View style={styles.chatSeparator} />}
          renderItem={renderChatRow}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          updateCellsBatchingPeriod={40}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  appHeaderWrap: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleChip: {
    minHeight: 40,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  titleChipText: {
    fontSize: 16,
    fontWeight: '800',
  },
  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChipLegacy: {
    minHeight: 28,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  filterChipLegacyText: {
    fontSize: 12,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  chatSeparator: {
    height: 8,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarFallback: {
    fontSize: 18,
    fontWeight: '800',
  },
  chatContent: {
    flex: 1,
    gap: 4,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatName: {
    fontSize: 16,
    fontWeight: '800',
  },
  chatTime: {
    fontSize: 12,
    fontWeight: '600',
  },
  chatPreview: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  chatPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unreadInlinePill: {
    minHeight: 20,
    borderRadius: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadInlineText: {
    fontSize: 10,
    fontWeight: '800',
  },
  errorHint: {
    marginTop: 4,
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
