import React, { useRef, useEffect, useCallback, useMemo } from 'react';
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
import { showToast } from '@/components/toast';

const { width, height } = Dimensions.get('window');
const lightBrown = '#A67C52';

export default function MarketFeedScreen() {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { posts, loading, error, loadMore, hasMore, refresh } = useMarketPosts();
  const [refreshing, setRefreshing] = React.useState(false);
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
      <FeedCard post={item} onComment={() => handleComment(item.id!)} />
    ),
    [handleComment]
  );

  const keyExtractor = useCallback((item: MarketPost) => item.id || Math.random().toString(), []);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: height,
      offset: height * index,
      index,
    }),
    []
  );

  if (loading && posts.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  if (error && posts.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" />
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
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No posts available
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <StatusBar barStyle="light-content" translucent />
      <FlatList
        ref={flatListRef}
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        pagingEnabled={true}
        snapToInterval={height}
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
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
