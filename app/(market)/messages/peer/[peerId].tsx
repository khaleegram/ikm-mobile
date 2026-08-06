import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InboxStatusBadge } from '@/components/chat/inbox-status-badge';
import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';
import { enrichInboxRoomsWithPosts, dealProductLabel } from '@/lib/chat/enrich-inbox-snapshots';
import {
  filterRoomsBySegment,
  groupInboxByPeer,
} from '@/lib/chat/group-inbox-by-peer';
import { openDealRoom } from '@/lib/chat/prefetch-deal-room';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostsByIds } from '@/lib/hooks/use-market-post';
import { useChatInbox } from '@/lib/hooks/use-chat-inbox';
import { useInboxPeerSummaries } from '@/lib/hooks/use-inbox-peer-summaries';
import { useTheme } from '@/lib/theme/theme-context';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { haptics } from '@/lib/utils/haptics';
import type { ChatInboxItem } from '@/types/chat';
import type { MarketPost } from '@/types';

const lightBrown = '#A67C52';

function roomProductTitle(room: ChatInboxItem): string {
  return dealProductLabel(room.postSnapshot);
}

function roomProductImage(room: ChatInboxItem): string | undefined {
  const snap = room.postSnapshot || {};
  const uri =
    String(snap.imageUrl || '').trim() ||
    String((snap as { thumbnailUrl?: string }).thumbnailUrl || '').trim() ||
    String((snap as { coverImageUrl?: string }).coverImageUrl || '').trim();
  return uri || undefined;
}

function formatRoomPrice(room: ChatInboxItem): string {
  const price = room.postSnapshot?.price;
  if (price == null || !Number.isFinite(Number(price))) return '';
  const currency = room.postSnapshot?.currency || 'NGN';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number(price));
  } catch {
    return `${currency} ${Number(price).toFixed(0)}`;
  }
}

function ProductRoomRow({
  room,
  colors,
  userId,
}: {
  room: ChatInboxItem;
  colors: ReturnType<typeof useTheme>['colors'];
  userId?: string | null;
}) {
  const title = roomProductTitle(room);
  const imageUri = roomProductImage(room);
  const priceLabel = formatRoomPrice(room);
  const unread = Number(room.unreadCount || 0);
  const lastMessage = String(room.lastPreview || '').trim() || 'No messages yet';

  return (
    <TouchableOpacity
      style={[
        styles.roomCard,
        {
          backgroundColor: colors.card,
          borderColor: unread > 0 ? `${lightBrown}55` : colors.border,
        },
      ]}
      activeOpacity={0.85}
      onPress={() => {
        haptics.light();
        void openDealRoom(room, userId);
      }}>
      {imageUri ? (
        <SafeImage uri={imageUri} style={styles.productThumb} />
      ) : (
        <View style={[styles.productThumb, styles.productThumbFallback, { backgroundColor: colors.backgroundSecondary }]}>
          <IconSymbol name="bag.fill" size={26} color={colors.textSecondary} />
        </View>
      )}

      <View style={styles.roomBody}>
        <View style={styles.roomHeader}>
          <Text style={[styles.roomTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.roomTime, { color: colors.textSecondary }]}>
            {formatRelativeTime(room.lastAt)}
          </Text>
        </View>

        {priceLabel ? (
          <Text style={[styles.roomPrice, { color: lightBrown }]} numberOfLines={1}>
            {priceLabel}
          </Text>
        ) : null}

        <View style={styles.previewRow}>
          <Text
            style={[
              styles.roomPreview,
              {
                color: unread > 0 ? colors.text : colors.textSecondary,
                fontWeight: unread > 0 ? '700' : '500',
              },
            ]}
            numberOfLines={2}>
            {lastMessage}
          </Text>
          {unread > 0 ? (
            <View style={[styles.badge, { backgroundColor: lightBrown }]}>
              <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          ) : null}
        </View>

        <InboxStatusBadge badge={room.statusBadge || room.status} />
      </View>
    </TouchableOpacity>
  );
}

