import React, { useMemo, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedPressable } from '@/components/animated-pressable';
import { CommentsSheet } from '@/components/market/comments-sheet';
import { PostActionsSheet } from '@/components/market/post-actions-sheet';
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
const TAB_BAR_CLEARANCE = 88;

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
  onAskForPrice,
  likeScaleAnim,
}: PostOverlayProps) {
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const { user: poster } = usePublicUserProfile(post.posterId);
  const defaultAnim = useRef(new Animated.Value(1)).current;
  const animValue = likeScaleAnim || defaultAnim;
  const isOwnPost = user?.uid === post.posterId;
  const marketLoginRoute = getLoginRouteForVariant('market');
  const [manageVisible, setManageVisible] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [optimisticFollowing, setOptimisticFollowing] = useState<boolean | null>(null);
  const openingChatRef = useRef(false);
  const { isFollowing } = useIsFollowing(user?.uid ?? null, post.posterId ?? null);
  const isEffectivelyFollowing = optimisticFollowing ?? isFollowing;

  React.useEffect(() => {
    if (optimisticFollowing !== null && optimisticFollowing === isFollowing) {
      setOptimisticFollowing(null);
    }
  }, [isFollowing, optimisticFollowing]);

  const bottomClearance = TAB_BAR_CLEARANCE + Math.max(insets.bottom, 8);

  const posterName = useMemo(
    () => String(poster?.displayName || poster?.storeName || '').trim() || 'Seller',
    [poster?.displayName, poster?.storeName]
  );

  const avatarUri = useMemo(
    () => String(poster?.storeLogoUrl || (poster as any)?.photoURL || '').trim() || null,
    [poster]
  );

  const hasPrice = typeof post.price === 'number' && post.price > 0;
  const locationText = [post.location?.city, post.location?.state].filter(Boolean).join(', ');

  /* ─── Follow toggle ─── */
  const handleFollowToggle = async () => {
    if (!post.posterId) {
      showToast('Seller profile is not available.', 'error');
      return;
    }
    if (!user) {
      Alert.alert('Login Required', 'Please log in to follow sellers', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }
    if (followPending) return;
    setFollowPending(true);
    const nextFollowing = !isEffectivelyFollowing;
    setOptimisticFollowing(nextFollowing);
    haptics.light();
    try {
      await marketSocialApi.setFollowState(post.posterId, nextFollowing);
      showToast(nextFollowing ? 'Following!' : 'Unfollowed.', 'success');
    } catch (e: any) {
      setOptimisticFollowing(isFollowing);
      showToast(e?.message || 'Unable to update follow.', 'error');
    } finally {
      setFollowPending(false);
    }
  };

  /* ─── Open chat ─── */
  const openChat = async (mode: 'ask-price' | 'dm') => {
    if (onAskForPrice) { onAskForPrice(); return; }
    if (!user) {
      Alert.alert('Login Required', 'Please log in to message sellers', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }
    if (!post.id || !post.posterId) { showToast('Unable to start chat for this post', 'error'); return; }
    if (openingChatRef.current) return;
    openingChatRef.current = true;
    const chatId = buildDirectConversationId(user.uid, post.posterId);
    const quotePreview = hasPrice
      ? `Post preview - NGN ${Number(post.price).toLocaleString()}${locationText ? ` - ${locationText}` : ''}`
      : `Post preview${locationText ? ` - ${locationText}` : ''}`;
    const autoText = mode === 'ask-price'
      ? `Hi ${posterName}, I'd like to ask for the price of this item.`
      : `Hi ${posterName}, I'm interested in this post.`;
    try {
      haptics.medium();
      router.push(`/(market)/messages/${chatId}?peerId=${encodeURIComponent(post.posterId)}` as any);
    } catch (e: any) {
      openingChatRef.current = false;
      haptics.error();
      showToast(e?.message || 'Failed to open chat', 'error');
      return;
    }
    void (async () => {
      try {
        await marketMessagesApi.sendQuoteMessage(
          chatId,
          { postId: post.id, previewText: quotePreview, previewImage: getMarketPostPrimaryImage(post) || undefined },
          autoText
        );
      } catch { /* silent */ } finally {
        openingChatRef.current = false;
      }
    })();
  };

  const handleBuyNow = () => {
    if (!post.id) { showToast('Unable to open checkout.', 'error'); return; }
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

  const handleShare = async () => {
    haptics.medium();
    try { await shareMarketPost(post); } catch { showToast('Unable to share right now.', 'error'); }
  };

  const handleEditPost = () => {
    if (!post.id) return;
    haptics.light();
    setManageVisible(false);
    router.push(`/(market)/post-edit/${post.id}` as any);
  };

  const handleDeletePost = () => {
    if (!post.id || isDeleting) return;
    Alert.alert('Delete Post', 'This will permanently remove this post.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            setIsDeleting(true);
            await marketPostsApi.delete(post.id!);
            haptics.success();
            showToast('Post deleted.', 'success');
          } catch (e: any) {
            haptics.error();
            showToast(e?.message || 'Failed to delete post.', 'error');
          } finally {
            setIsDeleting(false);
            setManageVisible(false);
          }
        },
      },
    ]);
  };

  /* ─── Non-own actions list ─── */
  const nonOwnActions = useMemo(() => [
    {
      id: 'view-profile',
      label: 'View Profile',
      icon: 'person.circle.fill',
      onPress: () => post.posterId && router.push(`/(market)/seller/${encodeURIComponent(post.posterId)}` as any),
    },
    {
      id: isEffectivelyFollowing ? 'unfollow' : 'follow',
      label: isEffectivelyFollowing ? 'Unfollow' : 'Follow',
      icon: 'person.fill',
      color: isEffectivelyFollowing ? undefined : lightBrown,
      onPress: handleFollowToggle,
    },
    {
      id: 'dm',
      label: 'Send Message',
      icon: 'message.fill',
      onPress: () => void openChat('dm'),
    },
    {
      id: 'share',
      label: 'Share Post',
      icon: 'square.and.arrow.up',
      onPress: handleShare,
    },
    {
      id: 'block',
      label: 'Block User',
      icon: 'xmark.circle.fill',
      destructive: true,
      onPress: () => {
        if (!user) { router.push(marketLoginRoute as any); return; }
        Alert.alert('Block user?', `You won't see ${posterName}'s posts or messages.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block', style: 'destructive',
            onPress: async () => {
              try { haptics.medium(); await marketSocialApi.blockUser(post.posterId); showToast('User blocked.', 'success'); }
              catch (e: any) { showToast(e?.message || 'Unable to block user.', 'error'); }
            },
          },
        ]);
      },
    },
    {
      id: 'report',
      label: 'Report Post',
      icon: 'exclamationmark.bubble.fill',
      destructive: true,
      onPress: async () => {
        if (!user) { router.push(marketLoginRoute as any); return; }
        haptics.light();
        try {
          await marketSocialApi.report({ targetType: 'post', targetId: String(post.id || ''), reason: 'spam_or_scam', details: `Poster: ${post.posterId}` });
          showToast('Report submitted.', 'success');
        } catch (e: any) { showToast(e?.message || 'Unable to report.', 'error'); }
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isEffectivelyFollowing, post.posterId, post.id, posterName, user, followPending]);

  return (
    <>
      {/* Rich bottom gradient */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.82)', 'rgba(0,0,0,0.96)']}
        locations={[0, 0.28, 0.68, 1]}
        style={[styles.gradient, { height: bottomClearance + 260 }]}
        pointerEvents="none"
      />

      {/* Right-side action rail */}
      <View style={[styles.rail, { bottom: bottomClearance + 4 }]}>
        {/* Avatar + follow badge */}
        <View style={styles.avatarWrap}>
          <TouchableOpacity
            onPress={() => post.posterId && router.push(`/(market)/seller/${encodeURIComponent(post.posterId)}` as any)}
            activeOpacity={0.82}
            style={styles.avatarTouchable}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{posterName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </TouchableOpacity>
          {!isOwnPost && (
            <TouchableOpacity
              style={[styles.followBadge, isEffectivelyFollowing && styles.followBadgeActive]}
              onPress={handleFollowToggle}
              activeOpacity={0.8}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <IconSymbol
                name={isEffectivelyFollowing ? 'checkmark' : 'plus'}
                size={10}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Like */}
        <AnimatedPressable style={styles.railAction} onPress={onLike} scaleValue={0.88}>
          <Animated.View style={{ transform: [{ scale: animValue }] }}>
            <IconSymbol
              name={isLiked ? 'heart.fill' : 'heart'}
              size={33}
              color={isLiked ? '#FF3B55' : '#FFFFFF'}
            />
          </Animated.View>
          <Text style={styles.railCount}>{likes > 999 ? `${(likes / 1000).toFixed(1)}k` : likes}</Text>
        </AnimatedPressable>

        {/* Comment */}
        <AnimatedPressable style={styles.railAction} onPress={() => setCommentsVisible(true)} scaleValue={0.88}>
          <IconSymbol name="bubble.right.fill" size={31} color="#FFFFFF" />
          <Text style={styles.railCount}>{post.comments || 0}</Text>
        </AnimatedPressable>

        {/* Share */}
        <AnimatedPressable style={styles.railAction} onPress={handleShare} scaleValue={0.88}>
          <IconSymbol name="arrowshape.turn.up.right.fill" size={30} color="#FFFFFF" />
          <Text style={styles.railCount}>Share</Text>
        </AnimatedPressable>

        {/* More / Manage */}
        <AnimatedPressable
          style={styles.railAction}
          onPress={() => isOwnPost ? setManageVisible(true) : setActionsVisible(true)}
          scaleValue={0.88}>
          <IconSymbol name="ellipsis" size={27} color="#FFFFFF" />
          <Text style={styles.railCount}>{isOwnPost ? 'Manage' : 'More'}</Text>
        </AnimatedPressable>
      </View>

      {/* Left-side content */}
      <View style={[styles.content, { bottom: bottomClearance + 4 }]}>
        {/* Seller name row */}
        <View style={styles.handleRow}>
          <TouchableOpacity
            onPress={() => post.posterId && router.push(`/(market)/seller/${encodeURIComponent(post.posterId)}` as any)}
            activeOpacity={0.8}>
            <Text style={styles.handle} numberOfLines={1}>{posterName}</Text>
          </TouchableOpacity>
          {!isOwnPost && (
            <TouchableOpacity
              style={[styles.inlineFollowPill, isEffectivelyFollowing && styles.inlineFollowPillActive]}
              onPress={handleFollowToggle}
              activeOpacity={0.75}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Text style={styles.inlineFollowText}>{isEffectivelyFollowing ? '✓ Following' : '+ Follow'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {post.description ? (
          <Text style={styles.description} numberOfLines={3}>{post.description}</Text>
        ) : null}

        {locationText ? (
          <View style={styles.locationRow}>
            <IconSymbol name="location.fill" size={11} color="rgba(255,255,255,0.7)" />
            <Text style={styles.locationText}>{locationText}</Text>
          </View>
        ) : null}

        {post.soundMeta?.soundId && post.soundMeta?.title ? (
          <AnimatedPressable
            style={styles.soundPill}
            onPress={() => router.push(`/(market)/sound/${post.soundMeta?.soundId}` as any)}
            scaleValue={0.96}>
            <IconSymbol name="music.note" size={12} color="#FFFFFF" />
            <Text style={styles.soundPillText} numberOfLines={1}>{post.soundMeta.title}</Text>
          </AnimatedPressable>
        ) : null}

        {/* CTA row */}
        <View style={styles.ctaRow}>
          {hasPrice ? (
            <>
              <Text style={styles.price}>NGN {Number(post.price).toLocaleString()}</Text>
              {!isOwnPost && (
                <>
                  {post.isNegotiable ? (
                    <AnimatedPressable
                      style={[styles.ctaButton, styles.ctaButtonGhost]}
                      onPress={() => void openChat('dm')}
                      scaleValue={0.94}>
                      <IconSymbol name="message.fill" size={13} color="#FFFFFF" />
                      <Text style={styles.ctaButtonText}>DM</Text>
                    </AnimatedPressable>
                  ) : null}
                  <AnimatedPressable style={styles.ctaButton} onPress={handleBuyNow} scaleValue={0.94}>
                    <IconSymbol name="bag.fill" size={13} color="#FFFFFF" />
                    <Text style={styles.ctaButtonText}>Buy</Text>
                  </AnimatedPressable>
                </>
              )}
            </>
          ) : !isOwnPost ? (
            <AnimatedPressable
              style={[styles.ctaButton, styles.ctaButtonFull]}
              onPress={() => void openChat('ask-price')}
              scaleValue={0.94}>
              <Text style={styles.ctaButtonText}>Ask for Price</Text>
            </AnimatedPressable>
          ) : null}
        </View>
      </View>

      {/* Sheets */}
      <CommentsSheet
        postId={post.id ?? null}
        visible={commentsVisible}
        onClose={() => setCommentsVisible(false)}
        totalComments={post.comments ?? 0}
      />

      <PostActionsSheet
        visible={actionsVisible}
        onClose={() => setActionsVisible(false)}
        posterName={posterName}
        actions={nonOwnActions}
      />

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
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  rail: {
    position: 'absolute',
    right: 10,
    alignItems: 'center',
    gap: 22,
    zIndex: 10,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  avatarTouchable: {},
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarFallback: {
    backgroundColor: lightBrown,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
  },
  followBadge: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: lightBrown,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  followBadgeActive: {
    backgroundColor: '#3A3A3A',
  },
  railAction: {
    alignItems: 'center',
    gap: 3,
  },
  railCount: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  content: {
    position: 'absolute',
    left: 14,
    right: 82,
    gap: 5,
    zIndex: 10,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  handle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  inlineFollowPill: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  inlineFollowPillActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  inlineFollowText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  description: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '600',
  },
  soundPill: {
    alignSelf: 'flex-start',
    maxWidth: 220,
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  soundPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  price: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  ctaButton: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 18,
    backgroundColor: lightBrown,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ctaButtonGhost: {
    backgroundColor: 'rgba(166,124,82,0.75)',
  },
  ctaButtonFull: {
    paddingHorizontal: 22,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
