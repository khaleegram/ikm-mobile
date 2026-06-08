import React, { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { AnimatedPressable } from '@/components/animated-pressable';
import { CommentsSheet } from '@/components/market/comments-sheet';
import { PostActionsSheet } from '@/components/market/post-actions-sheet';
import { PostManageSheet } from '@/components/market/post-manage-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { buildDirectConversationId, marketMessagesApi } from '@/lib/api/market-messages';
import { marketPostsApi } from '@/lib/api/market-posts';
import { marketSocialApi } from '@/lib/api/market-social';
import { useFeedSocial } from '@/lib/context/feed-social-context';
import { useUser } from '@/lib/firebase/auth/use-user';
import { toggleMarketSave, useIsFollowing, useIsSaved } from '@/lib/firebase/firestore/market-social';
import { usePublicUserProfileOnce } from '@/lib/firebase/firestore/users';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { getMarketPostPrimaryImage } from '@/lib/utils/market-media';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import { MarketPost } from '@/types';

const lightBrown = '#A67C52';
const TAB_BAR_CLEARANCE = 88;

interface LucideIconProps {
  name: 'Heart' | 'MessageCircle' | 'Bookmark' | 'Send' | 'Ellipsis';
  size?: number;
  color?: string;
  fill?: string;
}

function LucideIcon({ name, size = 20, color = '#FFFFFF', fill = 'none' }: LucideIconProps) {
  if (name === 'Heart') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </Svg>
    );
  }
  if (name === 'MessageCircle') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </Svg>
    );
  }
  if (name === 'Bookmark') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </Svg>
    );
  }
  if (name === 'Send') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="m22 2-7 20-4-9-9-4Z" />
        <Path d="M22 2 11 13" />
      </Svg>
    );
  }
  if (name === 'Ellipsis') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={12} cy={12} r={1} fill={color} />
        <Circle cx={19} cy={12} r={1} fill={color} />
        <Circle cx={5} cy={12} r={1} fill={color} />
      </Svg>
    );
  }
  return null;
}

interface PostOverlayProps {
  post: MarketPost;
  likes: number;
  isLiked: boolean;
  onLike: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onAskForPrice?: () => void;
}

function RailIconButton({
  onPress,
  children,
  liked,
}: {
  onPress: () => void;
  children: React.ReactNode;
  liked?: boolean;
}) {
  return (
    <AnimatedPressable style={styles.railAction} onPress={onPress} scaleValue={0.88}>
      <View style={[styles.buttonContainer, liked && styles.iconBackdropLiked]}>
        {children}
      </View>
    </AnimatedPressable>
  );
}

