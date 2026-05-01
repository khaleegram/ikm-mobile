import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';

import { useUser } from '@/lib/firebase/auth/use-user';
import { useTheme } from '@/lib/theme/theme-context';
import { useMarketChats } from '@/lib/firebase/firestore/market-messages';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { buildDirectConversationId, resolveDirectConversationPeerId } from '@/lib/api/market-messages';
import { useBlockedUserIds } from '@/lib/firebase/firestore/market-social';
import { SafeImage } from '@/components/safe-image';
import { useInboxPeerSummaries, type InboxPeerSummary } from '@/lib/hooks/use-inbox-peer-summaries';

const lightBrown = '#A67C52';

function getInboxPeerId(item: any, userId: string): string | null {
  const participants = Array.isArray(item?.participants) ? item.participants : [];
  const otherFromParticipants = participants.find((p: string) => p && p !== userId) || null;
  return (
    otherFromParticipants ||
    resolveDirectConversationPeerId(String(item.id || item.chatId || ''), userId) ||
    (item.posterId && item.posterId !== userId ? String(item.posterId) : null) ||
    (item.buyerId && item.buyerId !== userId ? String(item.buyerId) : null) ||
    (item.receiverId && item.receiverId !== userId ? String(item.receiverId) : null) ||
    null
  );
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

function getChatRowKey(item: any): string {
  const explicitKey = String(item?.id || item?.chatId || '').trim();
  if (explicitKey) return explicitKey;

  const participants = Array.isArray(item?.participants)
    ? item.participants.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  if (participants.length > 0) {
    return `participants:${participants.sort((a: string, b: string) => a.localeCompare(b)).join('|')}`;
  }

  const fallbackUpdatedAt = String(item?.updatedAt || '').trim();
  if (fallbackUpdatedAt) return `updated:${fallbackUpdatedAt}`;

  return 'conversation:unknown';
}

function displayNameForChat(
  item: any,
  peerId: string | null,
  peerMap: Record<string, InboxPeerSummary>
): string {
  const fromProfile = peerId ? peerMap[peerId]?.displayName : undefined;
  if (fromProfile) return fromProfile;
  return (
    item.posterName ||
    item.otherParticipantName ||
    'Conversation'
  );
}

function InboxSkeleton({ count = 8, colors }: { count?: number; colors: any }) {
  const tone = colors.border;
  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: 14,
            borderRadius: 18,
            gap: 14,
            backgroundColor: colors.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
          }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: tone, opacity: 0.35 }} />
          <View style={{ flex: 1, gap: 10 }}>
            <View style={{ width: '55%', height: 14, backgroundColor: tone, opacity: 0.4, borderRadius: 6 }} />
            <View style={{ width: '88%', height: 12, backgroundColor: tone, opacity: 0.25, borderRadius: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

type ChatRowProps = {
  item: any;
  userId: string;
  colors: any;
  peerSummary?: InboxPeerSummary;
};

const ChatRow = memo(function ChatRow({ item, userId, colors, peerSummary }: ChatRowProps) {
  const unreadCount = item.unreadCount || 0;
  const lastMessage = item.lastMessage || '';
  const peerId = getInboxPeerId(item, userId);

  const targetConversationId = peerId
    ? buildDirectConversationId(userId, String(peerId))
    : String(item.id || item.chatId || '');
  const chatIds = Array.isArray((item as any).chatIds)
    ? (item as any).chatIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const legacyChatId =
    chatIds.find((value: string) => value && !value.startsWith('direct_')) ||
    (String(item.id || item.chatId || '').startsWith('direct_') ? '' : String(item.id || item.chatId || ''));

  const chatName =
    peerSummary?.displayName ||
    item.posterName ||
    item.otherParticipantName ||
    'Conversation';
  const avatarUri = peerSummary?.avatarUri;

  return (
    <TouchableOpacity
      style={[
        styles.chatCard,
        {
          backgroundColor: colors.card,
          borderColor: unreadCount > 0 ? `${lightBrown}55` : colors.border,
        },
      ]}
      activeOpacity={0.72}
      onPress={() =>
        router.push(
          `/(market)/messages/${targetConversationId}${
            peerId || legacyChatId
              ? `?${
                  [
                    peerId ? `peerId=${encodeURIComponent(String(peerId))}` : null,
                    legacyChatId ? `legacyChatId=${encodeURIComponent(legacyChatId)}` : null,
                  ]
                    .filter(Boolean)
                    .join('&')
                }`
              : ''
          }` as any,
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
            style={[
              styles.chatPreview,
              { color: unreadCount > 0 ? colors.text : colors.textSecondary, fontWeight: unreadCount > 0 ? '700' : '500' },
            ]}
            numberOfLines={2}>
            {lastMessage || 'Tap to open chat'}
          </Text>
        </View>
      </View>
      {unreadCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: lightBrown }]}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      ) : (
        <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} style={{ opacity: 0.6 }} />
      )}
    </TouchableOpacity>
  );
});

