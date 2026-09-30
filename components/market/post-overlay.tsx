import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { CommentsSheet } from '@/components/market/comments-sheet';
import { PostActionsSheet } from '@/components/market/post-actions-sheet';
import { PostManageSheet } from '@/components/market/post-manage-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';
import { showToast } from '@/components/toast';
import { marketPostsApi } from '@/lib/api/market-posts';
import { marketSocialApi } from '@/lib/api/market-social';
import { useFeedSocial } from '@/lib/context/feed-social-context';
import { useUser } from '@/lib/firebase/auth/use-user';
import { toggleBlock, toggleFollow, toggleMarketSave, useIsFollowing, useIsSaved } from '@/lib/hooks/use-social';
import { usePublicUserProfileOnce } from '@/lib/firebase/firestore/users';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { formatCompactCount } from '@/lib/utils/format-count';
import { haptics } from '@/lib/utils/haptics';
import { startPostQuoteChat } from '@/lib/utils/market-ask-price-chat';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import { MarketPost } from '@/types';
import { Alert } from '@/components/app-alert';

const lightBrown = '#A67C52';
const LIKE_RED = '#FF3B55';
const TAB_BAR_CLEARANCE = 88;

/** Instagram Reels rail tokens */
const IG_ICON = 24;
const IG_RAIL_GAP = 14;
const IG_RAIL_WIDTH = 44;
const IG_ICON_SLOT = 28;
const IG_HIT_SLOP = 8;
const IG_LABEL_SPACER = 14;
const IG_AVATAR_RING = 46;
const IG_AVATAR_INNER = 42;

function LucideIcon({
  name,
  size = IG_ICON,
  color = '#FFFFFF',
  fill = 'none',
}: {
  name: 'Heart' | 'MessageCircle' | 'Bookmark' | 'Send' | 'Ellipsis' | 'Volume2' | 'VolumeX';
  size?: number;
  color?: string;
  fill?: string;
}) {
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
  if (name === 'Volume2') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M11 5 6 9H2v6h4l5 4V5z" />
        <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </Svg>
    );
  }
  if (name === 'VolumeX') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M11 5 6 9H2v6h4l5 4V5z" />
        <Path d="m22 9-6 6" />
        <Path d="m16 9 6 6" />
      </Svg>
    );
  }
  return null;
}

function RailButton({
  onPress,
  children,
  testID,
  popScale,
}: {
  onPress: () => void;
  children: React.ReactNode;
  testID?: string;
  /** Extra scale multiplier (like pop) layered on press scale */
  popScale?: Animated.Value;
}) {
  const pressScale = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    Animated.spring(pressScale, {
      toValue: 0.92,
      useNativeDriver: true,
      tension: 400,
      friction: 20,
    }).start();
  }, [pressScale]);

  const onPressOut = useCallback(() => {
    Animated.spring(pressScale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 300,
      friction: 18,
    }).start();
  }, [pressScale]);

  const scale = popScale
    ? Animated.multiply(pressScale, popScale)
    : pressScale;

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      activeOpacity={0.85}
      hitSlop={{ top: IG_HIT_SLOP, bottom: IG_HIT_SLOP, left: IG_HIT_SLOP, right: IG_HIT_SLOP }}
      style={styles.iconSlot}
      testID={testID}>
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

function RailAction({
  children,
  label,
  onPress,
  labelColor,
  testID,
  popScale,
  showSpacer,
}: {
  children: React.ReactNode;
  label?: string;
  onPress: () => void;
  labelColor?: string;
  testID?: string;
  popScale?: Animated.Value;
  /** Keep vertical rhythm when there is no count */
  showSpacer?: boolean;
}) {
  return (
    <View style={styles.railAction}>
      <RailButton onPress={onPress} testID={testID} popScale={popScale}>
        {children}
      </RailButton>
      {label !== undefined ? (
        <Text style={[styles.railLabel, labelColor ? { color: labelColor } : null]}>{label}</Text>
      ) : showSpacer ? (
        <View style={styles.railLabelSpacer} />
      ) : null}
    </View>
  );
}