function RoomSkeleton({
  count,
  colors,
}: {
  count: number;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.roomCard,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.55 },
          ]}>
          <View style={[styles.productThumb, { backgroundColor: colors.backgroundSecondary }]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 15, width: '60%', borderRadius: 6, backgroundColor: colors.backgroundSecondary }} />
            <View style={{ height: 12, width: '30%', borderRadius: 6, backgroundColor: colors.backgroundSecondary }} />
            <View style={{ height: 12, width: '85%', borderRadius: 6, backgroundColor: colors.backgroundSecondary }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function PeerDealHubScreen() {
  const { peerId: peerIdParam } = useLocalSearchParams<{ peerId: string }>();
  const peerId = String(peerIdParam || '').trim();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const inbox = useChatInbox(user?.uid || null);
  const refreshInbox = inbox.refresh;
  const refreshInboxIfStale = inbox.refreshIfStale;
  const [segment, setSegment] = useState<'deals' | 'completed' | 'unread'>('deals');

  useFocusEffect(
    useCallback(() => {
      void refreshInboxIfStale();
    }, [refreshInboxIfStale])
  );

  const peerRoomsRaw = useMemo(
    () => inbox.items.filter((item) => item.peerId === peerId),
    [inbox.items, peerId]
  );

  const postIdsNeedingHydration = useMemo(
    () => [...new Set(peerRoomsRaw.map((room) => String(room.postId || '').trim()).filter(Boolean))],
    [peerRoomsRaw]
  );

  const { posts: hydratedPosts } = useMarketPostsByIds(postIdsNeedingHydration, 40);
  const postsById = useMemo(() => {
    const map: Record<string, MarketPost | undefined> = {};
    hydratedPosts.forEach((post) => {
      if (post.id) map[post.id] = post;
    });
    return map;
  }, [hydratedPosts]);

  const peerGroup = useMemo(() => {
    const enriched = enrichInboxRoomsWithPosts(peerRoomsRaw, postsById);
    return groupInboxByPeer(enriched)[0] || null;
  }, [peerRoomsRaw, postsById]);

  const peerSummaries = useInboxPeerSummaries(peerId ? [peerId] : []);
  const peerName =
    peerSummaries[peerId]?.displayName ||
    (peerGroup?.peerName && !String(peerGroup.peerName).includes('@')
      ? peerGroup.peerName
      : '') ||
    'User';
  const peerAvatar = peerSummaries[peerId]?.avatarUri || peerGroup?.peerAvatar || undefined;
  const peerVerified = Boolean(peerSummaries[peerId]?.isVerified);

  const rooms = useMemo(() => {
    const all = peerGroup?.rooms || [];
    return filterRoomsBySegment(all, segment);
  }, [peerGroup?.rooms, segment]);

  const presenceLabel = useMemo(() => {
    const presence = peerGroup?.peerPresence;
    if (presence === 'online') return 'Online';
    if (presence === 'last_seen') return 'Recently active';
    return 'Product deal rooms';
  }, [peerGroup?.peerPresence]);

  const renderRoom = useCallback(
    ({ item }: { item: ChatInboxItem }) => (
      <ProductRoomRow room={item} colors={colors} userId={user?.uid} />
    ),
    [colors, user?.uid]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          {peerAvatar ? (
            <SafeImage uri={peerAvatar} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.headerAvatarFallback, { color: colors.textSecondary }]}>
                {peerName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.headerTitles}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
                {peerName}
              </Text>
              {peerVerified ? <VerifiedBadge size={14} /> : null}
            </View>
            <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {presenceLabel}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.segmentRow}>
        {(
          [
            { key: 'deals', label: 'Active' },
            { key: 'completed', label: 'Completed' },
            { key: 'unread', label: 'Unread' },
          ] as const
        ).map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.segmentChip,
              {
                backgroundColor: segment === tab.key ? `${lightBrown}22` : colors.backgroundSecondary,
                borderColor: segment === tab.key ? lightBrown : colors.border,
              },
            ]}
            onPress={() => {
              haptics.light();
              setSegment(tab.key);
            }}>
            <Text
              style={[
                styles.segmentText,
                { color: segment === tab.key ? lightBrown : colors.textSecondary },
              ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {inbox.loading && rooms.length === 0 && !peerGroup ? (
        <RoomSkeleton count={5} colors={colors} />
      ) : rooms.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIcon, { backgroundColor: `${lightBrown}18` }]}>
            <IconSymbol name="bag.fill" size={36} color={lightBrown} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {segment === 'completed'
              ? 'No completed rooms'
              : segment === 'unread'
                ? 'No unread rooms'
                : 'No product rooms yet'}
          </Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {inbox.error
              ? 'Could not load rooms. Pull down to retry.'
              : 'Ask for price on a post to open a product room with this seller.'}
          </Text>
        </View>
      ) : (
        <FlashList
          data={rooms}
          keyExtractor={(item) => item.threadId}
          renderItem={renderRoom}
          drawDistance={320}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: insets.bottom + 32,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={inbox.refreshing}
              onRefresh={() => {
                void inbox.refresh();
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
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarFallback: {
    fontSize: 15,
    fontWeight: '800',
  },
  headerTitles: {
    flex: 1,
    minWidth: 0,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerName: {
    fontSize: 17,
    fontWeight: '800',
    flexShrink: 1,
  },
  headerSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  headerSpacer: { width: 40 },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  segmentChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  productThumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  productThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roomTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  roomTime: {
    fontSize: 11,
    fontWeight: '600',
  },
  roomPrice: {
    fontSize: 12,
    fontWeight: '700',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  roomPreview: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 10,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
});
