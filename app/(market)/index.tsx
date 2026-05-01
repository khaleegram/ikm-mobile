import React, { useRef, useCallback } from 'react';
import {
  View,
  useWindowDimensions,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showToast } from '@/components/toast';
import { useMarketPosts } from '@/lib/firebase/firestore/market-posts';
import { FeedCard } from '@/components/market/feed-card';
import { FlashListCompat } from '@/components/layout/flash-list-compat';
import { MarketPost } from '@/types';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { getDeviceCoordinates } from '@/lib/utils/device-location';
import { buildMarketPostStableKey } from '@/lib/utils/market-media';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { getMarketBranding } from '@/lib/market-branding';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';

const lightBrown = '#A67C52';
const SNAP_TOLERANCE_PX = 2;
const MARKET_LOCATION_PROMPT_KEY = '@ikm_market_location_prompted_v1';

export default function MarketFeedScreen() {
  const marketBrand = getMarketBranding();
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: profile } = useUserProfile(user?.uid || null);
  const { posts, loading, error, loadMore, hasMore, refresh } = useMarketPosts();
  const [refreshing, setRefreshing] = React.useState(false);
  const viewportHeight = Math.max(1, Math.round(windowHeight));
  const [activePostId, setActivePostId] = React.useState<string | null>(null);
  const flatListRef = useRef<any>(null);
  const isProgrammaticSnapRef = useRef(false);
  const activeIndexRef = useRef(0);
  const hasShownLocationPromptRef = useRef(false);
  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 75 }).current;
  const onViewableItemsChanged = React.useRef(({ viewableItems }: any) => {
    const firstVisible = viewableItems?.[0]?.item as MarketPost | undefined;
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

  React.useEffect(() => {
    if (!user?.uid || !profile) return;
    if (hasShownLocationPromptRef.current) return;

    const rawLocation = (profile as any)?.marketBuyerLocation || {};
    const latitude = Number(rawLocation.latitude);
    const longitude = Number(rawLocation.longitude);
    const hasCoordinates =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) > 0.0001 &&
      Math.abs(longitude) > 0.0001;
    if (hasCoordinates) return;

    hasShownLocationPromptRef.current = true;

    void (async () => {
      try {
        const alreadyPrompted = await AsyncStorage.getItem(MARKET_LOCATION_PROMPT_KEY);
        if (alreadyPrompted) return;
        await AsyncStorage.setItem(MARKET_LOCATION_PROMPT_KEY, '1');

        Alert.alert(
          'Use your location?',
          'Allow IKM to use your device location to help prefill delivery settings. You can change it during checkout.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Allow',
              onPress: () => {
                void (async () => {
                  try {
                    const coords = await getDeviceCoordinates();
                    await setDoc(
                      doc(firestore, 'users', user.uid),
                      {
                        marketBuyerLocation: {
                          state: String(rawLocation.state || '').trim(),
                          city: String(rawLocation.city || '').trim(),
                          address: String(rawLocation.address || '').trim(),
                          latitude: coords.latitude,
                          longitude: coords.longitude,
                        },
                        updatedAt: serverTimestamp(),
                      },
                      { merge: true }
                    );
                    showToast('Device location saved.', 'success');
                  } catch (locationError: any) {
                    showToast(locationError?.message || 'Unable to capture location.', 'error');
                  }
                })();
              },
            },
          ]
        );
      } catch {
        // Never block the feed for a prompt storage issue.
      }
    })();
  }, [profile, user?.uid]);

  const onRefresh = async () => {
    setRefreshing(true);
    haptics.light();
    refresh();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleEndReached = () => {
    if (hasMore && !loading) {
      loadMore();
    }
  };

  const settleToNearestPost = useCallback(
    (rawOffsetY: number, animated: boolean) => {
      const listRef = flatListRef.current;
      if (!listRef || posts.length === 0) return;
      const pageHeight = Math.max(1, viewportHeight);
      const clampedOffset = Math.max(0, Number(rawOffsetY || 0));
      const nearestIndex = Math.max(0, Math.min(posts.length - 1, Math.round(clampedOffset / pageHeight)));
      const targetOffset = nearestIndex * pageHeight;

      if (Math.abs(targetOffset - clampedOffset) <= SNAP_TOLERANCE_PX) return;
      if (typeof listRef.scrollToOffset !== 'function') return;

      isProgrammaticSnapRef.current = true;
      listRef.scrollToOffset({ offset: targetOffset, animated });
      setTimeout(() => {
        isProgrammaticSnapRef.current = false;
      }, 140);
    },
    [posts.length, viewportHeight]
  );

  const handleMomentumScrollEnd = useCallback(
    (event: any) => {
      if (isProgrammaticSnapRef.current) return;
      const offsetY = Number(event?.nativeEvent?.contentOffset?.y || 0);
      settleToNearestPost(offsetY, true);
    },
    [settleToNearestPost]
  );

  const handleScrollEndDrag = useCallback(
    (event: any) => {
      if (isProgrammaticSnapRef.current) return;
      const velocityY = Number(event?.nativeEvent?.velocity?.y || 0);
      if (Math.abs(velocityY) > 0.05) return;
      const offsetY = Number(event?.nativeEvent?.contentOffset?.y || 0);
      settleToNearestPost(offsetY, true);
    },
    [settleToNearestPost]
  );

  const renderItem = useCallback(
    ({ item }: { item: MarketPost }) => (
      <FeedCard
        post={item}
        itemHeight={viewportHeight}
        isActive={item.id === activePostId}
      />
    ),
    [activePostId, viewportHeight]
  );

  const keyExtractor = useCallback(
    (item: MarketPost) => buildMarketPostStableKey(item),
    []
  );

  React.useEffect(() => {
    if (!posts.length) {
      setActivePostId(null);
      return;
    }
    setActivePostId((current) => current || posts[0]?.id || null);
  }, [posts]);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: viewportHeight,
      offset: viewportHeight * index,
      index,
    }),
    [viewportHeight]
  );

  const renderHomeAppBar = () => (
    <View pointerEvents="box-none" style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 6 }]}>
      <View style={styles.headerTopRow}>
        <View style={styles.headerTitles}>
          <Text style={styles.headerSuper}>{marketBrand.headerLine}</Text>
          <Text style={styles.headerTitle}>Home</Text>
        </View>
        <TouchableOpacity
          style={styles.searchButton}
          onPress={() => {
            haptics.light();
            router.push('/(market)/search');
          }}>
          <IconSymbol name="magnifyingglass" size={19} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading && posts.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" />
        {renderHomeAppBar()}
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  if (error && posts.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" />
        {renderHomeAppBar()}
        <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.error} />
        <Text style={[styles.errorText, { color: colors.error }]}>
          Error loading feed
        </Text>
        <Text style={[styles.errorSubtext, { color: colors.textSecondary }]}>
          {error.message || 'Please check your connection and try again'}
        </Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: lightBrown }]}
          onPress={() => {
            haptics.medium();
            refresh();
          }}>
          <IconSymbol name="arrow.clockwise" size={20} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" />
        {renderHomeAppBar()}
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No posts available
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <StatusBar barStyle="light-content" translucent />

      <FlashListCompat
        key={`market-feed-${viewportHeight}`}
        ref={flatListRef}
        data={posts}
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
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollEndDrag={handleScrollEndDrag}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
            colors={['#A67C52']}
          />
        }
        getItemLayout={getItemLayout}
        removeClippedSubviews={false}
        maxToRenderPerBatch={3}
        windowSize={5}
        initialNumToRender={3}
        updateCellsBatchingPeriod={50}
        ListFooterComponent={
          loading && posts.length > 0 ? (
            <View style={[styles.footerLoader, { height: viewportHeight }]}>
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          ) : null
        }
      />

      {renderHomeAppBar()}
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
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitles: {
    gap: 1,
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
  searchButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  errorSubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  footerLoader: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
