import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Dimensions,
  Pressable,
  StyleSheet,
  View,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { marketFeedApi } from '@/lib/api/market-feed';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useClipEngagement } from '@/lib/hooks/use-clip-engagement';
import { useIsFeedItemActive, useShouldMountMedia } from '@/lib/hooks/use-feed-active-post';
import { useFeedWatchSession } from '@/lib/hooks/use-feed-watch-session';
import { subscribeChatVoicePlaying } from '@/lib/chat/chat-audio';
import { downloadMarketClip } from '@/lib/utils/download-market-clip';
import { getMarketPostPrimaryImage, isVideoMarketPost } from '@/lib/utils/market-media';
import { haptics } from '@/lib/utils/haptics';
import type { MarketPost } from '@/types';

import { MarketVideoSurface, type VideoPlaybackSnapshot } from './market-video-surface';
import { PostOverlay } from './post-overlay';
import { useFeedVerticalScrollLock } from './vertical-clip-feed';

const { width, height } = Dimensions.get('window');

function CapsuleDot({ active }: { active: boolean }) {
  const scaleAnim = useRef(new Animated.Value(active ? 1 : 0.33)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: active ? 1 : 0.33,
      useNativeDriver: true,
      tension: 280,
      friction: 20,
    }).start();
  }, [active, scaleAnim]);
  return (
    <Animated.View
      style={[
        styles.capsuleDot,
        {
          transform: [{ scaleX: scaleAnim }],
          backgroundColor: active ? '#FFFFFF' : 'rgba(255,255,255,0.38)',
        },
      ]}
    />
  );
}

function HeartBurst({ visible }: { visible: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!visible) return;
    scale.setValue(0);
    opacity.setValue(1);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 200, friction: 10 }),
      Animated.timing(opacity, { toValue: 0, duration: 500, delay: 300, useNativeDriver: true }),
    ]).start();
  }, [visible, scale, opacity]);
  if (!visible) return null;
  return (
    <Animated.View
      style={[styles.heartBurst, { transform: [{ scale }], opacity }]}
      pointerEvents="none">
      <IconSymbol name="heart.fill" size={100} color="#FFFFFF" />
    </Animated.View>
  );
}

export interface FeedVideoItemProps {
  post: MarketPost;
  itemHeight?: number;
  index?: number;
  isActive?: boolean;
  focused?: boolean;
  muted?: boolean;
  onPatchItem?: (clipId: string, patch: Partial<MarketPost>) => void;
  onRemoveItem?: (clipId: string) => void;
  onComment?: () => void;
  onShare?: () => void;
}

