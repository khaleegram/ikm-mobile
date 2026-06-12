import React, { useMemo } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { VideoCoverImage } from '@/components/market/video-cover-image';
import { formatPostCaption } from '@/lib/utils/post-caption';
import { getMarketPostVideoCover, isVideoMarketPost } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PAD = 20;
const CARD_WIDTH = SCREEN_WIDTH - H_PAD * 2;
const MEDIA_INSET = 10;
const GRID_GAP = 6;
const GRID_INNER_WIDTH = CARD_WIDTH - MEDIA_INSET * 2;
const SINGLE_MEDIA_HEIGHT = Math.min(GRID_INNER_WIDTH * 0.72, 200);

function getCardImageUrls(post: MarketPost): string[] {
  if (isVideoMarketPost(post)) {
    const cover = getMarketPostVideoCover(post);
    return cover ? [cover] : [];
  }
  return (post.images ?? []).map((uri) => String(uri || '').trim()).filter(Boolean);
}

interface SellerBroadcastCardProps {
  post: MarketPost;
  sellerAvatarUri?: string | null;
  isLive?: boolean;
  bubbleColor: string;
  borderColor: string;
  mediaFallbackColor: string;
  textColor: string;
  textSecondary: string;
  accentColor: string;
  onPress: (mediaIndex: number) => void;
  onBuyPress?: () => void;
  onAskPress?: () => void;
}

export function SellerBroadcastCard({
  post,
  sellerAvatarUri,
  isLive = false,
  bubbleColor,
  borderColor,
  mediaFallbackColor,
  textColor,
  textSecondary,
  accentColor,
  onPress,
  onBuyPress,
  onAskPress,
}: SellerBroadcastCardProps) {
  const isVideo = isVideoMarketPost(post);
  const imageUrls = useMemo(() => getCardImageUrls(post), [post]);
  const caption = useMemo(() => formatPostCaption(post.description), [post.description]);
  const hasPrice = typeof post.price === 'number' && post.price > 0;
  const showAsk = !hasPrice && Boolean(onAskPress);
  const hasMedia = imageUrls.length > 0 || isVideo;
  const showActions = (hasPrice && onBuyPress) || (showAsk && onAskPress);

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: bubbleColor,
            width: CARD_WIDTH,
          },
        ]}>
        <View style={styles.sellerRow}>
          {sellerAvatarUri ? (
            <Image
              source={{ uri: sellerAvatarUri }}
              style={[styles.avatarImage, { borderColor }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: mediaFallbackColor, borderColor }]}>
              <IconSymbol name="person.fill" size={16} color={textSecondary} />
            </View>
          )}
          {isLive ? <View style={styles.liveDot} /> : null}
        </View>

        {caption ? (
          <View style={styles.captionWrap}>
            <Text style={[styles.caption, { color: textColor }]} numberOfLines={hasMedia ? 3 : undefined}>
              {caption}
            </Text>
          </View>
        ) : null}

        {hasMedia ? (
          <View style={styles.mediaWrap}>
            <MediaGrid
              post={post}
              urls={imageUrls}
              isVideo={isVideo}
              totalImageCount={isVideo ? 0 : (post.images?.length ?? 0)}
              mediaFallbackColor={mediaFallbackColor}
              onPress={onPress}
            />
          </View>
        ) : null}

        {showActions ? (
          <View style={styles.cardBody}>
            <View style={styles.actionRow}>
              {hasPrice && onBuyPress ? (
                <TouchableOpacity
                  style={[styles.pill, styles.pillSolid, { backgroundColor: accentColor }]}
                  onPress={onBuyPress}
                  activeOpacity={0.82}>
                  <IconSymbol name="cart.fill" size={10} color="#FFF" />
                  <Text style={styles.pillSolidText}>Buy</Text>
                </TouchableOpacity>
              ) : null}

              {showAsk && onAskPress ? (
                <TouchableOpacity
                  style={[styles.pill, { borderColor: accentColor, borderWidth: 1.5 }]}
                  onPress={onAskPress}
                  activeOpacity={0.85}>
                  <Text style={[styles.pillText, { color: accentColor }]}>Ask price</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MediaGrid({
  post,
  urls,
  isVideo,
  totalImageCount,
  mediaFallbackColor,
  onPress,
}: {
  post: MarketPost;
  urls: string[];
  isVideo: boolean;
  totalImageCount: number;
  mediaFallbackColor: string;
  onPress: (mediaIndex: number) => void;
}) {
  const videoUri = String(post.videoUrl || '').trim() || undefined;
  const coverUri = isVideo ? getMarketPostVideoCover(post) : undefined;

  if (isVideo) {
    return (
      <TouchableOpacity activeOpacity={0.92} onPress={() => onPress(0)} accessibilityRole="button">
        <VideoCoverImage
          coverUri={coverUri || urls[0]}
          videoUri={videoUri}
          style={[styles.singleMedia, { backgroundColor: mediaFallbackColor }]}>
          <View style={styles.playOverlay}>
            <View style={styles.playCircle}>
              <IconSymbol name="play.rectangle.fill" size={18} color="#FFF" />
            </View>
          </View>
        </VideoCoverImage>
      </TouchableOpacity>
    );
  }

  if (urls.length === 0) {
    return null;
  }

  if (urls.length === 1) {
    return (
      <TouchableOpacity activeOpacity={0.92} onPress={() => onPress(0)} accessibilityRole="button">
        <View style={[styles.singleMedia, { backgroundColor: mediaFallbackColor }]}>
          <Image
            source={{ uri: urls[0] }}
            style={styles.singleMediaImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            placeholder={{ blurhash: 'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.' }}
          />
        </View>
      </TouchableOpacity>
    );
  }

  const visible = urls.slice(0, 4);
  const extraCount = Math.max(0, totalImageCount - 4);
  const cellSize = (GRID_INNER_WIDTH - GRID_GAP) / 2;

  return (
    <View style={styles.grid}>
      {visible.map((uri, index) => {
        const isLast = index === visible.length - 1;
        const showMore = isLast && extraCount > 0;

        return (
          <TouchableOpacity
            key={`${uri}-${index}`}
            activeOpacity={0.92}
            onPress={() => onPress(index)}
            accessibilityRole="button">
            <View
              style={[
                styles.gridCell,
                { width: cellSize, height: cellSize, backgroundColor: mediaFallbackColor },
              ]}>
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={120}
                placeholder={{ blurhash: 'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.' }}
              />
              {showMore ? (
                <View style={styles.moreOverlay}>
                  <Text style={styles.moreOverlayText}>+{extraCount}</Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: H_PAD,
    marginBottom: 10,
    alignItems: 'center',
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  avatarImage: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    flexShrink: 0,
  },
  captionWrap: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  caption: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
  },
  mediaWrap: {
    paddingHorizontal: MEDIA_INSET,
    paddingBottom: MEDIA_INSET,
  },
  singleMedia: {
    width: GRID_INNER_WIDTH,
    height: SINGLE_MEDIA_HEIGHT,
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
  },
  singleMediaImage: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  playCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  grid: {
    width: GRID_INNER_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  gridCell: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 10,
  },
  moreOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreOverlayText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  cardBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillSolid: {
    paddingHorizontal: 14,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pillSolidText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
});
