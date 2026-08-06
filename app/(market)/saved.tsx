import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { FeedVideoItem } from '@/components/market/feed-video-item';
import { FeedSegmentSwitch } from '@/components/market/feed-segment-switch';
import { VerticalClipFeed } from '@/components/market/vertical-clip-feed';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostsByIds, useUserLikedPostIds } from '@/lib/hooks/use-market-post';
import { useFollowingUserIds, useUserSavedPostIds } from '@/lib/hooks/use-social';
import { FeedSocialProvider } from '@/lib/context/feed-social-context';
import { getFeedActivePostId, setFeedActivePostId, useFeedMediaPrefetch } from '@/lib/hooks/use-feed-active-post';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import type { MarketPost } from '@/types';

const lightBrown = '#A67C52';
type CollectionMode = 'saved' | 'liked';

export default function SavedScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const navigation = useNavigation();

  const [collectionMode, setCollectionMode] = React.useState<CollectionMode>(
    mode === 'liked' ? 'liked' : 'saved'
  );
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [focused, setFocused] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const listRef = useRef<any>(null);

  useEffect(() => {
    if (mode === 'liked') setCollectionMode('liked');
    if (mode === 'saved') setCollectionMode('saved');
  }, [mode]);

  const {
    ids: savedIds,
    idSet: savedIdSet,
    loading: savesLoading,
    error: savesError,
    refetch: refetchSaved,
  } = useUserSavedPostIds(user?.uid || null);
  const {
    likedPostIds,
    loading: likesLoading,
    error: likesError,
    refetch: refetchLiked,
  } = useUserLikedPostIds(user?.uid || null);
  const { idSet: followingIdSet } = useFollowingUserIds(user?.uid || null);

  const activeIds = collectionMode === 'liked' ? likedPostIds : savedIds;
  const idsLoading = collectionMode === 'liked' ? likesLoading : savesLoading;
  const idsError = collectionMode === 'liked' ? likesError : savesError;
  const refetchIds = collectionMode === 'liked' ? refetchLiked : refetchSaved;
  const { posts, loading: postsLoading, error } = useMarketPostsByIds(activeIds, 50);

  const visiblePosts = useMemo(() => posts.filter((post) => post !== undefined), [posts]);

  const scrollToTop = useCallback(() => {
    const ref = listRef.current;
    if (ref && typeof ref.scrollToOffset === 'function') {
      ref.scrollToOffset({ offset: 0, animated: true });
    }
    setActiveIndex(0);
  }, []);

  const handleModeChange = useCallback(
    (next: string) => {
      setCollectionMode(next as CollectionMode);
      scrollToTop();
    },
    [scrollToTop]
  );

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  React.useEffect(() => {
    const handler = (e: { preventDefault: () => void }) => {
      if (!navigation.isFocused()) return;
      e.preventDefault();
      scrollToTop();
    };
    navigation.addListener('tabPress' as any, handler as any);
    return () => {
      navigation.removeListener('tabPress' as any, handler as any);
    };
  }, [navigation, scrollToTop]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptics.light();
    try {
      await Promise.all([refetchIds(), refetchSaved(), refetchLiked()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchIds, refetchSaved, refetchLiked]);

  useFeedMediaPrefetch(visiblePosts);

  React.useEffect(() => {
    if (!visiblePosts.length) {
      setFeedActivePostId(null);
      return;
    }
    if (!getFeedActivePostId()) {
      setFeedActivePostId(visiblePosts[0]?.id || null, 0);
    }
  }, [visiblePosts]);

  const handleActiveIndexChange = useCallback((index: number, item: MarketPost | null) => {
    setActiveIndex(index);
    setFeedActivePostId(item?.id || null, index);
  }, []);

  const renderItem = useCallback(
    ({ item, index, itemHeight }: { item: MarketPost; index: number; itemHeight: number }) => (
      <FeedVideoItem
        post={item}
        itemHeight={itemHeight}
        index={index}
        isActive={index === activeIndex}
        focused={focused}
      />
    ),
    [activeIndex, focused]
  );

  const renderHeader = () => (
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
            { id: 'saved', label: 'Saved' },
            { id: 'liked', label: 'Liked' },
          ]}
          value={collectionMode}
          onChange={handleModeChange}
        />
        <View style={[styles.headerSide, styles.headerSideRight]} />
      </View>
    </View>
  );

  const renderEmpty = () => {
    const isLiked = collectionMode === 'liked';
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        {renderHeader()}
        <IconSymbol
          name={isLiked ? 'heart.fill' : 'bookmark.fill'}
          size={56}
          color={isLiked ? '#FF3B55' : lightBrown}
        />
        <Text style={styles.emptyTitle}>
          {isLiked ? 'No liked posts yet' : 'No saved posts yet'}
        </Text>
        <Text style={styles.emptyHint}>
          {isLiked
            ? 'Tap the heart on any post to save it here.'
            : 'Tap the bookmark on any post to save it here.'}
        </Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: lightBrown }]}
          onPress={() => {
            haptics.light();
            router.push('/(market)/index' as any);
          }}>
          <IconSymbol name="house" size={18} color="#FFFFFF" />
          <Text style={styles.btnText}>Browse Market</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        {renderHeader()}
        <IconSymbol name="bookmark.slash.fill" size={52} color={lightBrown} />
        <Text style={styles.emptyTitle}>Sign in to view collections</Text>
        <Text style={styles.emptyHint}>Your saved and liked posts appear here.</Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: lightBrown }]}
          onPress={() => {
            haptics.light();
            router.push('/(auth)/market-login' as any);
          }}>
          <Text style={styles.btnText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (idsLoading || postsLoading) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        {renderHeader()}
        <ActivityIndicator
          size="large"
          color={collectionMode === 'liked' ? '#FF3B55' : lightBrown}
        />
      </View>
    );
  }

  if (idsError || error) {
    const displayError = idsError || error;
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <StatusBar barStyle="light-content" />
        {renderHeader()}
        <IconSymbol name="exclamationmark.triangle.fill" size={44} color={colors.error} />
        <Text style={styles.emptyTitle}>Could not load {collectionMode === 'liked' ? 'liked' : 'saved'} posts</Text>
        <Text style={styles.emptyHint}>{displayError?.message || 'Please try again'}</Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: lightBrown }]}
          onPress={() => {
            haptics.medium();
            void onRefresh();
          }}>
          <IconSymbol name="arrow.clockwise" size={18} color="#FFFFFF" />
          <Text style={styles.btnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (activeIds.length === 0 || visiblePosts.length === 0) {
    return renderEmpty();
  }

  return (
    <FeedSocialProvider followingIdSet={followingIdSet} savedIdSet={savedIdSet}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent />
        <VerticalClipFeed
          key={collectionMode}
          listRef={listRef}
          items={visiblePosts}
          renderItem={renderItem}
          onActiveIndexChange={handleActiveIndexChange}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
        {renderHeader()}
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
    minWidth: 40,
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#FFFFFF',
    marginTop: 16,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyHint: {
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  btn: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
