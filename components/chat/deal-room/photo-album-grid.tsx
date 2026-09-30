import React, { memo } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { AnimatedPressable } from '@/components/animated-pressable';
import { SafeImage } from '@/components/safe-image';

/** Hairline gap between tiles, the way WhatsApp separates an album. */
const GAP = 2;
const DEFAULT_WIDTH = 208;
/** Beyond four photos the rest collapse behind a "+N" badge on the last tile. */
const MAX_TILES = 4;

type PhotoAlbumGridProps = {
  photos: string[];
  /** Total grid width in dp. Height is derived from the layout so the block stays compact. */
  width?: number;
  onPressPhoto?: (index: number) => void;
};

/**
 * A compact album grid for photos sent together in one message.
 *
 * WhatsApp-style scaling, not a fixed square per photo:
 *   2 photos → two squares side by side
 *   3 photos → one tall tile on the left, two stacked on the right
 *   4+ photos → 2×2, with a "+N" badge over the last tile
 *
 * Heights work out so the whole block is at most as tall as it is wide (2 photos are half
 * that), which is what stops an album from taking over the screen the way one big photo did.
 */
export const PhotoAlbumGrid = memo(function PhotoAlbumGrid({
  photos,
  width = DEFAULT_WIDTH,
  onPressPhoto,
}: PhotoAlbumGridProps) {
  const count = photos.length;
  const tile = Math.floor((width - GAP) / 2);
  const stackHeight = tile * 2 + GAP;
  const tileStyle: ViewStyle = { width: tile, height: tile };
  const hiddenCount = Math.max(0, count - MAX_TILES);

  const renderTile = (index: number, style: ViewStyle | ViewStyle[], badge?: number) => {
    const content = (
      <>
        <SafeImage uri={photos[index]} style={styles.image} />
        {badge && badge > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{`+${badge}`}</Text>
          </View>
        ) : null}
      </>
    );

    if (!onPressPhoto) {
      return (
        <View key={`${index}-${photos[index]}`} style={style}>
          {content}
        </View>
      );
    }

    return (
      <AnimatedPressable
        key={`${index}-${photos[index]}`}
        onPress={() => onPressPhoto(index)}
        scaleValue={0.97}
        style={style}
        accessibilityRole="button"
        accessibilityLabel={`Photo ${index + 1} of ${count}`}>
        {content}
      </AnimatedPressable>
    );
  };

  let body: React.ReactNode;

  if (count === 2) {
    body = (
      <View style={styles.row}>
        {renderTile(0, tileStyle)}
        {renderTile(1, tileStyle)}
      </View>
    );
  } else if (count === 3) {
    body = (
      <View style={styles.row}>
        {renderTile(0, { width: tile, height: stackHeight })}
        <View style={styles.column}>
          {renderTile(1, tileStyle)}
          {renderTile(2, tileStyle)}
        </View>
      </View>
    );
  } else {
    // 4 or more — a 2×2 with the remainder counted on the last tile.
    body = (
      <View style={styles.column}>
        <View style={styles.row}>
          {renderTile(0, tileStyle)}
          {renderTile(1, tileStyle)}
        </View>
        <View style={styles.row}>
          {renderTile(2, tileStyle)}
          {renderTile(3, tileStyle, hiddenCount)}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.grid, { width, borderRadius: 9 }]}>
      {body}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: {
    overflow: 'hidden',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
  },
  column: {
    gap: GAP,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.55)',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
});
