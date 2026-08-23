import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SellerBroadcastCard } from '@/components/market/seller-broadcast-card';
import { SellerCardMediaViewer } from '@/components/market/seller-card-media-viewer';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';
import { showToast } from '@/components/toast';
import { buildDirectConversationId } from '@/lib/chat/conversation-ids';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserMarketPosts } from '@/lib/hooks/use-market-post';
import { toggleFollow, useIsFollowing } from '@/lib/hooks/use-social';
import { usePublicUserProfile } from '@/lib/firebase/firestore/users';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { startPostQuoteChat } from '@/lib/utils/market-ask-price-chat';
import { buildSellerFeedItems, type SellerFeedItem } from '@/lib/utils/seller-feed';
import { useMarketCartStore } from '@/lib/stores/market-cart';
import { useTheme } from '@/lib/theme/theme-context';
import type { MarketPost } from '@/types';
import { Alert } from '@/components/app-alert';

const lightBrown = '#A67C52';
const TAB_BAR_CLEARANCE = 110;

export default function SellerProfileScreen() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: seller, loading: sellerLoading } = usePublicUserProfile(sellerId ?? null);
  const { posts, loading: postsLoading } = useUserMarketPosts(sellerId ?? null);
  const { isFollowing, loading: followLoading } = useIsFollowing(user?.uid ?? null, sellerId ?? null);
  const [followPending, setFollowPending] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [viewingPost, setViewingPost] = useState<{ post: MarketPost; mediaIndex: number } | null>(null);
  const marketLoginRoute = getLoginRouteForVariant('market');
  // toggleFollow optimistically updates the shared following-list cache that useIsFollowing
  // reads from, so `isFollowing` itself reflects the pending state instantly — no local
  // optimistic override needed, and every other screen sharing that cache updates too.
  const isEffectivelyFollowing = isFollowing;

  const isOwnProfile = user?.uid === sellerId;

  const sellerName = useMemo(
    () => seller?.displayName || seller?.storeName || 'Seller',
    [seller?.displayName, seller?.storeName]
  );

  const avatarUri = useMemo(
    () => String(seller?.storeLogoUrl || '').trim() || null,
    [seller?.storeLogoUrl]
  );

  const initials = sellerName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const headerSubtitle = useMemo(() => {
    const parts: string[] = [];
    if (seller?.bio) {
      parts.push(seller.bio.length > 42 ? `${seller.bio.slice(0, 42)}…` : seller.bio);
    } else if (seller?.storeLocation?.city || seller?.storeLocation?.state) {
      parts.push([seller.storeLocation.city, seller.storeLocation.state].filter(Boolean).join(', '));
    } else if ((seller?.followerCount ?? 0) > 0) {
      parts.push(`${seller!.followerCount!.toLocaleString()} followers`);
    } else {
      parts.push('Tap for store info');
    }
    return parts[0];
  }, [seller]);

  const feedItems = useMemo(() => buildSellerFeedItems(posts), [posts]);
  const cardColor = useMemo(() => {
    if (colorScheme === 'dark') {
      return colors.backgroundSecondary;
    }
    return colors.card;
  }, [colorScheme, colors.backgroundSecondary, colors.card]);

  const mediaFallbackColor = useMemo(() => {
    if (colorScheme === 'dark') {
      return colors.backgroundSecondary;
    }
    return colors.backgroundSecondary;
  }, [colorScheme, colors.backgroundSecondary]);

  const handleFollow = async () => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to follow sellers', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }
    if (followPending || followLoading) return;
    setFollowPending(true);
    const nextFollowing = !isEffectivelyFollowing;
    haptics.medium();
    try {
      await toggleFollow(user.uid, sellerId!, isEffectivelyFollowing);
      showToast(nextFollowing ? 'Now following!' : 'Unfollowed.', 'success');
    } catch (e: any) {
      haptics.error();
      showToast(e?.message || 'Unable to update follow.', 'error');
    } finally {
      setFollowPending(false);
    }
  };

  const handleMessage = useCallback(() => {
    if (!user) {
      router.push(marketLoginRoute as any);
      return;
    }
    if (!sellerId) return;
    const chatId = buildDirectConversationId(user.uid, sellerId);
    router.push(`/(market)/messages/${chatId}?peerId=${encodeURIComponent(sellerId)}` as any);
  }, [marketLoginRoute, sellerId, user]);

  const handleAskPrice = useCallback(
    (post: MarketPost) => {
      const hasPrice = typeof post.price === 'number' && post.price > 0;
      void startPostQuoteChat({
        post,
        buyerId: user?.uid || '',
        sellerName,
        sellerAvatar: seller?.storeLogoUrl,
        mode: hasPrice ? 'dm' : 'ask-price',
        marketLoginRoute,
      });
    },
    [marketLoginRoute, seller?.storeLogoUrl, sellerName, user?.uid]
  );

  const openPost = useCallback((post: MarketPost, mediaIndex = 0) => {
    haptics.light();
    setViewingPost({ post, mediaIndex });
  }, []);

  const closeViewer = useCallback(() => {
    setViewingPost(null);
  }, []);

  const openBuy = useCallback((post: MarketPost) => {
    if (!post.id) return;
    router.push(`/(market)/buy/${post.id}` as any);
  }, []);

  const addToCart = useCallback((post: MarketPost) => {
    if (!user) {
      router.push(marketLoginRoute as any);
      return;
    }
    useMarketCartStore.getState().addPost(post);
  }, [marketLoginRoute, user]);

  const renderItem = useCallback(
    ({ item }: { item: SellerFeedItem }) => {
      if (item.kind === 'date') {
        return (
          <View style={styles.dateSeparatorWrap}>
            <View style={[styles.dateSeparator, { backgroundColor: cardColor }]}>
              <Text style={[styles.dateSeparatorText, { color: colors.textSecondary }]}>{item.label}</Text>
            </View>
          </View>
        );
      }

      const hasPrice = typeof item.post.price === 'number' && item.post.price > 0;

      return (
        <SellerBroadcastCard
          post={item.post}
          sellerAvatarUri={avatarUri}
          bubbleColor={cardColor}
          borderColor={colors.border}
          mediaFallbackColor={mediaFallbackColor}
          textColor={colors.text}
          textSecondary={colors.textSecondary}
          accentColor={lightBrown}
          onPress={(mediaIndex) => openPost(item.post, mediaIndex)}
          onBuyPress={hasPrice ? () => openBuy(item.post) : undefined}
          onAddToCartPress={hasPrice && !isOwnProfile ? () => addToCart(item.post) : undefined}
          onAskPress={!isOwnProfile ? () => handleAskPrice(item.post) : undefined}
        />
      );
    },
    [addToCart, avatarUri, cardColor, colors.border, colors.text, colors.textSecondary, handleAskPrice, isOwnProfile, mediaFallbackColor, openBuy, openPost]
  );

  // Never block the whole screen on profile — listings Query starts immediately and should
  // paint from cache / Neon without waiting on a thin-user Firestore hydrate.
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Compact WhatsApp-style header */}
      <View style={[styles.topBar, { paddingTop: insets.top + 4, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerIdentity}
          activeOpacity={0.75}
          onPress={() => setInfoVisible(true)}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.headerAvatar} contentFit="cover" />
          ) : (
            <View style={[styles.headerAvatar, styles.avatarFallback, { backgroundColor: `${lightBrown}33` }]}>
              {sellerLoading ? (
                <ActivityIndicator size="small" color={lightBrown} />
              ) : (
                <Text style={[styles.avatarInitials, { color: lightBrown }]}>{initials}</Text>
              )}
            </View>
          )}
          <View style={styles.headerTextBlock}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
                {sellerLoading && !seller ? 'Store' : sellerName}
              </Text>
              <VerifiedBadge size={14} />
            </View>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {sellerLoading && !seller ? 'Loading…' : headerSubtitle}
            </Text>
          </View>
        </TouchableOpacity>

        {!isOwnProfile ? (
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={handleFollow}
              disabled={followPending || followLoading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              {followPending ? (
                <ActivityIndicator size="small" color={lightBrown} />
              ) : (
                <IconSymbol
                  name={isEffectivelyFollowing ? 'checkmark.circle.fill' : 'plus.circle'}
                  size={22}
                  color={isEffectivelyFollowing ? lightBrown : colors.text}
                />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={handleMessage}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <IconSymbol name="message.fill" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      {/* Feed */}
      <FlatList
        data={feedItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: colors.background }}
        ListEmptyComponent={
          postsLoading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator color={lightBrown} />
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <IconSymbol name="bag" size={40} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No listings yet</Text>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                When {sellerName} posts items, they will appear here.
              </Text>
            </View>
          )
        }
        contentContainerStyle={{
          paddingTop: 8,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE,
          flexGrow: feedItems.length === 0 ? 1 : undefined,
        }}
      />

      <SellerCardMediaViewer
        post={viewingPost?.post ?? null}
        initialMediaIndex={viewingPost?.mediaIndex ?? 0}
        visible={viewingPost !== null}
        onClose={closeViewer}
        accentColor={lightBrown}
        onBuyPress={
          viewingPost &&
          typeof viewingPost.post.price === 'number' &&
          viewingPost.post.price > 0
            ? () => {
                closeViewer();
                openBuy(viewingPost.post);
              }
            : undefined
        }
        onAskPress={
          !isOwnProfile && viewingPost
            ? () => {
                const post = viewingPost.post;
                const hasPrice = typeof post.price === 'number' && post.price > 0;
                closeViewer();
                void startPostQuoteChat({
                  post,
                  buyerId: user?.uid || '',
                  sellerName,
                  sellerAvatar: seller?.storeLogoUrl,
                  mode: hasPrice ? 'dm' : 'ask-price',
                  marketLoginRoute,
                });
              }
            : undefined
        }
      />

      {/* Store info modal */}
      <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setInfoVisible(false)}>
          <Pressable
            style={[styles.infoSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.infoHeader}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.infoAvatar} contentFit="cover" />
              ) : (
                <View style={[styles.infoAvatar, styles.avatarFallback, { backgroundColor: `${lightBrown}33` }]}>
                  <Text style={[styles.avatarInitials, { color: lightBrown, fontSize: 28 }]}>{initials}</Text>
                </View>
              )}
              <View style={styles.infoNameRow}>
                <Text style={[styles.infoName, { color: colors.text }]}>{sellerName}</Text>
                <VerifiedBadge size={18} />
              </View>
              {seller?.storeName && seller.storeName !== sellerName ? (
                <Text style={[styles.infoStoreName, { color: colors.textSecondary }]}>{seller.storeName}</Text>
              ) : null}
            </View>

            {seller?.bio ? (
              <Text style={[styles.infoBio, { color: colors.text }]}>{seller.bio}</Text>
            ) : null}

            {seller?.storeLocation?.city || seller?.storeLocation?.state ? (
              <View style={styles.infoRow}>
                <IconSymbol name="location.fill" size={14} color={colors.textSecondary} />
                <Text style={[styles.infoRowText, { color: colors.textSecondary }]}>
                  {[seller.storeLocation.city, seller.storeLocation.state].filter(Boolean).join(', ')}
                </Text>
              </View>
            ) : null}

            <View style={styles.infoStatsRow}>
              <View style={styles.infoStat}>
                <Text style={[styles.infoStatValue, { color: colors.text }]}>{posts.length}</Text>
                <Text style={[styles.infoStatLabel, { color: colors.textSecondary }]}>Listings</Text>
              </View>
              <TouchableOpacity
                style={styles.infoStat}
                activeOpacity={0.7}
                onPress={() => {
                  if (!sellerId) return;
                  setInfoVisible(false);
                  router.push({
                    pathname: '/(market)/social-people',
                    params: { mode: 'followers', userId: sellerId },
                  } as any);
                }}>
                <Text style={[styles.infoStatValue, { color: colors.text }]}>{seller?.followerCount ?? 0}</Text>
                <Text style={[styles.infoStatLabel, { color: colors.textSecondary }]}>Followers</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.infoStat}
                activeOpacity={0.7}
                onPress={() => {
                  if (!sellerId) return;
                  setInfoVisible(false);
                  router.push({
                    pathname: '/(market)/social-people',
                    params: { mode: 'following', userId: sellerId },
                  } as any);
                }}>
                <Text style={[styles.infoStatValue, { color: colors.text }]}>{seller?.followingCount ?? 0}</Text>
                <Text style={[styles.infoStatLabel, { color: colors.textSecondary }]}>Following</Text>
              </TouchableOpacity>
            </View>

            {!isOwnProfile ? (
              <View style={styles.infoActions}>
                <TouchableOpacity
                  style={[styles.infoFollowBtn, { backgroundColor: isEffectivelyFollowing ? colors.backgroundSecondary : lightBrown, borderColor: colors.border, borderWidth: isEffectivelyFollowing ? 1 : 0 }]}
                  onPress={handleFollow}
                  disabled={followPending || followLoading}>
                  <Text style={[styles.infoFollowBtnText, { color: isEffectivelyFollowing ? colors.text : '#FFF' }]}>
                    {isEffectivelyFollowing ? 'Following' : 'Follow store'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.infoMessageBtn, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                  onPress={() => {
                    setInfoVisible(false);
                    handleMessage();
                  }}>
                  <IconSymbol name="message.fill" size={16} color={colors.text} />
                  <Text style={[styles.infoMessageBtnText, { color: colors.text }]}>Message</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity style={styles.infoCloseBtn} onPress={() => setInfoVisible(false)}>
              <Text style={[styles.infoCloseBtnText, { color: colors.textSecondary }]}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 13,
    fontWeight: '800',
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerName: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateSeparatorWrap: {
    alignItems: 'center',
    marginVertical: 6,
  },
  dateSeparator: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  dateSeparatorText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  infoSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  infoHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  infoAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 10,
  },
  infoNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  infoName: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  infoStoreName: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  infoBio: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 16,
  },
  infoRowText: {
    fontSize: 13,
    fontWeight: '500',
  },
  infoStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  infoStat: {
    alignItems: 'center',
    gap: 2,
  },
  infoStatValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  infoStatLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  infoActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  infoFollowBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoFollowBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  infoMessageBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  infoMessageBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  infoCloseBtn: {
    alignItems: 'center',
    paddingTop: 12,
  },
  infoCloseBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
