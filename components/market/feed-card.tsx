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
import { useMarketPostLikes } from '@/lib/firebase/firestore/market-posts';
import { marketPostsApi } from '@/lib/api/market-posts';
import { haptics } from '@/lib/utils/haptics';
import { isVideoMarketPost } from '@/lib/utils/market-media';
import { MarketVideoSurface } from './market-video-surface';
import { PostOverlay } from './post-overlay';

const { width, height } = Dimensions.get('window');
const viewedPostIds = new Set<string>();

function CapsuleDot({ active }: { active: boolean }) {
  const widthAnim = useRef(new Animated.Value(active ? 18 : 6)).current;

  useEffect(() => {
    Animated.spring(widthAnim, {
      toValue: active ? 18 : 6,
      useNativeDriver: false,
      tension: 280,
      friction: 20,
    }).start();
  }, [active, widthAnim]);

  return (
    <Animated.View
      style={[
        styles.capsuleDot,
        {
          width: widthAnim,
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
  onComment?: () => void;
  onShare?: () => void;
}

export const FeedCard = React.memo(function FeedCard({
  post,
  itemHeight,
  isActive = false,
  onComment,
  onShare,
}: FeedCardProps) {
  const { user } = useUser();
  const { likes, isLiked } = useMarketPostLikes(post.id || null, user?.uid || null);
  const isFocused = useIsFocused();
  const [isPaused, setIsPaused] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const likeScaleAnim = useRef(new Animated.Value(1)).current;
  const [isLiking, setIsLiking] = useState(false);
  const cardHeight = itemHeight ?? height;
  const isVideo = isVideoMarketPost(post);
  const aspectRatio =
    Number.isFinite(post.videoMeta?.aspectRatio) && Number(post.videoMeta?.aspectRatio) > 0
      ? Number(post.videoMeta?.aspectRatio)
      : undefined;
  const computedVideoHeight = aspectRatio
    ? Math.min(cardHeight, width / aspectRatio)
    : cardHeight;

  const handleLike = useCallback(async () => {
    if (!user) {
      return; // PostOverlay will handle login prompt
    }

    if (isLiking) return;

    setIsLiking(true);
    haptics.light();

    // Animate like button
    Animated.sequence([
      Animated.spring(likeScaleAnim, {
        toValue: 1.3,
        useNativeDriver: true,
        tension: 300,
        friction: 3,
      }),
      Animated.spring(likeScaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 300,
        friction: 3,
      }),
    ]).start();

    try {
      await marketPostsApi.like(post.id!);
    } catch (error: any) {
      console.error('Error liking post:', error);
      haptics.error();
    } finally {
      setIsLiking(false);
    }
  }, [user, post.id, isLiking, likeScaleAnim]);

  const handleComment = useCallback(() => {
    if (onComment) {
      onComment();
    } else {
      // PostOverlay will handle navigation
    }
  }, [onComment]);

  const handleShare = useCallback(() => {
    if (onShare) {
      onShare();
    }
  }, [onShare]);

  const handleImageScroll = useCallback((event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / width);
    setCurrentImageIndex(index);
  }, []);

  // Increment views when card is displayed (only once)
  React.useEffect(() => {
    if (!post.id) return;
    if (viewedPostIds.has(post.id)) return;

    const timer = setTimeout(() => {
      if (viewedPostIds.has(post.id!)) return;
      viewedPostIds.add(post.id!);
      marketPostsApi.incrementViews(post.id!).catch((error) => {
        // Silently fail for view increments
        console.warn('Failed to increment views:', error);
      });
    }, 1000); // Delay to avoid spamming on fast scrolling

    return () => clearTimeout(timer);
  }, [post.id]);

  return (
    <View style={[styles.container, { width, height: cardHeight }]}>
      {isVideo && post.videoUrl ? (
        <TouchableOpacity 
          activeOpacity={1}
          style={[styles.videoFrame, { height: computedVideoHeight }]}
          onPress={() => setIsPaused(!isPaused)}>
          <MarketVideoSurface
            active={isActive && isFocused && !isPaused}
            videoUri={post.videoUrl}
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
          {isPaused && (
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
          {post.images.map((imageUri, index) => (
            <Image
              key={`${post.id}-${index}`}
              source={{ uri: imageUri }}
              style={[styles.image, { height: cardHeight }]}
              contentFit="cover"
              transition={200}
              placeholder={{ blurhash: 'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.' }}
              cachePolicy="memory-disk"
              recyclingKey={`${post.id}-${index}`}
            />
          ))}
        </ScrollView>
      )}

      {/* Animated capsule pagination */}
      {!isVideo && post.images.length > 1 && (
        <View style={styles.paginationContainer}>
          {post.images.map((_, index) => (
            <CapsuleDot key={index} active={index === currentImageIndex} />
          ))}
        </View>
      )}

      {/* Post Overlay */}
      <PostOverlay
        post={post}
        likes={likes}
        isLiked={isLiked}
        onLike={handleLike}
        onComment={handleComment}
        onShare={handleShare}
        likeScaleAnim={likeScaleAnim}
      />
    </View>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memoization
  return (
    prevProps.post.id === nextProps.post.id &&
    prevProps.itemHeight === nextProps.itemHeight &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.post.likes === nextProps.post.likes &&
    prevProps.post.comments === nextProps.post.comments &&
    prevProps.post.images.length === nextProps.post.images.length &&
    prevProps.post.videoUrl === nextProps.post.videoUrl
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
    height: 6,
    borderRadius: 3,
  },
});
