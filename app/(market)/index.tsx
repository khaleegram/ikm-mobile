import React, { useRef, useCallback } from 'react';
import {
  View,
  FlatList,
  Dimensions,
  RefreshControl,
  ActivityIndicator,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMarketPosts } from '@/lib/firebase/firestore/market-posts';
import { FeedCard } from '@/components/market/feed-card';
import { MarketPost } from '@/types';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';

const { height } = Dimensions.get('window');
const lightBrown = '#A67C52';

export default function MarketFeedScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { posts, loading, error, loadMore, hasMore, refresh } = useMarketPosts();
  const [refreshing, setRefreshing] = React.useState(false);
  const [viewportHeight, setViewportHeight] = React.useState(height);
  const flatListRef = useRef<FlatList>(null);

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

  const handleComment = useCallback((postId: string) => {
    router.push(`/(market)/post/${postId}` as any);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: MarketPost }) => (
      <FeedCard post={item} itemHeight={viewportHeight} onComment={() => handleComment(item.id!)} />
    ),
    [handleComment, viewportHeight]
  );

  const keyExtractor = useCallback((item: MarketPost) => item.id || Math.random().toString(), []);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: viewportHeight,
      offset: viewportHeight * index,
      index,
    }),
    [viewportHeight]
  );

  const renderHomeAppBar = () => (
    <View pointerEvents="box-none" style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerTopRow}>
        <View style={styles.brandIsland}>
          <View style={styles.brandLogoBadge}>
            <IconSymbol name="storefront.fill" size={14} color="#FFFFFF" />
          </View>
          <View style={styles.brandTextWrap}>
            <Text style={styles.headerLabel}>MARKET STREET</Text>
            <Text style={styles.headerTitle}>Home</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.searchButton}
          onPress={() => {
            haptics.light();
            router.push('/(market)/search');
          }}>
          <IconSymbol name="magnifyingglass" size={18} color="#FFFFFF" />
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
    <View
      style={[styles.container, { backgroundColor: '#000' }]}
      onLayout={(event) => {
        const nextHeight = Math.round(event.nativeEvent.layout.height);
        if (nextHeight > 0 && nextHeight !== viewportHeight) {
          setViewportHeight(nextHeight);
        }
      }}>
      <StatusBar barStyle="light-content" translucent />

      <FlatList
        ref={flatListRef}
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        pagingEnabled={true}
        snapToInterval={viewportHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
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
        removeClippedSubviews={true}
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
    gap: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIsland: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: lightBrown,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  brandLogoBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  brandTextWrap: {
    flex: 1,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  searchButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightBrown,
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
    height: height,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
