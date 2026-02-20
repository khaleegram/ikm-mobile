import React, { useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { MarketPost } from '@/types';
import { usePublicUserProfile } from '@/lib/firebase/firestore/users';
import { useUser } from '@/lib/firebase/auth/use-user';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { haptics } from '@/lib/utils/haptics';

const { width, height } = Dimensions.get('window');
const lightBrown = '#A67C52';

interface PostOverlayProps {
  post: MarketPost;
  likes: number;
  isLiked: boolean;
  onLike: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onAskForPrice?: () => void;
  likeScaleAnim?: Animated.Value;
}

export function PostOverlay({
  post,
  likes,
  isLiked,
  onLike,
  onComment,
  onShare,
  onAskForPrice,
  likeScaleAnim,
}: PostOverlayProps) {
  const { user } = useUser();
  const { user: poster } = usePublicUserProfile(post.posterId);
  const defaultLikeScaleAnim = useRef(new Animated.Value(1)).current;
  const animValue = likeScaleAnim || defaultLikeScaleAnim;

  // Memoize poster name
  const posterName = useMemo(
    () => poster?.displayName || poster?.storeName || 'Seller',
    [poster?.displayName, poster?.storeName]
  );

  const handleAskForPrice = () => {
    if (onAskForPrice) {
      onAskForPrice();
      return;
    }

    if (!user) {
      Alert.alert('Login Required', 'Please log in to message sellers', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push('/(market)/profile') },
      ]);
      return;
    }

    haptics.medium();
    // Generate chatId: buyerId_posterId_postId
    const chatId = `${user.uid}_${post.posterId}_${post.id}`;
    router.push(`/(market)/messages/${chatId}` as any);
  };

  const handleComment = () => {
    haptics.medium();
    if (onComment) {
      onComment();
    } else {
      router.push(`/(market)/post/${post.id}` as any);
    }
  };

  const handleShare = () => {
    haptics.medium();
    if (onShare) {
      onShare();
    }
    // TODO: Implement share functionality
  };

  return (
    <>
      {/* Bottom Gradient Overlay */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.9)']}
        style={styles.bottomGradient}
      />

      {/* Product Info Overlay (Bottom-Left) */}
      <View style={styles.productInfoContainer}>
        {post.price && post.price > 0 ? (
          <Text style={styles.price}>₦{post.price.toLocaleString()}</Text>
        ) : (
          <AnimatedPressable
            style={styles.askForPriceButton}
            onPress={handleAskForPrice}
            scaleValue={0.95}>
            <Text style={styles.askForPriceText}>Ask for Price</Text>
          </AnimatedPressable>
        )}

        {post.description && (
          <Text style={styles.description} numberOfLines={2}>
            {post.description}
          </Text>
        )}

        <Text style={styles.sellerName}>{posterName}</Text>
      </View>

      {/* Action Buttons (Bottom-Right) */}
      <View style={styles.actionsContainer}>
        <AnimatedPressable
          style={[styles.actionButton, { transform: [{ scale: animValue }] }]}
          onPress={onLike}
          scaleValue={0.9}>
          <IconSymbol
            name={isLiked ? 'heart.fill' : 'heart'}
            size={28}
            color={isLiked ? '#FF3040' : '#FFFFFF'}
          />
          <Text style={styles.actionCount}>{likes}</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.actionButton}
          onPress={handleComment}
          scaleValue={0.9}>
          <IconSymbol name="message" size={28} color="#FFFFFF" />
          <Text style={styles.actionCount}>{post.comments || 0}</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.actionButton}
          onPress={handleShare}
          scaleValue={0.9}>
          <IconSymbol name="square.and.arrow.up" size={28} color="#FFFFFF" />
        </AnimatedPressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  productInfoContainer: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 100,
    zIndex: 10,
  },
  price: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  askForPriceButton: {
    backgroundColor: lightBrown,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  askForPriceText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  description: {
    fontSize: 15,
    color: '#FFFFFF',
    marginBottom: 6,
    fontWeight: '500',
  },
  sellerName: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '600',
  },
  actionsContainer: {
    position: 'absolute',
    bottom: 20,
    right: 16,
    alignItems: 'center',
    gap: 20,
    zIndex: 10,
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
  },
  actionCount: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
