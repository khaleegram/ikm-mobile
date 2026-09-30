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
} from 'react-native';
import { Image } from 'expo-image';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { marketFeedApi } from '@/lib/api/market-feed';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useClipEngagement } from '@/lib/hooks/use-clip-engagement';
import { useIsFeedItemActive, useShouldMountMedia } from '@/lib/hooks/use-feed-active-post';
import { useFeedWatchSession } from '@/lib/hooks/use-feed-watch-session';
import { subscribeChatVoicePlaying } from '@/lib/chat/voice-player';
import { downloadMarketClip } from '@/lib/utils/download-market-clip';
import { getMarketPostPrimaryImage, isVideoMarketPost } from '@/lib/utils/market-media';
import { haptics } from '@/lib/utils/haptics';
import type { MarketPost } from '@/types';

import { MarketVideoSurface, type VideoPlaybackSnapshot } from './market-video-surface';
import { PostOverlay } from './post-overlay';
import { PostPhotoPager, PostPhotoStrip } from './post-photo-viewer';

const { width, height } = Dimensions.get('window');

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
  onMutedChange?: (muted: boolean) => void;
  onPatchItem?: (clipId: string, patch: Partial<MarketPost>) => void;
  onRemoveItem?: (clipId: string) => void;
  onComment?: () => void;
  onShare?: () => void;
  isPostSaved?: boolean;
  isPosterFollowed?: boolean;
}

export const FeedVideoItem = React.memo(function FeedVideoItem({
  post,
  itemHeight,
  index,
  isActive: isActiveProp,
  focused = true,
  muted = false,
  onMutedChange,
  onPatchItem,
  onComment,
  onShare,
  isPostSaved,
  isPosterFollowed,
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
  const playbackSnapshotRef = useRef<VideoPlaybackSnapshot>({
    currentTimeSec: 0,
    durationSec: 0,
  });
  const lastTapAtRef = useRef(0);
  const lastDoubleTapAtRef = useRef(0);

  const [showVideoPlayer, setShowVideoPlayer] = useState(mountMedia);

  useEffect(() => {
    if (mountMedia) {
      setShowVideoPlayer(true);
      return undefined;
    }
    // Pause first (feedActive drops with mountMedia), then release the native player.
    const timer = setTimeout(() => setShowVideoPlayer(false), 400);
    return () => clearTimeout(timer);
  }, [mountMedia]);

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
  const feedActive = Boolean(isActive && focused && appForeground && mountMedia);
  const shouldPlay = Boolean(feedActive && !isPaused && !chatVoicePlaying);
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

  const posterUri = getMarketPostPrimaryImage(post);

  // Which photo of a multi-photo post is showing. Reset when the card is recycled.
  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => {
    setPhotoIndex(0);
  }, [post.id]);

  const photoCount = post.images.length;
  const heroUri = post.images[Math.min(photoIndex, Math.max(0, photoCount - 1))] ?? posterUri;

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

  const handleMuteToggle = useCallback(() => {
    haptics.light();
    onMutedChange?.(!muted);
  }, [muted, onMutedChange]);

  return (
    <View style={[styles.container, { width, height: cardHeight }]}>
      {isVideo && post.videoUrl ? (
        <View style={styles.mediaStage}>
          <Pressable
            style={[styles.videoFrame, { height: computedVideoHeight }]}
            onPress={handleVideoPress}
            onLongPress={handleLongPress}
            delayLongPress={400}>
            {showVideoPlayer ? (
              <>
                <MarketVideoSurface
                  key={`${post.id}-video`}
                  active={feedActive}
                  paused={isPaused || chatVoicePlaying}
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
            {isPaused && showVideoPlayer && (
              <View style={styles.pauseOverlay} pointerEvents="none">
                <IconSymbol name="play.fill" size={56} color="rgba(255,255,255,0.92)" />
              </View>
            )}
            <HeartBurst visible={heartBurst} />
          </Pressable>
        </View>
      ) : heroUri ? (
        // One photo shown whole, swiped left and right, plus a strip to jump between them.
        <PostPhotoPager
          photos={post.images.length > 1 ? post.images : [heroUri]}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          width={width}
          height={cardHeight}
          postId={post.id}
          onLongPress={handleLongPress}
        />
      ) : (
        <View style={[styles.mediaPage, { height: cardHeight, backgroundColor: '#000' }]} />
      )}

      {!isVideo ? <HeartBurst visible={heartBurst} /> : null}

      <PostOverlay
        post={post}
        likes={engagement.likes}
        isLiked={engagement.liked}
        onLike={engagement.toggleLike}
        onComment={handleChat}
        onShare={handleShare}
        onFavorite={handleFavorite}
        muted={muted}
        onMuteToggle={isVideo ? handleMuteToggle : undefined}
        isPostSaved={isPostSaved}
        isPosterFollowed={isPosterFollowed}
        photoStrip={
          !isVideo && photoCount > 1 ? (
            <PostPhotoStrip
              photos={post.images}
              activeIndex={photoIndex}
              onSelect={setPhotoIndex}
            />
          ) : null
        }
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
  prev.onMutedChange === next.onMutedChange &&
  prev.index === next.index &&
  prev.isPostSaved === next.isPostSaved &&
  prev.isPosterFollowed === next.isPosterFollowed
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
