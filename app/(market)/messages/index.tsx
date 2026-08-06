import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InboxStatusBadge } from '@/components/chat/inbox-status-badge';
import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';
import {
  filterPeerGroupsBySegment,
  groupInboxByPeer,
  type PeerDealGroup,
} from '@/lib/chat/group-inbox-by-peer';
import { dealProductLabel, enrichInboxRoomsWithPosts } from '@/lib/chat/enrich-inbox-snapshots';
import { openDealRoom } from '@/lib/chat/prefetch-deal-room';
import { isPostgresChatBackend } from '@/lib/config/chat-backend';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useBlockedUserIds } from '@/lib/hooks/use-social';
import { useChatInbox } from '@/lib/hooks/use-chat-inbox';
import { useMarketPostsByIds } from '@/lib/hooks/use-market-post';
import {
  useInboxPeerSummaries,
  type InboxPeerSummary,
} from '@/lib/hooks/use-inbox-peer-summaries';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { haptics } from '@/lib/utils/haptics';
import type { ChatInboxItem } from '@/types/chat';
import type { MarketPost } from '@/types';

const lightBrown = '#A67C52';

function isPostgresInboxItem(item: any): item is ChatInboxItem {
  return Boolean(item?.threadId && item?.peerId);
}

function displayNameForPeer(
  peerId: string | null,
  peerSummaries: Record<string, InboxPeerSummary>,
  fallbackName?: string
): string {
  if (!peerId) {
    const fb = String(fallbackName || '').trim();
    return fb && !fb.includes('@') ? fb : 'User';
  }
  const fromSummary = peerSummaries[peerId]?.displayName;
  if (fromSummary && !fromSummary.includes('@')) return fromSummary;
  const fb = String(fallbackName || '').trim();
  if (fb && !fb.includes('@')) return fb;
  return 'User';
}

