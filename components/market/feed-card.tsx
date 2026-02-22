import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  ScrollView,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { MarketPost } from '@/types';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostLikes } from '@/lib/firebase/firestore/market-posts';
import { marketPostsApi } from '@/lib/api/market-posts';
import { haptics } from '@/lib/utils/haptics';
import { PostOverlay } from './post-overlay';

const { width, height } = Dimensions.get('window');
const viewedPostIds = new Set<string>();
interface FeedCardProps {
  post: MarketPost;
  itemHeight?: number;
  onComment?: () => void;
  onShare?: () => void;
}

export const FeedCard = React.memo(function FeedCard({ post, itemHeight, onComment, onShare }: FeedCardProps) {
  const { user } = useUser();
  const { likes, isLiked } = useMarketPostLikes(post.id || null, user?.uid || null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const likeScaleAnim = useRef(new Animated.Value(1)).current;
  const [isLiking, setIsLiking] = useState(false);
  const cardHeight = itemHeight ?? height;

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
      {/* Image Gallery */}
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

      {/* Image Pagination Dots */}
      {post.images.length > 1 && (
        <View style={styles.paginationContainer}>
          {post.images.map((_, index) => (
            <View
              key={index}
              style={[
                styles.paginationDot,
                {
                  backgroundColor:
                    index === currentImageIndex
                      ? '#FFFFFF'
                      : 'rgba(255, 255, 255, 0.4)',
                },
              ]}
            />
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
    prevProps.post.likes === nextProps.post.likes &&
    prevProps.post.comments === nextProps.post.comments &&
    prevProps.post.images.length === nextProps.post.images.length
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
  paginationContainer: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