export default function MessagesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { chats, loading, error } = useMarketChats(user?.uid || null);
  const { idSet: blockedIds } = useBlockedUserIds(user?.uid || null);
  const [activeFilter, setActiveFilter] = useState<'chats' | 'unread'>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const marketLoginRoute = getLoginRouteForVariant('market');

  const unreadTotal = useMemo(
    () =>
      chats.reduce((total, chat) => {
        const value = Number((chat as any)?.unreadCount || 0);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0),
    [chats],
  );

  const visibleChats = useMemo(() => {
    if (!user?.uid) return chats;
    return chats.filter((chat) => {
      const peer =
        (Array.isArray((chat as any)?.participants)
          ? (chat as any).participants.find((p: string) => p && p !== user.uid)
          : null) || resolveDirectConversationPeerId(String((chat as any)?.id || (chat as any)?.chatId || ''), user.uid);
      if (!peer) return true;
      return !blockedIds.has(String(peer));
    });
  }, [blockedIds, chats, user?.uid]);

  const filteredChats = useMemo(() => {
    if (activeFilter === 'unread') {
      return visibleChats.filter((chat) => Number((chat as any)?.unreadCount || 0) > 0);
    }
    return visibleChats;
  }, [activeFilter, visibleChats]);

  const inboxPeerIds = useMemo(
    () => filteredChats.map((c) => getInboxPeerId(c, user?.uid || '')).filter(Boolean) as string[],
    [filteredChats, user?.uid],
  );

  const peerSummaries = useInboxPeerSummaries(inboxPeerIds);

  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filteredChats;
    return filteredChats.filter((chat) => {
      const peerId = getInboxPeerId(chat, user?.uid || '');
      const name = displayNameForChat(chat, peerId, peerSummaries).toLowerCase();
      const preview = String(chat.lastMessage || '').toLowerCase();
      return name.includes(q) || preview.includes(q);
    });
  }, [filteredChats, peerSummaries, searchQuery, user?.uid]);

  const renderChatRow = useCallback(
    ({ item }: { item: any }) => {
      const peerId = getInboxPeerId(item, user?.uid || '');
      const summary = peerId ? peerSummaries[peerId] : undefined;
      return <ChatRow item={item} userId={user?.uid || ''} colors={colors} peerSummary={summary} />;
    },
    [colors, peerSummaries, user?.uid],
  );

  const renderHeader = () => (
    <View
      style={[
        styles.appHeaderWrap,
        {
          paddingTop: insets.top + 8,
          backgroundColor: colors.background,
        },
      ]}>
      <View style={styles.heroRow}>
        <View>
          <Text style={[styles.screenTitle, { color: colors.text }]}>Messages</Text>
          <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
            {unreadTotal > 0 ? `${unreadTotal} unread` : 'Your conversations'}
          </Text>
        </View>
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={18} color={colors.textSecondary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name or message"
          placeholderTextColor={colors.textSecondary}
          style={[styles.searchInput, { color: colors.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.segmentWrap}>
        <TouchableOpacity
          style={[
            styles.segmentBtn,
            {
              backgroundColor: activeFilter === 'chats' ? lightBrown : 'transparent',
            },
          ]}
          onPress={() => setActiveFilter('chats')}
          activeOpacity={0.85}>
          <IconSymbol name="bubble.left.and.bubble.right.fill" size={15} color={activeFilter === 'chats' ? '#FFF' : colors.textSecondary} />
          <Text style={[styles.segmentLabel, { color: activeFilter === 'chats' ? '#FFF' : colors.textSecondary }]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segmentBtn,
            {
              backgroundColor: activeFilter === 'unread' ? lightBrown : 'transparent',
            },
          ]}
          onPress={() => setActiveFilter('unread')}
          activeOpacity={0.85}>
          <IconSymbol name="envelope.badge.fill" size={15} color={activeFilter === 'unread' ? '#FFF' : colors.textSecondary} />
          <Text style={[styles.segmentLabel, { color: activeFilter === 'unread' ? '#FFF' : colors.textSecondary }]}>
            Unread{unreadTotal > 0 ? ` (${unreadTotal})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: `${lightBrown}18` }]}>
            <IconSymbol name="message.fill" size={40} color={lightBrown} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Log in to message</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Chat with sellers and keep your offers in one place.
          </Text>
          <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: lightBrown }]} onPress={() => router.push(marketLoginRoute as any)}>
            <Text style={styles.ctaBtnText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading && chats.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <InboxSkeleton count={7} colors={colors} />
      </View>
    );
  }

  if (visibleChats.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: `${lightBrown}18` }]}>
            <IconSymbol name="tray.fill" size={40} color={lightBrown} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No messages yet</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Use Ask for Price on a post to start a conversation.
          </Text>
          {error ? (
            <Text style={[styles.errorHint, { color: colors.error }]}>
              Some threads couldn’t load. Pull up a post and message the seller to refresh.
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderHeader()}
      {searchFiltered.length === 0 && activeFilter === 'unread' ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
            <IconSymbol name="checkmark.circle.fill" size={40} color={lightBrown} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No unread messages</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>You’re all caught up.</Text>
        </View>
      ) : searchFiltered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconSymbol name="magnifyingglass" size={44} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No matches</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Try another search term.</Text>
        </View>
      ) : (
        <FlashList
          data={searchFiltered}
          keyExtractor={getChatRowKey}
          renderItem={renderChatRow}
          extraData={{ peerSummaries, colors }}
          drawDistance={380}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 96 }]}
          showsVerticalScrollIndicator={false}
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
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  heroRow: {
    marginBottom: 14,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  screenSubtitle: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 46,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
  segmentWrap: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(128,128,128,0.12)',
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
    gap: 12,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  ctaBtn: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  ctaBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  avatarFallback: {
    fontSize: 17,
    fontWeight: '800',
  },
  chatContent: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  chatTime: {
    fontSize: 12,
    fontWeight: '600',
  },
  chatPreview: {
    fontSize: 14,
    lineHeight: 19,
    flex: 1,
  },
  chatPreviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  errorHint: {
    marginTop: 4,
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 18,
  },
  badge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