function PeerRow({
  group,
  colors,
  peerSummary,
  userId,
}: {
  group: PeerDealGroup;
  colors: ReturnType<typeof useTheme>['colors'];
  peerSummary?: InboxPeerSummary;
  userId?: string | null;
}) {
  const name = displayNameForPeer(group.peerId, peerSummary ? { [group.peerId]: peerSummary } : {}, group.peerName);
  const avatarUri = peerSummary?.avatarUri || group.peerAvatar || undefined;
  const roomCount = group.rooms.length;
  const singleRoom = roomCount === 1 ? group.rooms[0] : null;
  const roomLabel = singleRoom
    ? dealProductLabel(singleRoom.postSnapshot) || '1 product'
    : `${roomCount} products`;
  const latestStatus = group.rooms[0]?.statusBadge || group.rooms[0]?.status;
  const isVerified = Boolean(peerSummary?.isVerified);

  return (
    <TouchableOpacity
      style={[
        styles.dealCard,
        {
          backgroundColor: colors.card,
          borderColor: group.unreadTotal > 0 ? `${lightBrown}55` : colors.border,
        },
      ]}
      activeOpacity={0.85}
      onPress={() => {
        haptics.light();
        // Skip the peer hub when there's only one product room.
        if (singleRoom) {
          void openDealRoom(singleRoom, userId);
          return;
        }
        router.push(`/(market)/messages/peer/${group.peerId}` as any);
      }}>
      <View style={styles.peerLeading}>
        {avatarUri ? (
          <SafeImage uri={avatarUri} style={styles.avatarImage} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.avatarFallback, { color: colors.textSecondary }]}>
              {name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.chatContent}>
        <View style={styles.chatHeader}>
          <View style={styles.chatNameRow}>
            <Text style={[styles.chatName, { color: colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            {isVerified ? <VerifiedBadge size={13} /> : null}
          </View>
          <Text style={[styles.chatTime, { color: colors.textSecondary }]}>
            {formatRelativeTime(group.lastAt)}
          </Text>
        </View>

        <Text style={[styles.roomCountLabel, { color: lightBrown }]} numberOfLines={1}>
          {roomLabel}
        </Text>

        <View style={styles.chatPreviewRow}>
          <Text
            style={[
              styles.chatPreview,
              {
                color: group.unreadTotal > 0 ? colors.text : colors.textSecondary,
                fontWeight: group.unreadTotal > 0 ? '700' : '500',
              },
            ]}
            numberOfLines={2}>
            {group.lastPreview || 'No messages yet'}
          </Text>
          {group.unreadTotal > 0 ? (
            <View style={[styles.badge, { backgroundColor: lightBrown }]}>
              <Text style={styles.badgeText}>
                {group.unreadTotal > 99 ? '99+' : group.unreadTotal}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.dealFooter}>
          {latestStatus ? <InboxStatusBadge badge={latestStatus} /> : <View />}
          <Text style={[styles.openRoomHint, { color: lightBrown }]}>
            {singleRoom ? 'Open room →' : 'View rooms →'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function InboxSkeleton({ count, colors }: { count: number; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={[styles.listContent, { gap: 12, paddingTop: 8 }]}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dealCard,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.55 },
          ]}>
          <View style={[styles.avatar, { backgroundColor: colors.backgroundSecondary }]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 14, width: '55%', borderRadius: 6, backgroundColor: colors.backgroundSecondary }} />
            <View style={{ height: 12, width: '35%', borderRadius: 6, backgroundColor: colors.backgroundSecondary }} />
            <View style={{ height: 12, width: '80%', borderRadius: 6, backgroundColor: colors.backgroundSecondary }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function MessagesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { idSet: blockedIds } = useBlockedUserIds(user?.uid || null);
  const marketLoginRoute = getLoginRouteForVariant('market');
  const [activeFilter, setActiveFilter] = useState<'deals' | 'completed' | 'unread'>('deals');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const postgresInbox = useChatInbox(user?.uid || null);
  const chats = postgresInbox.items as any[];
  const loading = postgresInbox.loading;
  const error = postgresInbox.error;
  const refreshInbox = postgresInbox.refresh;
  const refreshInboxIfStale = postgresInbox.refreshIfStale;
  const refreshingInbox = postgresInbox.refreshing;

  // Chat notifications are mounted once for the whole market section in `(market)/_layout.tsx`.
  // Mounting them here too would double-poll the inbox and fire duplicate notifications.

  useFocusEffect(
    useCallback(() => {
      if (isPostgresChatBackend()) {
        void refreshInboxIfStale();
      }
    }, [refreshInboxIfStale])
  );

  const visibleItems = useMemo(() => {
    if (!user?.uid) return [] as ChatInboxItem[];
    return (chats as ChatInboxItem[]).filter((chat) => {
      if (!isPostgresInboxItem(chat)) return false;
      return !blockedIds.has(String(chat.peerId));
    });
  }, [blockedIds, chats, user?.uid]);

  const inboxPostIds = useMemo(
    () => [...new Set(visibleItems.map((item) => String(item.postId || '').trim()).filter(Boolean))],
    [visibleItems]
  );
  const { posts: inboxPosts } = useMarketPostsByIds(inboxPostIds, 50);
  const inboxPostsById = useMemo(() => {
    const map: Record<string, MarketPost | undefined> = {};
    inboxPosts.forEach((post) => {
      if (post.id) map[post.id] = post;
    });
    return map;
  }, [inboxPosts]);

  const peerGroups = useMemo(
    () => groupInboxByPeer(enrichInboxRoomsWithPosts(visibleItems, inboxPostsById)),
    [inboxPostsById, visibleItems]
  );

  const segmentedGroups = useMemo(
    () => filterPeerGroupsBySegment(peerGroups, activeFilter),
    [activeFilter, peerGroups]
  );

  const inboxPeerIds = useMemo(() => segmentedGroups.map((g) => g.peerId), [segmentedGroups]);
  const peerSummaries = useInboxPeerSummaries(inboxPeerIds);

  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return segmentedGroups;
    return segmentedGroups.filter((group) => {
      const name = displayNameForPeer(group.peerId, peerSummaries, group.peerName).toLowerCase();
      const preview = String(group.lastPreview || '').toLowerCase();
      const productHit = group.rooms.some((room) =>
        String(room.postSnapshot?.title || '').toLowerCase().includes(q)
      );
      return name.includes(q) || preview.includes(q) || productHit;
    });
  }, [peerSummaries, searchQuery, segmentedGroups]);

  const renderPeerRow = useCallback(
    ({ item }: { item: PeerDealGroup }) => (
      <PeerRow
        group={item}
        colors={colors}
        peerSummary={peerSummaries[item.peerId]}
        userId={user?.uid}
      />
    ),
    [colors, peerSummaries, user?.uid]
  );

  const renderInboxTabs = () => {
    const tabs: { key: 'deals' | 'completed' | 'unread'; label: string }[] = [
      { key: 'deals', label: 'Active deals' },
      { key: 'completed', label: 'Completed' },
      { key: 'unread', label: 'Unread' },
    ];

    return (
      <View style={styles.filterRow}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.filterChip,
              {
                backgroundColor: activeFilter === tab.key ? `${lightBrown}22` : colors.backgroundSecondary,
                borderColor: activeFilter === tab.key ? lightBrown : colors.border,
              },
            ]}
            onPress={() => {
              haptics.light();
              setActiveFilter(tab.key);
            }}>
            <Text
              style={[
                styles.filterChipText,
                { color: activeFilter === tab.key ? lightBrown : colors.textSecondary },
              ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

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
        <Text style={[styles.screenTitle, { color: colors.text }]}>Deals</Text>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.iconBtn}
            onPress={() => {
              setActiveFilter((prev) =>
                prev === 'deals' ? 'completed' : prev === 'completed' ? 'unread' : 'deals'
              );
              haptics.light();
            }}>
            <IconSymbol
              name="line.3.horizontal.decrease.circle"
              size={24}
              color={activeFilter !== 'deals' ? lightBrown : colors.text}
            />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.iconBtn}
            onPress={() => {
              setIsSearchVisible(!isSearchVisible);
              if (isSearchVisible) setSearchQuery('');
            }}>
            <IconSymbol name="magnifyingglass" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {isSearchVisible && (
        <View style={[styles.searchBar, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={18} color={colors.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search people or products"
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            autoFocus
          />
        </View>
      )}

      {renderInboxTabs()}
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
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Log in to view deals</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Negotiate offers and manage paid orders with sellers in one place.
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

  if (peerGroups.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: `${lightBrown}18` }]}>
            <IconSymbol name="tray.fill" size={40} color={lightBrown} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No deals yet</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Tap Ask for Price or DM on a post to open a product room with the seller.
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
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No unread deals</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>You’re all caught up.</Text>
        </View>
      ) : searchFiltered.length === 0 && activeFilter === 'completed' ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: `${lightBrown}18` }]}>
            <IconSymbol name="checkmark.seal.fill" size={40} color={lightBrown} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No completed deals</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Finished purchases will show up here.
          </Text>
        </View>
      ) : searchFiltered.length === 0 && !searchQuery.trim() ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: `${lightBrown}18` }]}>
            <IconSymbol name="bag.fill" size={40} color={lightBrown} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No active deals</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Start a negotiation from a post to see it here.
          </Text>
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
          keyExtractor={(item) => item.peerId}
          renderItem={renderPeerRow}
          extraData={{ peerSummaries, colors }}
          drawDistance={380}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 96 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshingInbox}
              onRefresh={() => {
                void refreshInbox();
              }}
              tintColor={lightBrown}
              colors={[lightBrown]}
            />
          }
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconBtn: {
    padding: 4,
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
  dealCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginBottom: 12,
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
  peerLeading: {
    justifyContent: 'center',
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
  chatNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '800',
    flexShrink: 1,
  },
  roomCountLabel: {
    fontSize: 12,
    fontWeight: '700',
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
    gap: 8,
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dealFooter: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  openRoomHint: {
    fontSize: 12,
    fontWeight: '800',
  },
});
