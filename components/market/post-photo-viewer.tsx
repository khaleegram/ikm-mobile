import React, { memo, useEffect, useRef } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';

const THUMB_SIZE = 46;
const THUMB_GAP = 6;

type HeroProps = {
  uri: string;
  onLongPress?: () => void;
  recyclingKey?: string;
};

/**
 * One photo, shown whole.
 *
 * `contain` means the photo is never cropped, whatever its shape — a wide landscape photo gets
 * dark bands top and bottom, a tall portrait one fills the screen. The blurred copy behind fills
 * those bands so the frame looks deliberate instead of empty. No measuring, no grid.
 */
export const PostPhotoHero = memo(function PostPhotoHero({
  uri,
  onLongPress,
  recyclingKey,
}: HeroProps) {
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={400} style={styles.hero}>
      <Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        contentFit="cover"
        blurRadius={40}
        cachePolicy="memory-disk"
      />
      <View style={styles.scrim} pointerEvents="none" />
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        transition={140}
        cachePolicy="memory-disk"
        recyclingKey={recyclingKey}
      />
    </Pressable>
  );
});

type PagerProps = {
  photos: string[];
  /** Controlled: the photo the strip says is selected. */
  index: number;
  onIndexChange: (index: number) => void;
  width: number;
  height: number;
  postId?: string;
  onLongPress?: () => void;
};

/**
 * Swipe between a post's photos, left and right.
 *
 * The feed itself scrolls vertically, so this is a horizontal list — the two axes don't fight.
 * Pages are virtualised, which matters because each page draws a blurred backdrop and a post can
 * carry many photos. Scrolling reports back, so the thumbnail strip stays in step, and tapping a
 * thumbnail scrolls here.
 */
export const PostPhotoPager = memo(function PostPhotoPager({
  photos,
  index,
  onIndexChange,
  width,
  height,
  postId,
  onLongPress,
}: PagerProps) {
  const listRef = useRef<FlatList<string>>(null);
  // Tracks what the list is already showing, so a report from the scroll can be told apart from
  // a tap on the strip — otherwise the two would bounce off each other.
  const shown = useRef(index);

  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    listRef.current?.scrollToIndex({ index, animated: true });
  }, [index]);

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next === shown.current) return;
    shown.current = next;
    onIndexChange(next);
  };

  return (
    <FlatList
      ref={listRef}
      data={photos}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyExtractor={(uri, i) => `${i}-${uri}`}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      initialScrollIndex={index}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      windowSize={3}
      style={{ width, height }}
      onMomentumScrollEnd={handleMomentumEnd}
      renderItem={({ item, index: i }) => (
        <View style={{ width, height }}>
          <PostPhotoHero
            uri={item}
            onLongPress={onLongPress}
            recyclingKey={`hero-${postId ?? 'post'}-${i}`}
          />
        </View>
      )}
    />
  );
});

type StripProps = {
  photos: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
};

/**
 * The row of thumbnails that makes the other photos obvious.
 *
 * The selected photo is bright with a white edge; the rest are dimmed. Tapping one swaps the main
 * photo above.
 */
export const PostPhotoStrip = memo(function PostPhotoStrip({
  photos,
  activeIndex,
  onSelect,
}: StripProps) {
  if (photos.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.stripContent}
      style={styles.strip}>
      {photos.map((uri, index) => {
        const active = index === activeIndex;
        return (
          <Pressable
            key={`${index}-${uri}`}
            onPress={() => onSelect(index)}
            style={[styles.thumb, active && styles.thumbActive]}
            accessibilityRole="button"
            accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}>
            <Image
              source={{ uri }}
              style={styles.thumbImage}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={`thumb-${index}`}
            />
            {active ? null : <View style={styles.thumbDim} pointerEvents="none" />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },
  backdrop: {
    opacity: 0.32,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  strip: {
    marginBottom: 4,
  },
  stripContent: {
    gap: THUMB_GAP,
    paddingRight: 4,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  thumbActive: {
    borderColor: '#FFFFFF',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
