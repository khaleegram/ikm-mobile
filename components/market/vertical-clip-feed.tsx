import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';

import { FlashListCompat } from '@/components/layout/flash-list-compat';
import { buildMarketPostStableKey } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

const SNAP_TOLERANCE_PX = 2;
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

const FeedVerticalScrollLockContext = React.createContext<(locked: boolean) => void>(() => {});

/** Lock the parent vertical feed while swiping a photo gallery horizontally. */
export function useFeedVerticalScrollLock() {
  return React.useContext(FeedVerticalScrollLockContext);
}

export interface VerticalClipFeedProps {
  items: MarketPost[];
  renderItem: (info: { item: MarketPost; index: number; itemHeight: number }) => React.ReactElement | null;
  onActiveIndexChange: (index: number, item: MarketPost | null) => void;
  onEndReached?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  loadingMore?: boolean;
  onViewableIds?: (ids: string[]) => void;
  listRef?: React.MutableRefObject<any>;
}

/**
 * Full-screen vertical snap list for clip-style feeds.
 * Uses FlatList via FlashListCompat when paging (FlashList is unreliable for this).
 */
export function VerticalClipFeed({
  items,
  renderItem,
  onActiveIndexChange,
  onEndReached,
  onRefresh,
  refreshing = false,
  loadingMore = false,
  onViewableIds,
  listRef: externalListRef,
}: VerticalClipFeedProps) {
  const [pageHeight, setPageHeight] = React.useState(0);
  const [scrollEnabled, setScrollEnabled] = React.useState(true);
  const internalListRef = useRef<any>(null);
  const listRef = externalListRef || internalListRef;
  const isProgrammaticSnapRef = useRef(false);
  const activeIndexRef = useRef(0);
  const onActiveIndexChangeRef = useRef(onActiveIndexChange);
  onActiveIndexChangeRef.current = onActiveIndexChange;
  const onViewableIdsRef = useRef(onViewableIds);
  onViewableIdsRef.current = onViewableIds;

  const setVerticalScrollLocked = useCallback((locked: boolean) => {
    setScrollEnabled(!locked);
  }, []);

  const handleLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0 && Math.abs(next - pageHeight) > 1) {
      setPageHeight(next);
    }
  }, [pageHeight]);

  const settleToNearestPost = useCallback(
    (rawOffsetY: number, animated: boolean) => {
      const ref = listRef.current;
      if (!ref || items.length === 0 || pageHeight <= 0) return;
      const clampedOffset = Math.max(0, Number(rawOffsetY || 0));
      const nearestIndex = Math.max(0, Math.min(items.length - 1, Math.round(clampedOffset / pageHeight)));
      const targetOffset = nearestIndex * pageHeight;
      if (Math.abs(targetOffset - clampedOffset) <= SNAP_TOLERANCE_PX) return;
      if (typeof ref.scrollToOffset !== 'function') return;

      isProgrammaticSnapRef.current = true;
      ref.scrollToOffset({ offset: targetOffset, animated });
      setTimeout(() => {
        isProgrammaticSnapRef.current = false;
      }, 140);
    },
    [items.length, listRef, pageHeight]
  );

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (isProgrammaticSnapRef.current) return;
      settleToNearestPost(event.nativeEvent.contentOffset.y, true);
    },
    [settleToNearestPost]
  );

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (isProgrammaticSnapRef.current) return;
      const velocityY = Number(event.nativeEvent.velocity?.y || 0);
      if (Math.abs(velocityY) > 0.05) return;
      settleToNearestPost(event.nativeEvent.contentOffset.y, true);
    },
    [settleToNearestPost]
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems, changed }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      const first = viewableItems?.[0];
      const firstIndex = Number(first?.index ?? 0);
      const firstItem = (first?.item as MarketPost | undefined) || null;
      if (Number.isFinite(firstIndex)) {
        activeIndexRef.current = Math.max(0, firstIndex);
        onActiveIndexChangeRef.current(activeIndexRef.current, firstItem);
      }

      const newlySeen = (changed || [])
        .filter((entry) => entry.isViewable)
        .map((entry) => (entry.item as MarketPost | undefined)?.id)
        .filter((id): id is string => Boolean(id));
      if (newlySeen.length) onViewableIdsRef.current?.(newlySeen);
    }
  ).current;

  const keyExtractor = useCallback((item: MarketPost) => buildMarketPostStableKey(item), []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: pageHeight,
      offset: pageHeight * index,
      index,
    }),
    [pageHeight]
  );

  const listRenderItem = useCallback(
    ({ item, index }: { item: MarketPost; index: number }) =>
      renderItem({ item, index, itemHeight: pageHeight }),
    [pageHeight, renderItem]
  );

  return (
    <FeedVerticalScrollLockContext.Provider value={setVerticalScrollLocked}>
      <View style={styles.container} onLayout={handleLayout}>
        {pageHeight > 0 ? (
          <FlashListCompat
            key={`vertical-clip-feed-${pageHeight}`}
            ref={listRef}
            style={styles.list}
            data={items}
            renderItem={listRenderItem}
            keyExtractor={keyExtractor}
            estimatedItemSize={pageHeight}
            scrollEnabled={scrollEnabled}
            snapToInterval={pageHeight}
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
            viewabilityConfig={VIEWABILITY}
            onEndReached={onEndReached}
            onEndReachedThreshold={1.2}
            getItemLayout={getItemLayout}
            removeClippedSubviews={false}
            maxToRenderPerBatch={3}
            windowSize={5}
            initialNumToRender={2}
            updateCellsBatchingPeriod={50}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor="#FFFFFF"
                  colors={['#A67C52']}
                />
              ) : undefined
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : null
            }
          />
        ) : null}
      </View>
    </FeedVerticalScrollLockContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  list: {
    flex: 1,
  },
  footerLoader: {
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
