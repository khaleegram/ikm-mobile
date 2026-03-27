import React, { useMemo, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedPressable } from '@/components/animated-pressable';
import { PostManageSheet } from '@/components/market/post-manage-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { buildDirectConversationId, marketMessagesApi } from '@/lib/api/market-messages';
import { marketPostsApi } from '@/lib/api/market-posts';
import { marketSocialApi } from '@/lib/api/market-social';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useIsFollowing } from '@/lib/firebase/firestore/market-social';
import { usePublicUserProfile } from '@/lib/firebase/firestore/users';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { getMarketPostPrimaryImage } from '@/lib/utils/market-media';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import { MarketPost } from '@/types';

const lightBrown = '#A67C52';
const MARKET_TAB_BAR_CLEARANCE = 92;

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
  const insets = useSafeAreaInsets();
  const { user: poster } = usePublicUserProfile(post.posterId);
  const defaultLikeScaleAnim = useRef(new Animated.Value(1)).current;
  const animValue = likeScaleAnim || defaultLikeScaleAnim;
  const isOwnPost = user?.uid === post.posterId;
  const marketLoginRoute = getLoginRouteForVariant('market');
  const [manageVisible, setManageVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const openingChatRef = useRef(false);
  const { isFollowing } = useIsFollowing(user?.uid || null, post.posterId || null);
  const overlayBottomOffset = useMemo(
    () => MARKET_TAB_BAR_CLEARANCE + Math.max(insets.bottom, 8),
    [insets.bottom]
  );

  const posterName = useMemo(
    () => poster?.displayName || poster?.storeName || 'Seller',
    [poster?.displayName, poster?.storeName]
  );

  const openChatFromPost = async (mode: 'ask-price' | 'dm') => {
    if (onAskForPrice) {
      onAskForPrice();
      return;
    }

    if (!user) {
      Alert.alert('Login Required', 'Please log in to message sellers', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }

    if (!post.id || !post.posterId) {
      showToast('Unable to start chat for this post', 'error');
      return;
    }

    if (openingChatRef.current) return;
    openingChatRef.current = true;

    const chatId = buildDirectConversationId(user.uid, post.posterId);
    const hasPrice = typeof post.price === 'number' && post.price > 0;
    const locationText = [post.location?.city, post.location?.state].filter(Boolean).join(', ');
    const quotePreview = hasPrice
      ? `Post preview - NGN ${Number(post.price).toLocaleString()}${locationText ? ` - ${locationText}` : ''}`
      : `Post preview${locationText ? ` - ${locationText}` : ''}`;
    const autoText =
      mode === 'ask-price'
        ? `Hi ${posterName}, ask for price: please share your best price for this item.`
        : `Hi ${posterName}, I am interested in this post.`;

    try {
      haptics.medium();
      router.push(`/(market)/messages/${chatId}?peerId=${encodeURIComponent(post.posterId)}` as any);
    } catch (navigationError: any) {
      openingChatRef.current = false;
      haptics.error();
      showToast(navigationError?.message || 'Failed to open chat', 'error');
      return;
    }

    void (async () => {
      try {
        await marketMessagesApi.sendQuoteMessage(
          chatId,
          {
            postId: post.id,
            previewText: quotePreview,
            previewImage: getMarketPostPrimaryImage(post) || undefined,
          },
          autoText
        );
      } catch (sendError: any) {
        console.error('Error sending intro message:', sendError);
      } finally {
        openingChatRef.current = false;
      }
    })();
  };

  const handleAskForPrice = async () => {
    await openChatFromPost('ask-price');
  };

  const handleDirectMessage = async () => {
    await openChatFromPost('dm');
  };

  const handleBuyNow = () => {
    if (!post.id) {
      showToast('Unable to open this post for checkout.', 'error');
      return;
    }

    if (!user) {
      Alert.alert('Login Required', 'Please sign in to buy this item.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }

    haptics.medium();
    router.push(`/(market)/buy/${post.id}` as any);
  };

  const handleComment = () => {
    haptics.medium();
    if (onComment) {
      onComment();
    } else {
      router.push(`/(market)/post/${post.id}` as any);
    }
  };

  const handleShare = async () => {
    haptics.medium();
    if (onShare && !isOwnPost) {
      onShare();
      return;
    }

    try {
      await shareMarketPost(post);
    } catch {
      showToast('Unable to open share options right now.', 'error');
    }
  };

  const handleMoreActions = () => {
    if (isOwnPost) {
      openManageSheet();
      return;
    }

    Alert.alert(posterName, 'Choose an action', [
      {
        text: 'Share',
        onPress: () => void handleShare(),
      },
      {
        text: isFollowing ? 'Unfollow' : 'Follow',
        onPress: async () => {
          try {
            if (!user) {
              Alert.alert('Login Required', 'Please log in to follow sellers', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
              ]);
              return;
            }
            haptics.light();
            await marketSocialApi.toggleFollowUser(post.posterId, isFollowing);
            showToast(isFollowing ? 'Unfollowed.' : 'Following.', 'success');
          } catch (error: any) {
            showToast(error?.message || 'Unable to update following.', 'error');
          }
        },
      },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          if (!user) {
            Alert.alert('Login Required', 'Please log in to block users', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
            ]);
            return;
          }
          Alert.alert('Block user?', `You won't see ${posterName}'s posts or messages.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Block',
              style: 'destructive',
              onPress: async () => {
                try {
                  haptics.medium();
                  await marketSocialApi.blockUser(post.posterId);
                  showToast('User blocked.', 'success');
                } catch (error: any) {
                  showToast(error?.message || 'Unable to block user.', 'error');
                }
              },
            },
          ]);
        },
      },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          if (!user) {
            Alert.alert('Login Required', 'Please log in to report content', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
            ]);
            return;
          }
          try {
            haptics.light();
            await marketSocialApi.report({
              targetType: 'post',
              targetId: String(post.id || ''),
              reason: 'spam_or_scam',
              details: `Reported from feed. Poster: ${post.posterId}`,
            });
            showToast('Report submitted.', 'success');
          } catch (error: any) {
            showToast(error?.message || 'Unable to submit report.', 'error');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleEditPost = () => {
    if (!post.id) {
      showToast('Unable to edit this post.', 'error');
      return;
    }
    haptics.light();
    setManageVisible(false);
    router.push(`/(market)/post-edit/${post.id}` as any);
  };

  const handleDeletePost = () => {
    if (!post.id || isDeleting) {
      return;
    }

    Alert.alert('Delete Post', 'This will permanently remove this post from Market Street.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsDeleting(true);
            await marketPostsApi.delete(post.id!);
            haptics.success();
            showToast('Post deleted successfully.', 'success');
          } catch (error: any) {
            haptics.error();
            showToast(error?.message || 'Failed to delete post.', 'error');
          } finally {
            setIsDeleting(false);
            setManageVisible(false);
          }
        },
      },
    ]);
  };

  const openManageSheet = () => {
    haptics.light();
    setManageVisible(true);
  };

  return (
    <>
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.9)']}
        style={[styles.bottomGradient, { height: overlayBottomOffset + 180 }]}
      />

      <View style={[styles.productInfoContainer, { bottom: overlayBottomOffset }]}>
        {post.price && post.price > 0 ? (
          <View style={styles.priceRow}>
            <Text style={styles.price}>NGN {post.price.toLocaleString()}</Text>
            {!isOwnPost && (
              <View style={styles.priceActionsRow}>
                {post.isNegotiable ? (
                  <AnimatedPressable
                    style={[styles.buyNowButton, styles.dmButton]}
                    onPress={handleDirectMessage}
                    scaleValue={0.95}>
                    <IconSymbol name="message" size={14} color="#FFFFFF" />
                    <Text style={styles.buyNowText}>DM</Text>
                  </AnimatedPressable>
                ) : null}
                <AnimatedPressable style={styles.buyNowButton} onPress={handleBuyNow} scaleValue={0.95}>
                  <IconSymbol name="bag.fill" size={14} color="#FFFFFF" />
                  <Text style={styles.buyNowText}>Buy</Text>
                </AnimatedPressable>
              </View>
            )}
          </View>
        ) : (
          <AnimatedPressable style={styles.askForPriceButton} onPress={handleAskForPrice} scaleValue={0.95}>
            <Text style={styles.askForPriceText}>Ask for Price</Text>
          </AnimatedPressable>
        )}

        {post.description && (
          <Text style={styles.description} numberOfLines={2}>
            {post.description}
          </Text>
        )}

        {post.soundMeta?.soundId && post.soundMeta?.title ? (
          <AnimatedPressable
            style={styles.soundPill}
            onPress={() => router.push(`/(market)/sound/${post.soundMeta?.soundId}` as any)}
            scaleValue={0.96}>
            <IconSymbol name="music.note" size={14} color="#FFFFFF" />
            <Text style={styles.soundPillText} numberOfLines={1}>
              {post.soundMeta.title}
            </Text>
          </AnimatedPressable>
        ) : null}

        <Text style={styles.sellerName}>{posterName}</Text>
      </View>

      <View style={[styles.actionsContainer, { bottom: overlayBottomOffset }]}>
        <AnimatedPressable
          style={[styles.actionButton, { transform: [{ scale: animValue }] }]}
          onPress={onLike}
          scaleValue={0.9}>
          <IconSymbol name={isLiked ? 'heart.fill' : 'heart'} size={28} color={isLiked ? '#FF3040' : '#FFFFFF'} />
          <Text style={styles.actionCount}>{likes}</Text>
        </AnimatedPressable>

        <AnimatedPressable style={styles.actionButton} onPress={handleComment} scaleValue={0.9}>
          <IconSymbol name="message" size={28} color="#FFFFFF" />
          <Text style={styles.actionCount}>{post.comments || 0}</Text>
        </AnimatedPressable>

        <AnimatedPressable style={styles.actionButton} onPress={handleMoreActions} scaleValue={0.9}>
          <IconSymbol
            name={isOwnPost ? 'ellipsis' : 'ellipsis'}
            size={28}
            color="#FFFFFF"
          />
          <Text style={styles.actionCount}>{isOwnPost ? 'Manage' : 'More'}</Text>
        </AnimatedPressable>
      </View>

      <PostManageSheet
        visible={manageVisible}
        onClose={() => setManageVisible(false)}
        onEdit={handleEditPost}
        onShare={handleShare}
        onDelete={handleDeletePost}
        deleting={isDeleting}
      />
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
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 2,
  },
  priceActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  price: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
  },
  buyNowButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    backgroundColor: lightBrown,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dmButton: {
    backgroundColor: 'rgba(166,124,82,0.86)',
  },
  buyNowText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
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
  soundPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  soundPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
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

