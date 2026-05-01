import { router } from 'expo-router';
import React, { useMemo, useRef, useCallback } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard } from '@/components/market/feed-card';
import { FlashListCompat } from '@/components/layout/flash-list-compat';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostsByPosterIds } from '@/lib/firebase/firestore/market-posts';
import { useBlockedUserIds, useFollowingUserIds } from '@/lib/firebase/firestore/market-social';
import { getMarketBranding } from '@/lib/market-branding';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { buildMarketPostStableKey } from '@/lib/utils/market-media';

const lightBrown = '#A67C52';

export default function FollowingScreen() {
  const marketBrand = getMarketBranding();
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { ids: followingIds, loading: followsLoading } = useFollowingUserIds(user?.uid || null);
  const { idSet: blockedIdSet } = useBlockedUserIds(user?.uid || null);
  const { posts, loading: postsLoading, error } = useMarketPostsByPosterIds(followingIds, 120);

  const visiblePosts = useMemo(() => {
    return posts.filter((post) => !blockedIdSet.has(String(post.posterId || '')));
  }, [blockedIdSet, posts]);

  const [activePostId, setActivePostId] = React.useState<string | null>(null);
  const viewportHeight = Math.max(1, Math.round(windowHeight));
  const [refreshing, setRefreshing] = React.useState(false);
  const flatListRef = useRef<any>(null);
  const activeIndexRef = useRef(0);
  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 75 }).current;
  const onViewableItemsChanged = React.useRef(({ viewableItems }: any) => {
    const firstVisible = viewableItems?.[0]?.item;
    const firstIndex = Number(viewableItems?.[0]?.index || 0);
    if (Number.isFinite(firstIndex)) activeIndexRef.current = Math.max(0, firstIndex);
    setActivePostId(firstVisible?.id || null);
  }).current;

  useFocusEffect(
    useCallback(() => {
      const listRef = flatListRef.current;
      if (!listRef || typeof listRef.scrollToOffset !== 'function') return undefined;
      const offset = Math.max(0, activeIndexRef.current) * viewportHeight;
      requestAnimationFrame(() => {
        listRef.scrollToOffset({ offset, animated: false });
      });
      return undefined;
    }, [viewportHeight])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    haptics.light();
    setTimeout(() => setRefreshing(false), 800);
  };

  const renderItem = useCallback(
    ({ item }: any) => (
      <FeedCard
        post={item}
        itemHeight={viewportHeight}
        isActive={item.id === activePostId}
      />
    ),
    [activePostId, viewportHeight]
  );

  const keyExtractor = useCallback((item: any) => buildMarketPostStableKey(item), []);
  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: viewportHeight,
      offset: viewportHeight * index,
      index,
    }),
    [viewportHeight]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {!user ? (
        <View style={styles.center}>
          <IconSymbol name="person.crop.circle.badge.exclamationmark" size={52} color={lightBrown} />
          <Text style={[styles.title, { color: colors.text }]}>Sign in to follow sellers</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Your following feed appears here once you follow sellers.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: lightBrown }]}
            onPress={() => {
              haptics.light();
              router.push('/(auth)/market-login' as any);
            }}>
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      ) : followsLoading || postsLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <IconSymbol name="exclamationmark.triangle.fill" size={44} color={colors.error} />
          <Text style={[styles.title, { color: colors.text }]}>Couldn’t load following feed</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{error.message}</Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: lightBrown }]}
            onPress={() => {
              haptics.light();
              router.push('/(market)/search' as any);
            }}>
            <IconSymbol name="magnifyingglass" size={18} color="#FFFFFF" />
            <Text style={styles.buttonText}>Find Sellers</Text>
          </TouchableOpacity>
        </View>
      ) : followingIds.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="person.2.fill" size={56} color={lightBrown} />
          <Text style={[styles.title, { color: colors.text }]}>No sellers followed yet</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Follow sellers to personalize this feed.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: lightBrown }]}
            onPress={() => {
              haptics.light();
              router.push('/(market)/search');
            }}>
            <IconSymbol name="magnifyingglass" size={18} color="#FFFFFF" />
            <Text style={styles.buttonText}>Find Sellers</Text>
          </TouchableOpacity>
        </View>
      ) : visiblePosts.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            No posts found from sellers you follow yet.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: lightBrown }]}
            onPress={() => {
              haptics.light();
              router.push('/(market)/search');
            }}>
            <IconSymbol name="magnifyingglass" size={18} color="#FFFFFF" />
            <Text style={styles.buttonText}>Find Sellers</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <View pointerEvents="box-none" style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 6 }]}>
            <Text style={styles.headerSuper}>{marketBrand.headerLine}</Text>
            <Text style={styles.headerTitle}>Following</Text>
          </View>
          <FlashListCompat
            key={`following-feed-${viewportHeight}`}
            ref={flatListRef}
            data={visiblePosts}
            extraData={`${activePostId || ''}-${viewportHeight}`}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            estimatedItemSize={viewportHeight}
            pagingEnabled={true}
            snapToInterval={viewportHeight}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            bounces={false}
            alwaysBounceVertical={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            getItemLayout={getItemLayout}
            removeClippedSubviews={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#FFFFFF"
                colors={['#A67C52']}
              />
            }
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  floatingHeaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 50,
    paddingHorizontal: 16,
  },
  headerSuper: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