export const FeedVideoItem = React.memo(function FeedVideoItem({
  post,
  itemHeight,
  index,
  isActive: isActiveProp,
  focused = true,
  muted = false,
  onPatchItem,
  onComment,
  onShare,
}: FeedVideoItemProps) {
  const { user } = useUser();
  const isActiveFromStore = useIsFeedItemActive(post.id);
  const mountMedia = useShouldMountMedia(index);
  const isActive = isActiveProp ?? isActiveFromStore;

  const [appForeground, setAppForeground] = useState(AppState.currentState === 'active');
  const [chatVoicePlaying, setChatVoicePlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showPoster, setShowPoster] = useState(true);
  const [heartBurst, setHeartBurst] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const scrollViewRef = useRef<GestureScrollView>(null);
  const playbackSnapshotRef = useRef<VideoPlaybackSnapshot>({
    currentTimeSec: 0,
    durationSec: 0,
  });
  const lastTapAtRef = useRef(0);
  const lastDoubleTapAtRef = useRef(0);
  const setVerticalScrollLocked = useFeedVerticalScrollLock();
  const galleryLockRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const engagement = useClipEngagement({ post, user, onPatchItem });

  useEffect(() => {
    const onChange = (state: AppStateStatus) => setAppForeground(state === 'active');
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  useEffect(() => subscribeChatVoicePlaying(setChatVoicePlaying), []);

  useEffect(() => {
    if (!isActive) {
      setIsPaused(false);
      setShowPoster(true);
    }
  }, [isActive, post.id]);

  const isVideo = isVideoMarketPost(post);
  const videoDurationSec = Number(post.videoMeta?.durationMs || 0) / 1000;
  const shouldPlay = Boolean(
    isActive && focused && appForeground && !isPaused && mountMedia && !chatVoicePlaying
  );
  const isTrackingActive = Boolean(post.id && shouldPlay);

  const getPlaybackPosition = useCallback(() => playbackSnapshotRef.current, []);

  useFeedWatchSession({
    postId: isVideo ? post.id : null,
    active: isVideo && isTrackingActive,
    mediaType: 'video',
    videoDurationSec,
    getPlaybackPosition,
  });

  useFeedWatchSession({
    postId: !isVideo ? post.id : null,
    active: !isVideo && Boolean(post.id && isActive && focused && appForeground),
    mediaType: 'image_gallery',
    videoDurationSec: 8,
  });

  const cardHeight = itemHeight ?? height;
  const aspectRatio =
    Number.isFinite(post.videoMeta?.aspectRatio) && Number(post.videoMeta?.aspectRatio) > 0
      ? Number(post.videoMeta?.aspectRatio)
      : undefined;
  const computedVideoHeight = aspectRatio
    ? Math.min(cardHeight, width / aspectRatio)
    : cardHeight;

  const handleVideoPress = useCallback(() => {
    if (!mountMedia) return;
    const now = Date.now();
    if (now - lastTapAtRef.current < 280) {
      lastTapAtRef.current = 0;
      lastDoubleTapAtRef.current = now;
      setHeartBurst(false);
      requestAnimationFrame(() => setHeartBurst(true));
      engagement.likeIfNeeded();
      return;
    }
    lastTapAtRef.current = now;
    setTimeout(() => {
      if (lastTapAtRef.current !== now) return;
      if (Date.now() - lastDoubleTapAtRef.current < 280) return;
      setIsPaused((p) => !p);
    }, 280);
  }, [engagement, mountMedia]);

  const handleLongPress = useCallback(() => {
    haptics.medium();
    void downloadMarketClip(post);
  }, [post]);

  const handleImageScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    setCurrentImageIndex(Math.round(contentOffsetX / width));
  }, []);

  const unlockVerticalScroll = useCallback(() => {
    if (!galleryLockRef.current) return;
    galleryLockRef.current = false;
    setVerticalScrollLocked(false);
  }, [setVerticalScrollLocked]);

  const lockVerticalScroll = useCallback(() => {
    if (galleryLockRef.current) return;
    galleryLockRef.current = true;
    setVerticalScrollLocked(true);
  }, [setVerticalScrollLocked]);

  const handleGalleryScrollBegin = useCallback(() => {
    lockVerticalScroll();
  }, [lockVerticalScroll]);

  /** Claim horizontal pans before the vertical FlatList steals them. */
  const handleGalleryTouchStart = useCallback((event: any) => {
    const touch = event?.nativeEvent?.touches?.[0] || event?.nativeEvent;
    touchStartRef.current = {
      x: Number(touch?.pageX || 0),
      y: Number(touch?.pageY || 0),
    };
  }, []);

  const handleGalleryTouchMove = useCallback(
    (event: any) => {
      if (galleryLockRef.current) return;
      const touch = event?.nativeEvent?.touches?.[0] || event?.nativeEvent;
      const dx = Math.abs(Number(touch?.pageX || 0) - touchStartRef.current.x);
      const dy = Math.abs(Number(touch?.pageY || 0) - touchStartRef.current.y);
      if (dx > 6 && dx > dy * 1.15) {
        lockVerticalScroll();
      }
    },
    [lockVerticalScroll]
  );

  const handleGalleryScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const velocityX = Number(event.nativeEvent.velocity?.x || 0);
      // Still coasting — unlock on momentum end instead.
      if (Math.abs(velocityX) > 0.05) return;
      unlockVerticalScroll();
    },
    [unlockVerticalScroll]
  );

  const handleGalleryMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleImageScroll(event);
      unlockVerticalScroll();
    },
    [handleImageScroll, unlockVerticalScroll]
  );

  useEffect(() => {
    return () => {
      if (galleryLockRef.current) {
        galleryLockRef.current = false;
        setVerticalScrollLocked(false);
      }
    };
  }, [setVerticalScrollLocked, post.id]);

  const imageRenderStart = Math.max(0, currentImageIndex - 1);
  const imageRenderEnd = Math.min(post.images.length - 1, currentImageIndex + 1);
  const posterUri = getMarketPostPrimaryImage(post);

  const handleChat = useCallback(() => {
    if (post.id && user?.uid) void marketFeedApi.logAction(post.id, 'chat');
    onComment?.();
  }, [onComment, post.id, user?.uid]);

  const handleFavorite = useCallback(() => {
    if (post.id && user?.uid) void marketFeedApi.logAction(post.id, 'favorite');
  }, [post.id, user?.uid]);

  const handleShare = useCallback(() => {
    void engagement.share();
    onShare?.();
  }, [engagement, onShare]);

  return (
    <View style={[styles.container, { width, height: cardHeight }]}>
      {isVideo && post.videoUrl ? (
        <View style={styles.mediaStage}>
          <Pressable
            style={[styles.videoFrame, { height: computedVideoHeight }]}
            onPress={handleVideoPress}
            onLongPress={handleLongPress}
            delayLongPress={400}>
            {mountMedia ? (
              <>
                <MarketVideoSurface
                  active={shouldPlay}
                  muted={muted || !appForeground || chatVoicePlaying}
                  videoUri={post.videoUrl}
                  onPlaybackSnapshot={(snapshot) => {
                    playbackSnapshotRef.current = snapshot;
                  }}
                  onFirstFrame={() => setShowPoster(false)}
                  contentFit="contain"
                />
                {showPoster && posterUri ? (
                  <View style={styles.posterOverlay} pointerEvents="none">
                    <Image
                      source={{ uri: posterUri }}
                      style={styles.mediaImage}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      recyclingKey={`poster-live-${post.id}`}
                    />
                    <ActivityIndicator style={styles.posterSpinner} color="#FFFFFF" />
                  </View>
                ) : null}
              </>
            ) : posterUri ? (
              <Image
                source={{ uri: posterUri }}
                style={styles.mediaImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={`poster-${post.id}`}
              />
            ) : (
              <View style={[styles.mediaImage, { backgroundColor: '#000' }]} />
            )}
            {isPaused && mountMedia && (
              <View style={styles.pauseOverlay}>
                <IconSymbol name="play.rectangle.fill" size={60} color="rgba(255,255,255,0.8)" />
              </View>
            )}
            <HeartBurst visible={heartBurst} />
          </Pressable>
        </View>
      ) : post.images.length > 1 ? (
        <View
          style={styles.imageScrollView}
          onTouchStart={handleGalleryTouchStart}
          onTouchMove={handleGalleryTouchMove}
          onTouchCancel={unlockVerticalScroll}>
          <GestureScrollView
            ref={scrollViewRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            directionalLockEnabled
            disableIntervalMomentum
            decelerationRate="fast"
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScrollBeginDrag={handleGalleryScrollBegin}
            onScrollEndDrag={handleGalleryScrollEndDrag}
            onMomentumScrollEnd={handleGalleryMomentumEnd}
            style={StyleSheet.absoluteFill}>
            {post.images.map((imageUri, imgIndex) => {
              if (imgIndex < imageRenderStart || imgIndex > imageRenderEnd) {
                return (
                  <View
                    key={`${post.id}-${imgIndex}`}
                    style={[styles.mediaPage, { height: cardHeight }]}
                  />
                );
              }
              return (
                <Pressable
                  key={`${post.id}-${imgIndex}`}
                  onLongPress={handleLongPress}
                  delayLongPress={400}
                  style={[styles.mediaPage, { height: cardHeight }]}>
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.mediaImage}
                    contentFit="contain"
                    transition={120}
                    placeholder={{ blurhash: 'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.' }}
                    cachePolicy="memory-disk"
                    recyclingKey={`${post.id}-${imgIndex}`}
                    priority={imgIndex === currentImageIndex ? 'high' : 'normal'}
                  />
                </Pressable>
              );
            })}
          </GestureScrollView>
        </View>
      ) : (
        <Pressable
          onLongPress={handleLongPress}
          delayLongPress={400}
          style={[styles.mediaPage, { height: cardHeight }]}>
          {posterUri ? (
            <Image
              source={{ uri: posterUri }}
              style={styles.mediaImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={`single-${post.id}`}
            />
          ) : (
            <View style={[styles.mediaImage, { backgroundColor: '#000' }]} />
          )}
        </Pressable>
      )}

      {!isVideo && post.images.length > 1 ? (
        <View style={styles.paginationContainer} pointerEvents="none">
          {post.images.map((_, imgIndex) => (
            <CapsuleDot key={imgIndex} active={imgIndex === currentImageIndex} />
          ))}
          <HeartBurst visible={heartBurst} />
        </View>
      ) : !isVideo ? (
        <HeartBurst visible={heartBurst} />
      ) : null}

      <PostOverlay
        post={post}
        likes={engagement.likes}
        isLiked={engagement.liked}
        onLike={engagement.toggleLike}
        onComment={handleChat}
        onShare={handleShare}
        onFavorite={handleFavorite}
      />
    </View>
  );
}, (prev, next) =>
  prev.post.id === next.post.id &&
  prev.itemHeight === next.itemHeight &&
  prev.post.likes === next.post.likes &&
  prev.post.comments === next.post.comments &&
  prev.post.likedBy?.length === next.post.likedBy?.length &&
  prev.post.images?.length === next.post.images?.length &&
  prev.post.videoUrl === next.post.videoUrl &&
  prev.isActive === next.isActive &&
  prev.focused === next.focused &&
  prev.muted === next.muted &&
  prev.index === next.index
);

const styles = StyleSheet.create({
  container: { position: 'relative', backgroundColor: '#000' },
  mediaStage: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaPage: {
    width,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  imageScrollView: { ...StyleSheet.absoluteFillObject },
  videoFrame: {
    width,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterSpinner: {
    position: 'absolute',
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  paginationContainer: {
    position: 'absolute',
    bottom: 130,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
  },
  capsuleDot: {
    width: 18,
    height: 6,
    borderRadius: 3,
  },
  heartBurst: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
