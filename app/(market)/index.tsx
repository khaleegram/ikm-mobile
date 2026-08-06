import React, { useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { showToast } from '@/components/toast';
import { saveMarketBuyerProfile } from '@/lib/api/market-buyer-profile';
import { marketFeedApi, type FeedPageParams } from '@/lib/api/market-feed';
import { useFollowingUserIds, useUserSavedPostIds } from '@/lib/hooks/use-social';
import { FeedSocialProvider } from '@/lib/context/feed-social-context';
import {
  getFeedActivePostId,
  setFeedActivePostId,
  useFeedMediaPrefetch,
} from '@/lib/hooks/use-feed-active-post';
import { useClipFeed } from '@/lib/hooks/use-clip-feed';
import { useUsersBatch } from '@/lib/hooks/use-user-identity';
import { marketPostsApi } from '@/lib/api/market-posts';
import { FeedVideoItem } from '@/components/market/feed-video-item';
import { FeedSegmentSwitch } from '@/components/market/feed-segment-switch';
import { VerticalClipFeed } from '@/components/market/vertical-clip-feed';
import { MarketPost } from '@/types';
import { useUser } from '@/lib/firebase/auth/use-user';
import { haptics } from '@/lib/utils/haptics';
import { getDeviceCoordinates } from '@/lib/utils/device-location';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { router, useLocalSearchParams } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Platform } from 'react-native';
import { Alert } from '@/components/app-alert';

const lightBrown = '#A67C52';
const MARKET_LOCATION_PROMPT_KEY = '@ikm_market_location_prompted_v1';
type FeedMode = 'foryou' | 'following';

