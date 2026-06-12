import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  ScrollView,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { useIsFocused } from '@react-navigation/native';
import { MarketPost } from '@/types';
import { useUser } from '@/lib/firebase/auth/use-user';
import { marketPostsApi } from '@/lib/api/market-posts';
import { haptics } from '@/lib/utils/haptics';
import { getMarketPostPrimaryImage, isVideoMarketPost } from '@/lib/utils/market-media';
import { useFeedWatchSession } from '@/lib/hooks/use-feed-watch-session';
import { useIsFeedItemActive, useShouldMountMedia } from '@/lib/hooks/use-feed-active-post';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { MarketVideoSurface, type VideoPlaybackSnapshot } from './market-video-surface';
import { PostOverlay } from './post-overlay';

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

interface FeedCardProps {
  post: MarketPost;
  itemHeight?: number;
  isActive?: boolean;
  index?: number;
  onComment?: () => void;
  onShare?: () => void;
}

export const FeedCard = React.memo(function FeedCard({
  post,
  itemHeight,
  isActive: isActiveProp,
  index,
  onComment,
  onShare,
}: FeedCardProps) {
  const { user } = useUser();
  const isActiveFromStore = useIsFeedItemActive(post.id);
  const shouldMountFromStore = useShouldMountMedia(index);
  const isActive = isActiveProp ?? isActiveFromStore;
  const shouldMountMedia = isActiveProp ?? shouldMountFromStore;
  const isFocused = useIsFocused();
  const [isPaused, setIsPaused] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const playbackSnapshotRef = useRef<VideoPlaybackSnapshot>({
    currentTimeSec: 0,
    durationSec: 0,
  });

  const isVideo = isVideoMarketPost(post);
  const videoDurationSec = Number(post.videoMeta?.durationMs || 0) / 1000;
  const isTrackingActive = Boolean(
    post.id && isActive && isFocused && !isPaused && shouldMountMedia
  );

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
    active: !isVideo && isTrackingActive,
    mediaType: 'image_gallery',
    videoDurationSec: 8,
  });

  const serverLikes = post.likes ?? 0;
  const serverIsLiked = user?.uid ? (post.likedBy ?? []).includes(user.uid) : false;
  const [optimisticLike, setOptimisticLike] = useState<{ isLiked: boolean; likes: number } | null>(null);

  const likes = optimisticLike?.likes ?? serverLikes;
  const isLiked = optimisticLike?.isLiked ?? serverIsLiked;

  const optimisticLikeRef = useRef(optimisticLike);
  optimisticLikeRef.current = optimisticLike;
  const lastServerLikedRef = useRef(serverIsLiked);
  const likeSyncingRef = useRef(false);
  const likeSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLikeTapAtRef = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;
  const postIdRef = useRef(post.id);
  postIdRef.current = post.id;

  const LIKE_TAP_COOLDOWN_MS = 450;
  const LIKE_SYNC_DELAY_MS = 400;

  useEffect(() => {
    lastServerLikedRef.current = serverIsLiked;
    if (
      optimisticLike &&
      optimisticLike.isLiked === serverIsLiked &&
      optimisticLike.likes === serverLikes
    ) {
      setOptimisticLike(null);
    }
  }, [serverIsLiked, serverLikes, optimisticLike]);

  const cardHeight = itemHeight ?? height;
  const aspectRatio =
    Number.isFinite(post.videoMeta?.aspectRatio) && Number(post.videoMeta?.aspectRatio) > 0
      ? Number(post.videoMeta?.aspectRatio)
      : undefined;
  const computedVideoHeight = aspectRatio
    ? Math.min(cardHeight, width / aspectRatio)
    : cardHeight;

  const syncLikeToServer = useCallback(async () => {
    const postId = postIdRef.current;
    if (!postId || likeSyncingRef.current) return;

    const desired = optimisticLikeRef.current?.isLiked ?? lastServerLikedRef.current;
    if (desired === lastServerLikedRef.current) return;

    likeSyncingRef.current = true;
    try {
      const result = await marketPostsApi.like(postId);
      lastServerLikedRef.current = result.isLiked;
      const next = { isLiked: result.isLiked, likes: result.likes };
      optimisticLikeRef.current = next;
      setOptimisticLike(next);
    } catch (error: any) {
      console.error('Error liking post:', error);
      optimisticLikeRef.current = null;
      setOptimisticLike(null);
      haptics.error();
    } finally {
      likeSyncingRef.current = false;
    }
  }, []);

  const handleLike = useCallback(() => {
    if (!userRef.current) return;

    const now = Date.now();
    if (now - lastLikeTapAtRef.current < LIKE_TAP_COOLDOWN_MS) return;
    if (likeSyncingRef.current) return;

    lastLikeTapAtRef.current = now;

    const current = optimisticLikeRef.current ?? {
      isLiked: lastServerLikedRef.current,
      likes: serverLikes,
    };
    const nextLiked = !current.isLiked;
    const nextLikes = Math.max(0, current.likes + (nextLiked ? 1 : -1));
    const next = { isLiked: nextLiked, likes: nextLikes };
    optimisticLikeRef.current = next;
    setOptimisticLike(next);
    haptics.light();

    if (likeSyncTimerRef.current) clearTimeout(likeSyncTimerRef.current);
    likeSyncTimerRef.current = setTimeout(() => {
      likeSyncTimerRef.current = null;
      syncLikeToServer();
    }, LIKE_SYNC_DELAY_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncLikeToServer, serverLikes]);

  useEffect(() => {
    return () => {
      if (likeSyncTimerRef.current) clearTimeout(likeSyncTimerRef.current);
    };
  }, []);

  const handleComment = useCallback(() => {
    onComment?.();
  }, [onComment]);

  const handleShare = useCallback(() => {
    onShare?.();
  }, [onShare]);

  const handleImageScroll = useCallback((event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / width);
    setCurrentImageIndex(index);
  }, []);

  const imageRenderStart = Math.max(0, currentImageIndex - 1);
  const imageRenderEnd = Math.min(post.images.length - 1, currentImageIndex + 1);
  const posterUri = getMarketPostPrimaryImage(post);

  return (
    <View style={[styles.container, { width, height: cardHeight }]}>
      {isVideo && post.videoUrl ? (
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.videoFrame, { height: computedVideoHeight }]}
          onPress={() => shouldMountMedia && setIsPaused(!isPaused)}>
          {shouldMountMedia ? (
            <MarketVideoSurface
              active={isActive && isFocused && !isPaused}
              videoUri={post.videoUrl}
              onPlaybackSnapshot={(snapshot) => {
                playbackSnapshotRef.current = snapshot;
              }}
              externalSoundUri={
                post.soundMeta?.sourceType === 'original'
                  ? undefined
                  : post.soundMeta?.sourceUri
                    ? post.soundMeta.sourceUri
                    : undefined
              }
              externalSoundVolume={post.soundMeta?.soundVolume}
              originalAudioVolume={post.soundMeta?.originalAudioVolume}
              soundStartMs={post.soundMeta?.startMs}
              useOriginalVideoAudio={post.soundMeta?.useOriginalVideoAudio !== false}
            />
          ) : posterUri ? (
            <Image
              source={{ uri: posterUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={`poster-${post.id}`}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
          )}
          {isPaused && shouldMountMedia && (
            <View style={styles.pauseOverlay}>
              <IconSymbol name="play.rectangle.fill" size={60} color="rgba(255,255,255,0.8)" />
            </View>
          )}
        </TouchableOpacity>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleImageScroll}
          style={styles.imageScrollView}>
          {post.images.map((imageUri, index) => {
            if (index < imageRenderStart || index > imageRenderEnd) {
              return (
                <View
                  key={`${post.id}-${index}`}
                  style={[styles.image, { height: cardHeight, backgroundColor: '#111' }]}
                />
              );
            }
            return (
              <Image
                key={`${post.id}-${index}`}
                source={{ uri: imageUri }}
                style={[styles.image, { height: cardHeight }]}
                contentFit="cover"
                transition={120}
                placeholder={{ blurhash: 'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.' }}
                cachePolicy="memory-disk"
                recyclingKey={`${post.id}-${index}`}
                priority={index === currentImageIndex ? 'high' : 'normal'}
              />
            );
          })}
        </ScrollView>
      )}

      {!isVideo && post.images.length > 1 && (
        <View style={styles.paginationContainer}>
          {post.images.map((_, index) => (
            <CapsuleDot key={index} active={index === currentImageIndex} />
          ))}
        </View>
      )}

      <PostOverlay
        post={post}
        likes={likes}
        isLiked={isLiked}
        onLike={handleLike}
        onComment={handleComment}
        onShare={handleShare}
      />
    </View>
  );
}, (prevProps, nextProps) => {
  const prevLiked =
    prevProps.post.likedBy?.length ?? 0;
  const nextLiked =
    nextProps.post.likedBy?.length ?? 0;

  return (
    prevProps.post.id === nextProps.post.id &&
    prevProps.itemHeight === nextProps.itemHeight &&
    prevProps.post.likes === nextProps.post.likes &&
    prevProps.post.comments === nextProps.post.comments &&
    prevProps.post.images.length === nextProps.post.images.length &&
    prevProps.post.videoUrl === nextProps.post.videoUrl &&
    prevLiked === nextLiked
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: '#000',
  },
  imageScrollView: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    width,
    resizeMode: 'cover',
  },
  videoFrame: {
    width,
    maxHeight: height,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
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
});
