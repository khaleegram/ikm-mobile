import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { buildDirectConversationId } from '@/lib/api/market-messages';
import { marketSocialApi } from '@/lib/api/market-social';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserMarketPosts } from '@/lib/firebase/firestore/market-posts';
import { useIsFollowing } from '@/lib/firebase/firestore/market-social';
import { usePublicUserProfile } from '@/lib/firebase/firestore/users';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { useTheme } from '@/lib/theme/theme-context';
import { getMarketPostPrimaryImage } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

const lightBrown = '#A67C52';

export default function SellerProfileScreen() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: seller, loading: sellerLoading } = usePublicUserProfile(sellerId ?? null);
  const { posts, loading: postsLoading } = useUserMarketPosts(sellerId ?? null);
  const { isFollowing, loading: followLoading } = useIsFollowing(user?.uid ?? null, sellerId ?? null);
  const [followPending, setFollowPending] = useState(false);
  const [optimisticFollowing, setOptimisticFollowing] = useState<boolean | null>(null);
  const marketLoginRoute = getLoginRouteForVariant('market');
  const isEffectivelyFollowing = optimisticFollowing ?? isFollowing;

  React.useEffect(() => {
    if (optimisticFollowing !== null && optimisticFollowing === isFollowing) {
      setOptimisticFollowing(null);
    }
  }, [isFollowing, optimisticFollowing]);

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
    setOptimisticFollowing(nextFollowing);
    haptics.medium();
    try {
      await marketSocialApi.setFollowState(sellerId!, nextFollowing);
      showToast(nextFollowing ? 'Now following!' : 'Unfollowed.', 'success');
    } catch (e: any) {
      setOptimisticFollowing(isFollowing);
      haptics.error();
      showToast(e?.message || 'Unable to update follow.', 'error');
    } finally {
      setFollowPending(false);
    }
  };

  const handleMessage = () => {
    if (!user) { router.push(marketLoginRoute as any); return; }
    if (!sellerId) return;
    const chatId = buildDirectConversationId(user.uid, sellerId);
    router.push(`/(market)/messages/${chatId}?peerId=${encodeURIComponent(sellerId)}` as any);
  };

  const renderPost = useCallback(({ item }: { item: MarketPost }) => {
    const thumb = getMarketPostPrimaryImage(item);
    const hasPrice = typeof item.price === 'number' && item.price > 0;
    return (
      <TouchableOpacity
        style={styles.postThumb}
        activeOpacity={0.82}
        onPress={() => item.id && router.push(`/(market)/post-view/${item.id}` as any)}>
        <Image
          source={{ uri: thumb || '' }}
          style={styles.postThumbImage}
          contentFit="cover"
          transition={150}
          placeholder={{ blurhash: 'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.' }}
        />
        {hasPrice && (
          <View style={styles.postThumbPrice}>
            <Text style={styles.postThumbPriceText} numberOfLines={1}>
              ₦{Number(item.price).toLocaleString()}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }, []);

  if (sellerLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={lightBrown} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.topBarTitle, { color: colors.text }]} numberOfLines={1}>
          {sellerName}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id ?? Math.random().toString()}
        renderItem={renderPost}
        numColumns={3}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.profileHeader}>
            {/* Avatar */}
            <View style={styles.avatarRow}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: `${lightBrown}33` }]}>
                  <Text style={[styles.avatarInitials, { color: lightBrown }]}>{initials}</Text>
                </View>
              )}

              <View style={styles.statsRow}>
                {[
                  { label: 'Posts', value: posts.length },
                  { label: 'Followers', value: seller?.followerCount ?? 0 },
                  { label: 'Following', value: seller?.followingCount ?? 0 },
                ].map((stat) => (
                  <View key={stat.label} style={styles.stat}>
                    <Text style={[styles.statValue, { color: colors.text }]}>{stat.value}</Text>
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Name + bio */}
            <Text style={[styles.name, { color: colors.text }]}>{sellerName}</Text>
            {seller?.storeName && seller.storeName !== sellerName ? (
              <Text style={[styles.storeName, { color: colors.textSecondary }]}>{seller.storeName}</Text>
            ) : null}
            {seller?.bio ? (
              <Text style={[styles.bio, { color: colors.text }]}>{seller.bio}</Text>
            ) : null}
            {seller?.storeLocation?.city || seller?.storeLocation?.state ? (
              <View style={styles.locationRow}>
                <IconSymbol name="location.fill" size={12} color={colors.textSecondary} />
                <Text style={[styles.locationText, { color: colors.textSecondary }]}>
                  {[seller.storeLocation.city, seller.storeLocation.state].filter(Boolean).join(', ')}
                </Text>
              </View>
            ) : null}

            {/* Action buttons */}
            {!isOwnProfile && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[
                    styles.followBtn,
                    isEffectivelyFollowing
                      ? { backgroundColor: colors.backgroundSecondary, borderWidth: 1, borderColor: colors.border }
                      : { backgroundColor: lightBrown },
                  ]}
                  onPress={handleFollow}
                  activeOpacity={0.82}
                  disabled={followPending || followLoading}>
                  {followPending ? (
                    <ActivityIndicator size="small" color={isEffectivelyFollowing ? colors.text : '#FFF'} />
                  ) : (
                    <Text style={[styles.followBtnText, { color: isEffectivelyFollowing ? colors.text : '#FFF' }]}>
                      {isEffectivelyFollowing ? 'Following' : 'Follow'}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.dmBtn, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                  onPress={handleMessage}
                  activeOpacity={0.82}>
                  <IconSymbol name="message.fill" size={16} color={colors.text} />
                  <Text style={[styles.dmBtnText, { color: colors.text }]}>Message</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </View>
        }
        ListEmptyComponent={
          postsLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={lightBrown} />
            </View>
          ) : (
            <View style={styles.emptyPosts}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No posts yet</Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      />
    </View>
  );
}

const THUMB_SIZE = 124;

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },
  profileHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginBottom: 12,
  },
  avatar: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 32,
    fontWeight: '800',
  },
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  stat: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  name: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 2,
  },
  storeName: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  locationText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 16,
  },
  followBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  dmBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  dmBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },
  postThumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    margin: 1,
    position: 'relative',
  },
  postThumbImage: {
    width: '100%',
    height: '100%',
  },
  postThumbPrice: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  postThumbPriceText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyPosts: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