interface PostOverlayProps {
  post: MarketPost;
  likes: number;
  isLiked: boolean;
  onLike: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onFavorite?: () => void;
  muted?: boolean;
  onMuteToggle?: () => void;
  isPostSaved?: boolean;
  isPosterFollowed?: boolean;
  /** Multi-photo posts put their thumbnail strip here, above the price card. */
  photoStrip?: React.ReactNode;
}

export const PostOverlay = React.memo(function PostOverlay({
  post,
  likes,
  isLiked,
  onLike,
  onComment,
  onFavorite,
  muted = false,
  onMuteToggle,
  isPostSaved,
  isPosterFollowed,
  photoStrip,
}: PostOverlayProps) {
  const { user } = useUser();
  const { enabled: feedSocialEnabled, followingIdSet, savedIdSet } = useFeedSocial();
  const insets = useSafeAreaInsets();
  // Prefer denormalized identity from the post payload (API JOIN). Profile Query is only
  // a fill-in when the feed row is missing store name/avatar.
  const needsPosterFetch =
    !String(post.posterStoreName || '').trim() || !String(post.posterAvatarUrl || '').trim();
  const { user: poster } = usePublicUserProfileOnce(
    needsPosterFetch ? post.posterId : null
  );
  const isOwnPost = user?.uid === post.posterId;
  const marketLoginRoute = getLoginRouteForVariant('market');
  const [manageVisible, setManageVisible] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const posterId = String(post.posterId || '').trim();
  const postId = String(post.id || '').trim();
  const likePop = useRef(new Animated.Value(1)).current;
  const prevLikedRef = useRef(isLiked);

  const { isFollowing: hookFollowing } = useIsFollowing(
    feedSocialEnabled ? null : (user?.uid ?? null),
    feedSocialEnabled ? null : (post.posterId ?? null)
  );
  const { isSaved: hookSaved } = useIsSaved(
    feedSocialEnabled ? null : (user?.uid ?? null),
    feedSocialEnabled ? null : (post.id ?? null)
  );

  const isFollowing =
    typeof isPosterFollowed === 'boolean'
      ? isPosterFollowed
      : feedSocialEnabled
        ? posterId
          ? followingIdSet.has(posterId)
          : false
        : hookFollowing;
  const isSaved =
    typeof isPostSaved === 'boolean'
      ? isPostSaved
      : feedSocialEnabled
        ? postId
          ? savedIdSet.has(postId)
          : false
        : hookSaved;
  // toggleFollow/toggleMarketSave optimistically update the shared Query cache that both
  // `hookFollowing`/`hookSaved` and the feed-level `followingIdSet`/`savedIdSet` read from,
  // so isFollowing/isSaved above already reflect the pending state instantly. No local
  // optimistic override needed — and every other screen sharing that cache updates too.
  const displayFollowing = isFollowing;
  const displaySaved = isSaved;

  /* Like pop spring when liked flips on */
  useEffect(() => {
    if (isLiked && !prevLikedRef.current) {
      likePop.setValue(1);
      Animated.sequence([
        Animated.spring(likePop, { toValue: 1.18, useNativeDriver: true, tension: 380, friction: 8 }),
        Animated.spring(likePop, { toValue: 1, useNativeDriver: true, tension: 280, friction: 12 }),
      ]).start();
    }
    prevLikedRef.current = isLiked;
  }, [isLiked, likePop]);

  const bottomClearance = TAB_BAR_CLEARANCE + Math.max(insets.bottom, 8);
  const posterName = useMemo(() => {
    const fromPost = String(post.posterStoreName || '').trim();
    if (fromPost) return fromPost;
    const store = String(poster?.storeName || '').trim();
    if (store) return store;
    const display = String(poster?.displayName || '').trim();
    if (display && !display.includes('@') && display !== 'User' && display !== 'Seller') {
      return display;
    }
    return display || 'Seller';
  }, [post.posterStoreName, poster?.displayName, poster?.storeName]);
  const avatarUri = useMemo(
    () =>
      String(
        post.posterAvatarUrl ||
          poster?.storeLogoUrl ||
          (poster as any)?.avatarUrl ||
          (poster as any)?.photoURL ||
          ''
      ).trim() || null,
    [post.posterAvatarUrl, poster]
  );
  const hasPrice = typeof post.price === 'number' && post.price > 0;
  const locationText = [post.location?.city, post.location?.state].filter(Boolean).join(', ');
  const priceLabel = hasPrice ? `₦${Number(post.price).toLocaleString()}` : null;

  const promptAuth = useCallback(
    (message: string) => {
      Alert.alert('Sign in required', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => router.push(marketLoginRoute as any) },
      ]);
    },
    [marketLoginRoute]
  );

  const withAuth = useCallback(
    (action: () => void, message: string) => {
      if (user) action();
      else promptAuth(message);
    },
    [user, promptAuth]
  );

  const handleLike = useCallback(() => {
    withAuth(onLike, 'Sign in to like posts.');
  }, [withAuth, onLike]);

  const handleComment = useCallback(() => {
    withAuth(() => {
      onComment?.();
      setCommentsVisible(true);
    }, 'Sign in to comment on posts.');
  }, [withAuth, onComment]);

  /* Save — wait for server, spinner while pending (no count) */
  const handleSave = useCallback(() => {
    if (!user) {
      promptAuth('Sign in to save posts.');
      return;
    }
    if (saveBusy || !postId) return;
    setSaveBusy(true);
    haptics.light();
    onFavorite?.();
    toggleMarketSave(user.uid, postId)
      .catch(() => showToast('Failed to save', 'error'))
      .finally(() => setSaveBusy(false));
  }, [user, saveBusy, postId, onFavorite, promptAuth]);

  /* Follow — instant + fire-and-forget */
  const handleFollow = useCallback(() => {
    if (!post.posterId) {
      showToast('Seller not available.', 'error');
      return;
    }
    if (!user) {
      promptAuth('Sign in to follow sellers.');
      return;
    }
    const next = !displayFollowing;
    haptics.light();
    toggleFollow(user.uid, post.posterId, isFollowing)
      .then(() => showToast(next ? 'Following!' : 'Unfollowed.', 'success'))
      .catch((e: any) => {
        showToast(e?.message || 'Unable to update follow.', 'error');
      });
  }, [post.posterId, user, displayFollowing, isFollowing, promptAuth]);

  const openChat = useCallback(
    (mode: 'ask-price' | 'dm') => {
      // Always open the real inbox deal room (same screen as Messages) — not a feed-only sheet.
      void startPostQuoteChat({
        post,
        buyerId: user?.uid || '',
        sellerName: posterName,
        sellerAvatar: avatarUri,
        mode,
        marketLoginRoute,
      });
    },
    [post, user?.uid, posterName, avatarUri, marketLoginRoute]
  );

  const handleBuy = useCallback(() => {
    if (!post.id) {
      showToast('Unable to open checkout.', 'error');
      return;
    }
    if (!user) {
      promptAuth('Please sign in to buy.');
      return;
    }
    haptics.medium();
    router.push(`/(market)/buy/${post.id}` as any);
  }, [post.id, user, promptAuth]);

  const handleAddToCart = useCallback(() => {
    if (!post.id) {
      showToast('Unable to add to cart.', 'error');
      return;
    }
    if (!user) {
      promptAuth('Please sign in to use the cart.');
      return;
    }
    haptics.light();
    void import('@/lib/stores/market-cart').then(({ useMarketCartStore }) => {
      useMarketCartStore.getState().addPost(post);
    });
  }, [post, user, promptAuth]);

  const handleShare = useCallback(async () => {
    haptics.medium();
    try {
      await shareMarketPost(post);
    } catch {
      showToast('Unable to share.', 'error');
    }
  }, [post]);

  const handleEdit = useCallback(() => {
    if (!post.id) return;
    haptics.light();
    setManageVisible(false);
    router.push(`/(market)/post-edit/${post.id}` as any);
  }, [post.id]);

  const handleDelete = useCallback(() => {
    if (!post.id || isDeleting) return;
    Alert.alert('Delete Post', 'Permanently remove?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsDeleting(true);
            await marketPostsApi.delete(post.id!);
            haptics.success();
            showToast('Deleted.', 'success');
          } catch (e: any) {
            haptics.error();
            showToast(e?.message || 'Failed.', 'error');
          } finally {
            setIsDeleting(false);
            setManageVisible(false);
          }
        },
      },
    ]);
  }, [post.id, isDeleting]);

  const nonOwnActions = useMemo(
    () => [
      {
        id: 'profile',
        label: 'View Profile',
        icon: 'person.circle.fill',
        onPress: () =>
          post.posterId &&
          router.push(`/(market)/seller/${encodeURIComponent(post.posterId)}` as any),
      },
      {
        id: displayFollowing ? 'unfollow' : 'follow',
        label: displayFollowing ? 'Unfollow' : 'Follow',
        icon: 'person.fill',
        color: displayFollowing ? undefined : lightBrown,
        onPress: handleFollow,
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
          if (!user) {
            promptAuth('Sign in to block users.');
            return;
          }
          Alert.alert('Block?', `Hide ${posterName}'s posts.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Block',
              style: 'destructive',
              onPress: async () => {
                if (!user?.uid || !post.posterId) return;
                try {
                  haptics.medium();
                  await toggleBlock(user.uid, post.posterId, false);
                  showToast('Blocked.', 'success');
                } catch (e: any) {
                  showToast(e?.message || 'Failed.', 'error');
                }
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
          if (!user) {
            promptAuth('Sign in to report posts.');
            return;
          }
          try {
            await marketSocialApi.report({
              targetType: 'post',
              targetId: postId,
              reason: 'spam_or_scam',
              details: `Poster: ${post.posterId}`,
            });
            showToast('Reported.', 'success');
          } catch (e: any) {
            showToast(e?.message || 'Failed.', 'error');
          }
        },
      },
    ],
    [
      displayFollowing,
      post.posterId,
      postId,
      posterName,
      user,
      handleFollow,
      handleShare,
      openChat,
      promptAuth,
    ]
  );

  const likeLabelColor = isLiked ? LIKE_RED : '#FFFFFF';

  return (
    <>
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'transparent']}
        style={styles.topVignette}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.97)']}
        locations={[0, 0.2, 0.58, 1]}
        style={[styles.gradient, { height: bottomClearance + 320 }]}
        pointerEvents="none"
      />

      {/* Instagram order: Like → Comment → Share → Save → More */}
      <View style={[styles.rail, { bottom: bottomClearance + 4 }]} pointerEvents="box-none">
        <View style={styles.avatarWrap}>
          <TouchableOpacity
            onPress={() =>
              post.posterId &&
              router.push(`/(market)/seller/${encodeURIComponent(post.posterId)}` as any)
            }
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
              style={[styles.followBadge, displayFollowing && styles.followBadgeActive]}
              onPress={handleFollow}
              activeOpacity={0.8}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.followBadgeText}>{displayFollowing ? '✓' : '+'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <RailAction
          label={formatCompactCount(likes)}
          labelColor={likeLabelColor}
          onPress={handleLike}
          testID="feed-like-btn"
          popScale={likePop}>
          <View style={styles.iconShadow}>
            <LucideIcon
              name="Heart"
              color={isLiked ? LIKE_RED : '#FFFFFF'}
              fill={isLiked ? LIKE_RED : 'none'}
            />
          </View>
        </RailAction>

        <RailAction
          label={formatCompactCount(post.comments || 0)}
          onPress={handleComment}
          testID="feed-comment-btn">
          <View style={styles.iconShadow}>
            <LucideIcon name="MessageCircle" color="#FFFFFF" />
          </View>
        </RailAction>

        <RailAction onPress={handleShare} testID="feed-share-btn" showSpacer>
          <View style={styles.iconShadow}>
            <LucideIcon name="Send" color="#FFFFFF" />
          </View>
        </RailAction>

        <RailAction
          onPress={handleSave}
          testID="feed-save-btn"
          showSpacer>
          <View style={styles.iconShadow}>
            {saveBusy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <LucideIcon
                name="Bookmark"
                color={displaySaved ? lightBrown : '#FFFFFF'}
                fill={displaySaved ? lightBrown : 'none'}
              />
            )}
          </View>
        </RailAction>

        <RailAction
          onPress={() => (isOwnPost ? setManageVisible(true) : setActionsVisible(true))}
          testID="feed-more-btn"
          showSpacer>
          <View style={styles.iconShadow}>
            <LucideIcon name="Ellipsis" color="#FFFFFF" />
          </View>
        </RailAction>

        {onMuteToggle ? (
          <RailAction
            onPress={onMuteToggle}
            testID="feed-sound-btn"
            showSpacer>
            <View style={styles.iconShadow}>
              <LucideIcon name={muted ? 'VolumeX' : 'Volume2'} color="#FFFFFF" />
            </View>
          </RailAction>
        ) : null}
      </View>

      <View style={[styles.content, { bottom: bottomClearance + 4 }]} pointerEvents="box-none">
        {photoStrip}

        <View style={styles.handleRow}>
          <TouchableOpacity
            style={styles.handleTap}
            onPress={() =>
              post.posterId &&
              router.push(`/(market)/seller/${encodeURIComponent(post.posterId)}` as any)
            }
            activeOpacity={0.8}>
            <Text style={styles.handle} numberOfLines={1}>
              {posterName}
            </Text>
            <VerifiedBadge size={13} color="#FFFFFF" />
          </TouchableOpacity>
          {!isOwnPost && (
            <TouchableOpacity
              style={[styles.inlineFollowPill, displayFollowing && styles.inlineFollowPillActive]}
              onPress={handleFollow}
              activeOpacity={0.75}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Text style={styles.inlineFollowText}>
                {displayFollowing ? '✓ Following' : '+ Follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Product pin under seller name */}
        {(hasPrice || !isOwnPost) && (
          <View style={styles.productPin} pointerEvents="box-none">
            {hasPrice ? (
              <View style={styles.productPinCard}>
                <TouchableOpacity
                  style={styles.productPinMain}
                  onPress={isOwnPost ? undefined : handleBuy}
                  activeOpacity={isOwnPost ? 1 : 0.85}
                  disabled={isOwnPost}
                  accessibilityRole="button"
                  accessibilityLabel={`Buy for ${priceLabel}`}>
                  <View style={styles.productPinIcon}>
                    <IconSymbol name="bag.fill" size={13} color="#1A1A1A" />
                  </View>
                  <Text style={styles.productPinPrice} numberOfLines={1}>
                    {priceLabel}
                  </Text>
                  {!isOwnPost ? (
                    <View style={styles.productPinBuy}>
                      <Text style={styles.productPinBuyText}>Buy</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
                {!isOwnPost ? (
                  <TouchableOpacity
                    style={styles.productPinMsg}
                    onPress={handleAddToCart}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Add to cart">
                    <IconSymbol name="plus.circle.fill" size={15} color="#1A1A1A" />
                  </TouchableOpacity>
                ) : null}
                {!isOwnPost ? (
                  <TouchableOpacity
                    style={styles.productPinMsg}
                    onPress={() => void openChat('dm')}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Message seller to negotiate">
                    <IconSymbol name="message.fill" size={15} color="#1A1A1A" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.productPinCard}
                onPress={() => void openChat('ask-price')}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Ask for price">
                <View style={styles.productPinMain}>
                  <View style={styles.productPinIcon}>
                    <IconSymbol name="tag.fill" size={13} color="#1A1A1A" />
                  </View>
                  <Text style={styles.productPinPrice}>Ask price</Text>
                  <View style={styles.productPinBuy}>
                    <Text style={styles.productPinBuyText}>Ask</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}

        {post.title?.trim() ? (
          <Text style={styles.productTitle} numberOfLines={2}>
            {post.title.trim()}
          </Text>
        ) : null}
        {post.description?.trim() ? (
          <Text style={styles.productDescription} numberOfLines={3}>
            {post.description.trim()}
          </Text>
        ) : null}
        {locationText ? (
          <View style={styles.locationRow}>
            <IconSymbol name="location.fill" size={11} color="rgba(255,255,255,0.7)" />
            <Text style={styles.locationText}>{locationText}</Text>
          </View>
        ) : null}
      </View>

      <CommentsSheet
        postId={post.id ?? null}
        visible={commentsVisible}
        onClose={() => setCommentsVisible(false)}
        totalComments={post.comments ?? 0}
      />
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
          onEdit={handleEdit}
          onShare={handleShare}
          onDelete={handleDelete}
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
  prev.post.title === next.post.title &&
  prev.post.description === next.post.description &&
  prev.post.price === next.post.price &&
  prev.muted === next.muted &&
  prev.onMuteToggle === next.onMuteToggle &&
  prev.onLike === next.onLike &&
  prev.onComment === next.onComment &&
  prev.onShare === next.onShare &&
  prev.onFavorite === next.onFavorite &&
  prev.isPostSaved === next.isPostSaved &&
  prev.isPosterFollowed === next.isPosterFollowed
);

const styles = StyleSheet.create({
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  topVignette: { position: 'absolute', top: 0, left: 0, right: 0, height: 160, zIndex: 5 },
  rail: {
    position: 'absolute',
    right: 8,
    width: IG_RAIL_WIDTH,
    alignItems: 'center',
    gap: IG_RAIL_GAP,
    zIndex: 10,
  },
  avatarWrap: { position: 'relative', marginBottom: 4, alignItems: 'center' },
  avatarRing: {
    width: IG_AVATAR_RING,
    height: IG_AVATAR_RING,
    borderRadius: IG_AVATAR_RING / 2,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInnerBorder: {
    width: IG_AVATAR_INNER,
    height: IG_AVATAR_INNER,
    borderRadius: IG_AVATAR_INNER / 2,
    borderWidth: 2,
    borderColor: '#000',
    overflow: 'hidden',
  },
  avatar: { width: '100%', height: '100%', borderRadius: IG_AVATAR_INNER / 2 },
  avatarFallback: { backgroundColor: '#A67C52', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
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
  followBadgeActive: { backgroundColor: '#3A3A3A' },
  followBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', lineHeight: 14 },
  railAction: { alignItems: 'center', gap: 2, width: IG_RAIL_WIDTH },
  iconSlot: {
    width: IG_ICON_SLOT,
    height: IG_ICON_SLOT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconShadow: {
    shadowColor: 'rgba(0,0,0,0.45)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
  },
  railLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  railLabelSpacer: { height: IG_LABEL_SPACER },
  content: { position: 'absolute', left: 14, right: 72, gap: 5, zIndex: 10 },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  handleTap: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '72%' },
  handle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    flexShrink: 1,
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
  inlineFollowText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  productTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  productDescription: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
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
  soundPillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  productPin: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: 2,
    marginBottom: 2,
  },
  productPinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F7F3EE',
    borderRadius: 16,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  productPinMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minHeight: 36,
  },
  productPinIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(166,124,82,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productPinPrice: {
    color: '#1A1A1A',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  productPinBuy: {
    backgroundColor: lightBrown,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  productPinBuyText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  productPinMsg: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