export const PostOverlay = React.memo(function PostOverlay({
  post,
  likes,
  isLiked,
  onLike,
  onAskForPrice,
}: PostOverlayProps) {
  const { user } = useUser();
  const { enabled: feedSocialEnabled, followingIdSet, savedIdSet } = useFeedSocial();
  const insets = useSafeAreaInsets();
  const { user: poster } = usePublicUserProfileOnce(post.posterId);
  const isOwnPost = user?.uid === post.posterId;
  const marketLoginRoute = getLoginRouteForVariant('market');
  const [manageVisible, setManageVisible] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [optimisticFollowing, setOptimisticFollowing] = useState<boolean | null>(null);
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const openingChatRef = useRef(false);
  const posterId = String(post.posterId || '').trim();
  const postId = String(post.id || '').trim();
  const { isFollowing: hookIsFollowing } = useIsFollowing(
    feedSocialEnabled ? null : (user?.uid ?? null),
    feedSocialEnabled ? null : (post.posterId ?? null)
  );
  const { isSaved: hookIsSaved } = useIsSaved(
    feedSocialEnabled ? null : (user?.uid ?? null),
    feedSocialEnabled ? null : (post.id ?? null)
  );
  const isFollowing = feedSocialEnabled
    ? (posterId ? followingIdSet.has(posterId) : false)
    : hookIsFollowing;
  const isSaved = feedSocialEnabled
    ? (postId ? savedIdSet.has(postId) : false)
    : hookIsSaved;
  const isEffectivelyFollowing = optimisticFollowing ?? isFollowing;
  const isEffectivelySaved = optimisticSaved ?? isSaved;

  React.useEffect(() => {
    if (optimisticFollowing !== null && optimisticFollowing === isFollowing) {
      setOptimisticFollowing(null);
    }
  }, [isFollowing, optimisticFollowing]);

  React.useEffect(() => {
    if (optimisticSaved !== null && optimisticSaved === isSaved) {
      setOptimisticSaved(null);
    }
  }, [isSaved, optimisticSaved]);

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

  /* ─── Save toggle ─── */
  const handleSaveToggle = async () => {
    if (!user) {
      router.push(marketLoginRoute as any);
      return;
    }
    const nextSaved = !isEffectivelySaved;
    setOptimisticSaved(nextSaved);
    haptics.light();
    try {
      await toggleMarketSave(user.uid, post.id, isSaved);
    } catch (error) {
      setOptimisticSaved(isSaved);
      console.error('Error toggling save state:', error);
      showToast('Failed to save post', 'error');
    }
  };

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
      {/* Top vignette so header always pops */}
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'transparent']}
        style={styles.topVignette}
        pointerEvents="none"
      />

      {/* Rich bottom gradient — taller and denser */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.97)']}
        locations={[0, 0.2, 0.58, 1]}
        style={[styles.gradient, { height: bottomClearance + 320 }]}
        pointerEvents="none"
      />

      {/* Right-side action rail */}
      <View style={[styles.rail, { bottom: bottomClearance + 4 }]}>
        {/* Avatar with gradient ring */}
        <View style={styles.avatarWrap}>
          <TouchableOpacity
            onPress={() => post.posterId && router.push(`/(market)/seller/${encodeURIComponent(post.posterId)}` as any)}
            activeOpacity={0.82}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <LinearGradient
              colors={['#A67C52', '#C9A96E', '#FFFFFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarRing}>
              <View style={styles.avatarInnerBorder}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{posterName.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>
          {!isOwnPost && (
            <TouchableOpacity
              style={[styles.followBadge, isEffectivelyFollowing && styles.followBadgeActive]}
              onPress={handleFollowToggle}
              activeOpacity={0.8}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.followBadgeText}>{isEffectivelyFollowing ? '✓' : '+'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Like */}
        <View style={styles.railAction}>
          <TouchableOpacity
            onPress={onLike}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <View style={[styles.buttonContainer, isLiked && styles.iconBackdropLiked]}>
              <LucideIcon
                name="Heart"
                size={20}
                color={isLiked ? '#FF3B55' : '#FFFFFF'}
                fill={isLiked ? '#FF3B55' : 'none'}
              />
            </View>
          </TouchableOpacity>
          <Text style={styles.railLabel}>{likes > 999 ? `${(likes / 1000).toFixed(1)}k` : likes}</Text>
        </View>

        {/* Comment */}
        <View style={styles.railAction}>
          <RailIconButton onPress={() => setCommentsVisible(true)}>
            <LucideIcon name="MessageCircle" size={20} color="#FFFFFF" />
          </RailIconButton>
          <Text style={styles.railLabel}>{post.comments || 0}</Text>
        </View>

        {/* Save */}
        <RailIconButton onPress={handleSaveToggle}>
          <LucideIcon
            name="Bookmark"
            size={20}
            color="#FFFFFF"
            fill={isEffectivelySaved ? '#FFFFFF' : 'none'}
          />
        </RailIconButton>

        {/* Share */}
        <RailIconButton onPress={handleShare}>
          <LucideIcon name="Send" size={20} color="#FFFFFF" />
        </RailIconButton>

        {/* More / Manage */}
        <RailIconButton
          onPress={() => (isOwnPost ? setManageVisible(true) : setActionsVisible(true))}>
          <LucideIcon name="Ellipsis" size={20} color="#FFFFFF" />
        </RailIconButton>
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
              <View style={styles.pricePill}>
                <Text style={styles.price}>NGN {Number(post.price).toLocaleString()}</Text>
              </View>
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
      {commentsVisible && (
        <CommentsSheet
          postId={post.id ?? null}
          visible={commentsVisible}
          onClose={() => setCommentsVisible(false)}
          totalComments={post.comments ?? 0}
        />
      )}

      {actionsVisible && (
        <PostActionsSheet
          visible={actionsVisible}
          onClose={() => setActionsVisible(false)}
          posterName={posterName}
          actions={nonOwnActions}
        />
      )}

      {manageVisible && (
        <PostManageSheet
          visible={manageVisible}
          onClose={() => setManageVisible(false)}
          onEdit={handleEditPost}
          onShare={handleShare}
          onDelete={handleDeletePost}
          deleting={isDeleting}
        />
      )}
    </>
  );
}, (prev, next) =>
  prev.post.id === next.post.id &&
  prev.likes === next.likes &&
  prev.isLiked === next.isLiked &&
  prev.post.comments === next.post.comments &&
  prev.post.posterId === next.post.posterId &&
  prev.post.description === next.post.description &&
  prev.post.price === next.post.price
);

const styles = StyleSheet.create({
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  topVignette: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
    zIndex: 5,
  },
  rail: {
    position: 'absolute',
    right: 10,
    alignItems: 'center',
    gap: 14,
    zIndex: 10,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 4,
    alignItems: 'center',
  },
  avatarRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    padding: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInnerBorder: {
    width: 57,
    height: 57,
    borderRadius: 28.5,
    borderWidth: 2,
    borderColor: '#000',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
  },
  avatarFallback: {
    backgroundColor: '#A67C52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  followBadge: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#A67C52',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  followBadgeActive: {
    backgroundColor: '#3A3A3A',
  },
  followBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 14,
  },
  iconBackdrop: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBackdropLiked: {
    backgroundColor: 'rgba(255,59,85,0.18)',
    shadowColor: '#FF3B55',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
  },
  railAction: {
    alignItems: 'center',
    gap: 4,
  },
  buttonContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  railLabel: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 10,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
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
    fontSize: 20,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  pricePill: {
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  ctaButton: {
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: 18,
    backgroundColor: '#A67C52',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#A67C52',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
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
