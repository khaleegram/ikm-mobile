import { router } from 'expo-router';
import React, { useMemo, useRef, useCallback } from 'react';
import { ActivityIndicator, Dimensions, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard } from '@/components/market/feed-card';
import { FlashListCompat } from '@/components/layout/flash-list-compat';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostsByPosterIds } from '@/lib/firebase/firestore/market-posts';
import { useBlockedUserIds, useFollowingUserIds } from '@/lib/firebase/firestore/market-social';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { buildMarketPostStableKey } from '@/lib/utils/market-media';

const lightBrown = '#A67C52';
const { height } = Dimensions.get('window');

export default function FollowingScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { ids: followingIds, loading: followsLoading } = useFollowingUserIds(user?.uid || null);
  const { idSet: blockedIdSet } = useBlockedUserIds(user?.uid || null);
  const { posts, loading: postsLoading, error } = useMarketPostsByPosterIds(followingIds, 120);

  const visiblePosts = useMemo(() => {
    return posts.filter((post) => !blockedIdSet.has(String(post.posterId || '')));
  }, [blockedIdSet, posts]);

  const [activePostId, setActivePostId] = React.useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = React.useState(height);
  const [refreshing, setRefreshing] = React.useState(false);
  const flatListRef = useRef<any>(null);
  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 75 }).current;
  const onViewableItemsChanged = React.useRef(({ viewableItems }: any) => {
    const firstVisible = viewableItems?.[0]?.item;
    setActivePostId(firstVisible?.id || null);
  }).current;

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
        onComment={() => {
          if (!item.id) return;
          router.push(`/(market)/post/${item.id}` as any);
        }}
      />
    ),
    [activePostId, viewportHeight]
  );

  const keyExtractor = useCallback((item: any) => buildMarketPostStableKey(item), []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 10 }]}>
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>MARKET STREET</Text>
          <Text style={styles.islandTitle}>Following</Text>
        </View>
      </View>

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
        <View
          style={{ flex: 1, backgroundColor: '#000' }}
          onLayout={(event) => {
            const nextHeight = Math.round(event.nativeEvent.layout.height);
            if (nextHeight > 0 && nextHeight !== viewportHeight) setViewportHeight(nextHeight);
          }}>
          <FlashListCompat
            ref={flatListRef}
            data={visiblePosts}
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
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  nameIsland: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  islandLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  islandTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
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