export default function MarketFeedScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: profile } = useUserProfile(user?.uid || null);
  const [feedMode, setFeedMode] = React.useState<FeedMode>(
    mode === 'following' ? 'following' : 'foryou'
  );
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [focused, setFocused] = React.useState(true);
  const [muted, setMuted] = React.useState(false);
  const listRef = useRef<any>(null);
  const hasShownLocationPromptRef = useRef(false);
  const navigation = useNavigation();

  const {
    ids: followingIds,
    idSet: followingIdSet,
    error: followingError,
    refetch: refetchFollowing,
  } = useFollowingUserIds(user?.uid || null);
  const { idSet: savedIdSet } = useUserSavedPostIds(user?.uid || null);

  React.useEffect(() => {
    if (mode === 'following') setFeedMode('following');
    if (mode === 'foryou') setFeedMode('foryou');
  }, [mode]);

  // Following without auth → bounce to For You
  React.useEffect(() => {
    if (feedMode === 'following' && !user) {
      setFeedMode('foryou');
    }
  }, [feedMode, user]);

  const fetchPage = React.useMemo(() => {
    if (feedMode === 'following') {
      if (!user) return null;
      return (params: FeedPageParams) => marketFeedApi.getFollowingFeed(params);
    }
    if (!user) {
      return (params: FeedPageParams) => marketFeedApi.getPublicFeed(params);
    }
    return (params: FeedPageParams) => marketFeedApi.getForYouFeed(params);
  }, [feedMode, user]);

  const {
    items: posts,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    removeItem,
    patchItem,
    markSeen,
  } = useClipFeed(fetchPage);

  // One batched identity fetch for visible posters — warms Query so overlays don't
  // each flash "Seller" while waiting on N× GET /users/:id.
  const feedPosterIds = React.useMemo(
    () => posts.map((post) => post.posterId).filter(Boolean),
    [posts]
  );
  useUsersBatch(feedPosterIds);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const markSeenRef = useRef(markSeen);
  markSeenRef.current = markSeen;

  const postsRef = useRef(posts);
  postsRef.current = posts;
  const patchItemRef = useRef(patchItem);
  patchItemRef.current = patchItem;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const activeId = String(
        postsRef.current[activeIndexRef.current]?.id || getFeedActivePostId() || ''
      ).trim();
      if (activeId) {
        void marketPostsApi
          .getById(activeId)
          .then((fresh) => {
            if (fresh?.id) patchItemRef.current(fresh.id, fresh);
          })
          .catch(() => {});
      }
      return () => setFocused(false);
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      const ref = listRef.current;
      if (!ref || typeof ref.scrollToOffset !== 'function') return undefined;
      // Soft restore only — VerticalClipFeed owns measured page height via getItemLayout.
      return undefined;
    }, [])
  );

  React.useEffect(() => {
    const handler = (e: { preventDefault: () => void }) => {
      if (!navigation.isFocused()) return;
      e.preventDefault();
      void refreshRef.current();
      const ref = listRef.current;
      if (ref && typeof ref.scrollToOffset === 'function') {
        ref.scrollToOffset({ offset: 0, animated: true });
      }
      setActiveIndex(0);
    };
    navigation.addListener('tabPress' as any, handler as any);
    return () => {
      navigation.removeListener('tabPress' as any, handler as any);
    };
  }, [navigation]);

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
                    await saveMarketBuyerProfile(user.uid, {
                      marketBuyerLocation: {
                        state: String(rawLocation.state || '').trim(),
                        city: String(rawLocation.city || '').trim(),
                        address: String(rawLocation.address || '').trim(),
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                      },
                    });
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

  const handleFeedModeChange = useCallback((next: string) => {
    setFeedMode(next as FeedMode);
    setActiveIndex(0);
    const ref = listRef.current;
    if (ref && typeof ref.scrollToOffset === 'function') {
      ref.scrollToOffset({ offset: 0, animated: false });
    }
  }, []);

  const onRefresh = useCallback(() => {
    haptics.light();
    void refresh();
  }, [refresh]);

  const handleEndReached = useCallback(() => {
    if (hasMore && !loading && !loadingMore) {
      void loadMore();
    }
  }, [hasMore, loading, loadingMore, loadMore]);

  const handleActiveIndexChange = useCallback(
    (index: number, item: MarketPost | null) => {
      setActiveIndex(index);
      setFeedActivePostId(item?.id || null, index);
    },
    []
  );

  // Mark seen only after real dwell (~1.5s) on the active clip — not on every viewability flicker.
  const activePostId = String(posts[activeIndex]?.id || '').trim();
  React.useEffect(() => {
    if (!user || !focused || !activePostId) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      const dwellSec = Math.max(1.5, (Date.now() - startedAt) / 1000);
      markSeenRef.current([activePostId], dwellSec);
    }, 1500);
    return () => clearTimeout(timer);
  }, [activePostId, focused, user]);

  useFeedMediaPrefetch(posts);

  React.useEffect(() => {
    if (!posts.length) {
      setFeedActivePostId(null);
      return;
    }
    if (!getFeedActivePostId()) {
      setFeedActivePostId(posts[0]?.id || null, 0);
    }
  }, [posts]);

  const renderItem = useCallback(
    ({ item, index, itemHeight }: { item: MarketPost; index: number; itemHeight: number }) => (
      <FeedVideoItem
        post={item}
        itemHeight={itemHeight}
        index={index}
        isActive={index === activeIndex}
        focused={focused}
        muted={muted}
        onMutedChange={setMuted}
        onPatchItem={patchItem}
        onRemoveItem={removeItem}
      />
    ),
    [activeIndex, focused, muted, patchItem, removeItem]
  );

  const renderHomeAppBar = () => (
    <View
      pointerEvents="box-none"
      style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 2 }]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
      ) : null}
      <View style={styles.headerRow}>
        <View style={styles.headerSide} />
        <FeedSegmentSwitch
          options={[
            { id: 'foryou', label: 'For You' },
            { id: 'following', label: 'Following' },
          ]}
          value={feedMode}
          onChange={handleFeedModeChange}
        />
        <View style={[styles.headerSide, styles.headerSideRight]}>
          <TouchableOpacity
            style={styles.searchPill}
            onPress={() => {
              haptics.light();
              router.push('/(market)/search');
            }}
            activeOpacity={0.8}>
            <IconSymbol name="magnifyingglass" size={14} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (loading && posts.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        {renderHomeAppBar()}
        <ActivityIndicator size="large" color={lightBrown} style={{ marginTop: 80 }} />
      </View>
    );
  }

  if (error && posts.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        {renderHomeAppBar()}
        <IconSymbol name="exclamationmark.triangle.fill" size={48} color="#FF3B55" />
        <Text style={styles.errorText}>Error loading feed</Text>
        <Text style={styles.errorSubtext}>
          {error.message || 'Please check your connection and try again'}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            haptics.medium();
            void refresh();
          }}>
          <IconSymbol name="arrow.clockwise" size={20} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (posts.length === 0) {
    const isFollowingMode = feedMode === 'following';
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        {renderHomeAppBar()}
        {isFollowingMode ? (
          <>
            <IconSymbol
              name={followingError ? 'exclamationmark.triangle.fill' : 'person.2.fill'}
              size={48}
              color={followingError ? '#FF3B55' : lightBrown}
            />
            <Text style={[styles.emptyText, { color: 'rgba(255,255,255,0.7)', marginTop: 12 }]}>
              {!user
                ? 'Sign in to see posts from sellers you follow'
                : followingError
                  ? 'Could not load who you follow'
                  : followingIds.length === 0
                    ? 'Follow sellers to see their posts here'
                    : 'No posts from followed sellers yet'}
            </Text>
            {user && followingError ? (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  haptics.medium();
                  void refetchFollowing();
                }}>
                <IconSymbol name="arrow.clockwise" size={18} color="#FFFFFF" />
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            ) : user && followingIds.length === 0 ? (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  haptics.light();
                  router.push('/(market)/search');
                }}>
                <IconSymbol name="magnifyingglass" size={18} color="#FFFFFF" />
                <Text style={styles.retryButtonText}>Find Sellers</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <Text style={[styles.emptyText, { color: 'rgba(255,255,255,0.5)' }]}>No posts yet</Text>
        )}
      </View>
    );
  }

  return (
    <FeedSocialProvider followingIdSet={followingIdSet} savedIdSet={savedIdSet}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent />
        <VerticalClipFeed
          listRef={listRef}
          items={posts}
          renderItem={renderItem}
          onActiveIndexChange={handleActiveIndexChange}
          onEndReached={handleEndReached}
          onRefresh={onRefresh}
          refreshing={refreshing}
          loadingMore={loadingMore}
        />
        {renderHomeAppBar()}
      </View>
    </FeedSocialProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  floatingHeaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 50,
    overflow: 'hidden',
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  headerSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 40,
  },
  headerSideRight: {
    justifyContent: 'flex-end',
  },
  searchPill: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#FF3B55',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  errorSubtext: {
    color: 'rgba(255,255,255,0.5)',
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
    backgroundColor: '#A67C52',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
