import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MarketVideoSurface } from '@/components/market/market-video-surface';
import { VideoCoverImage } from '@/components/market/video-cover-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getMarketPostVideoCover, isVideoMarketPost } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

const VIEWER_BG = '#000000';

type MediaSlide =
  | { kind: 'image'; uri: string }
  | { kind: 'video'; uri: string; thumbnail: string };

function buildMediaSlides(post: MarketPost): MediaSlide[] {
  if (isVideoMarketPost(post) && post.videoUrl) {
    const thumbnail = getMarketPostVideoCover(post);
    return [{ kind: 'video', uri: post.videoUrl, thumbnail }];
  }

  return (post.images ?? [])
    .map((uri) => String(uri || '').trim())
    .filter(Boolean)
    .map((uri) => ({ kind: 'image' as const, uri }));
}

interface SellerCardMediaViewerProps {
  post: MarketPost | null;
  initialMediaIndex?: number;
  visible: boolean;
  onClose: () => void;
  onBuyPress?: () => void;
  onAskPress?: () => void;
  accentColor?: string;
}

export function SellerCardMediaViewer({
  post,
  initialMediaIndex = 0,
  visible,
  onClose,
  onBuyPress,
  onAskPress,
  accentColor = '#A67C52',
}: SellerCardMediaViewerProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(initialMediaIndex);

  const slides = useMemo(() => (post ? buildMediaSlides(post) : []), [post]);
  const viewportHeight = Math.max(1, Math.round(windowHeight));
  const hasPrice = typeof post?.price === 'number' && (post?.price ?? 0) > 0;
  const showAsk = !hasPrice && Boolean(onAskPress);
  const showMessage = hasPrice && Boolean(onAskPress);
  const showActions = (hasPrice && onBuyPress) || showAsk || showMessage;

  useEffect(() => {
    if (!visible || !slides.length) return;
    const safeIndex = Math.min(Math.max(initialMediaIndex, 0), slides.length - 1);
    setActiveIndex(safeIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: safeIndex * viewportHeight, animated: false });
    });
  }, [visible, initialMediaIndex, slides.length, viewportHeight]);

  const onScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = Math.round(event.nativeEvent.contentOffset.y / viewportHeight);
      setActiveIndex(Math.min(Math.max(nextIndex, 0), Math.max(slides.length - 1, 0)));
    },
    [slides.length, viewportHeight]
  );

  if (!post) return null;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent />

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          pagingEnabled
          showsVerticalScrollIndicator={slides.length > 1}
          onMomentumScrollEnd={onScrollEnd}
          bounces={slides.length > 1}
          scrollEnabled={slides.length > 1}>
          {slides.map((slide, index) => (
            <View
              key={`${slide.kind}-${slide.uri}-${index}`}
              style={[styles.slide, { width: windowWidth, height: viewportHeight }]}>
              {slide.kind === 'video' ? (
                <View style={styles.mediaFrame}>
                  <VideoCoverImage
                    coverUri={slide.thumbnail}
                    videoUri={slide.uri}
                    style={StyleSheet.absoluteFillObject}
                  />
                  {index === activeIndex ? (
                    <MarketVideoSurface
                      active={visible && index === activeIndex}
                      videoUri={slide.uri}
                      style={StyleSheet.absoluteFillObject}
                    />
                  ) : (
                    <View style={styles.playOverlay}>
                      <View style={styles.playCircle}>
                        <IconSymbol name="play.rectangle.fill" size={28} color="#FFF" />
                      </View>
                    </View>
                  )}
                </View>
              ) : (
                <Image
                  source={{ uri: slide.uri }}
                  style={styles.fullImage}
                  contentFit="contain"
                  transition={150}
                />
              )}
            </View>
          ))}
        </ScrollView>

        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 8 }]}
          onPress={onClose}
          activeOpacity={0.8}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <IconSymbol name="chevron.left" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {showActions ? (
          <View style={[styles.actionBar, { paddingBottom: insets.bottom + 16 }]}>
            {hasPrice && onBuyPress ? (
              <TouchableOpacity
                style={[styles.actionPill, styles.actionPillSolid, { backgroundColor: accentColor }]}
                onPress={onBuyPress}
                activeOpacity={0.85}>
                <IconSymbol name="cart.fill" size={14} color="#FFF" />
                <Text style={styles.actionPillSolidText}>Buy</Text>
              </TouchableOpacity>
            ) : null}

            {showMessage && onAskPress ? (
              <TouchableOpacity
                style={[styles.actionPill, styles.actionPillOutline, { borderColor: accentColor }]}
                onPress={onAskPress}
                activeOpacity={0.85}>
                <Text style={[styles.actionPillOutlineText, { color: accentColor }]}>Message</Text>
              </TouchableOpacity>
            ) : null}

            {showAsk && onAskPress ? (
              <TouchableOpacity
                style={[styles.actionPill, styles.actionPillOutline, { borderColor: accentColor }]}
                onPress={onAskPress}
                activeOpacity={0.85}>
                <Text style={[styles.actionPillOutlineText, { color: accentColor }]}>Ask price</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VIEWER_BG,
  },
  scroll: {
    flex: 1,
    backgroundColor: VIEWER_BG,
  },
  slide: {
    backgroundColor: VIEWER_BG,
  },
  mediaFrame: {
    flex: 1,
    backgroundColor: VIEWER_BG,
  },
  fullImage: {
    width: '100%',
    height: '100%',
    backgroundColor: VIEWER_BG,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  closeBtn: {
    position: 'absolute',
    left: 12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  actionPill: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionPillSolid: {},
  actionPillOutline: {
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  actionPillSolidText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  actionPillOutlineText: {
    fontSize: 14,
    fontWeight: '800',
  },
});
