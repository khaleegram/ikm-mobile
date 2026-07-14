import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
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
import { toggleMarketSave, useIsFollowing, useIsSaved } from '@/lib/firebase/firestore/market-social';
import { usePublicUserProfileOnce } from '@/lib/firebase/firestore/users';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { formatCompactCount } from '@/lib/utils/format-count';
import { haptics } from '@/lib/utils/haptics';
import { ChatBottomSheet } from '@/components/chat/chat-bottom-sheet';
import { isPostgresChatBackend } from '@/lib/config/chat-backend';
import { startPostQuoteChat } from '@/lib/utils/market-ask-price-chat';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import { MarketPost } from '@/types';

const lightBrown = '#A67C52';
const LIKE_RED = '#FF3B55';
const TAB_BAR_CLEARANCE = 88;

/** Instagram Reels rail tokens */
const IG_ICON = 28;
const IG_RAIL_GAP = 16;
const IG_RAIL_WIDTH = 48;
const IG_ICON_SLOT = 32;
const IG_HIT_SLOP = 8;
const IG_LABEL_SPACER = 14;

function LucideIcon({
  name,
  size = IG_ICON,
  color = '#FFFFFF',
  fill = 'none',
}: {
  name: 'Heart' | 'MessageCircle' | 'Bookmark' | 'Send' | 'Ellipsis';
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
}

export const PostOverlay = React.memo(function PostOverlay({
  post,
  likes,
  isLiked,
  onLike,
  onComment,
  onFavorite,
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
  const [chatSheet, setChatSheet] = useState<{ threadId: string; peerId: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [optFollowing, setOptFollowing] = useState<boolean | null>(null);
  const [optSaved, setOptSaved] = useState<boolean | null>(null);
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

  const isFollowing = feedSocialEnabled
    ? posterId
      ? followingIdSet.has(posterId)
      : false
    : hookFollowing;
  const isSaved = feedSocialEnabled ? (postId ? savedIdSet.has(postId) : false) : hookSaved;
  const displayFollowing = optFollowing ?? isFollowing;
  const displaySaved = optSaved ?? isSaved;

  useEffect(() => {
    if (optFollowing !== null && optFollowing === isFollowing) setOptFollowing(null);
  }, [isFollowing, optFollowing]);
  useEffect(() => {
    if (optSaved !== null && optSaved === isSaved) setOptSaved(null);
  }, [isSaved, optSaved]);

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
    const next = !displaySaved;
    setSaveBusy(true);
    haptics.light();
    onFavorite?.();
    toggleMarketSave(user.uid, postId)
      .then(() => setOptSaved(next))
      .catch(() => showToast('Failed to save', 'error'))
      .finally(() => setSaveBusy(false));
  }, [user, saveBusy, postId, displaySaved, onFavorite, promptAuth]);

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
    setOptFollowing(next);
    haptics.light();
    marketSocialApi
      .setFollowState(post.posterId, next)
      .then(() => showToast(next ? 'Following!' : 'Unfollowed.', 'success'))
      .catch((e: any) => {
        setOptFollowing(isFollowing);
        showToast(e?.message || 'Unable to update follow.', 'error');
      });
  }, [post.posterId, user, displayFollowing, isFollowing, promptAuth]);

  const openChat = useCallback(
    (mode: 'ask-price' | 'dm') => {
      void startPostQuoteChat({
        post,
        buyerId: user?.uid || '',
        sellerName: posterName,
        mode,
        marketLoginRoute,
        onOpenChat: isPostgresChatBackend()
          ? ({ threadId, peerId }) => setChatSheet({ threadId, peerId })
          : undefined,
      });
    },
    [post, user?.uid, posterName, marketLoginRoute]
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
                try {
                  haptics.medium();
                  await marketSocialApi.blockUser(post.posterId);
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
      </View>

      <View style={[styles.content, { bottom: bottomClearance + 4 }]}>
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
        {post.description ? (
          <Text style={styles.description} numberOfLines={3}>
            {post.description}
          </Text>
        ) : null}
        {locationText ? (
          <View style={styles.locationRow}>
            <IconSymbol name="location.fill" size={11} color="rgba(255,255,255,0.7)" />
            <Text style={styles.locationText}>{locationText}</Text>
          </View>
        ) : null}
        <View style={styles.ctaRow}>
          {hasPrice ? (
            <>
              <View style={styles.pricePill}>
                <Text style={styles.price}>NGN {Number(post.price).toLocaleString()}</Text>
              </View>
              {!isOwnPost && (
                <>
                  {post.isNegotiable ? (
                    <TouchableOpacity
                      style={[styles.ctaButton, styles.ctaButtonGhost]}
                      onPress={() => void openChat('dm')}
                      activeOpacity={0.75}>
                      <IconSymbol name="message.fill" size={13} color="#FFFFFF" />
                      <Text style={styles.ctaButtonText}>DM</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.ctaButton} onPress={handleBuy} activeOpacity={0.75}>
                    <IconSymbol name="bag.fill" size={13} color="#FFFFFF" />
                    <Text style={styles.ctaButtonText}>Buy</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : !isOwnPost ? (
            <TouchableOpacity
              style={[styles.ctaButton, styles.ctaButtonFull]}
              onPress={() => void openChat('ask-price')}
              activeOpacity={0.75}>
              <Text style={styles.ctaButtonText}>Ask for Price</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <CommentsSheet
        postId={post.id ?? null}
        visible={commentsVisible}
        onClose={() => setCommentsVisible(false)}
        totalComments={post.comments ?? 0}
      />
      <ChatBottomSheet
        visible={Boolean(chatSheet)}
        threadId={chatSheet?.threadId || null}
        peerId={chatSheet?.peerId || null}
        onClose={() => setChatSheet(null)}
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
  prev.post.description === next.post.description &&
  prev.post.price === next.post.price &&
  prev.onLike === next.onLike &&
  prev.onComment === next.onComment &&
  prev.onShare === next.onShare &&
  prev.onFavorite === next.onFavorite
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
    width: 52,
    height: 52,
    borderRadius: 26,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInnerBorder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#000',
    overflow: 'hidden',
  },
  avatar: { width: '100%', height: '100%', borderRadius: 24 },
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
  description: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.4)',
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
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
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
  ctaButtonGhost: { backgroundColor: 'rgba(166,124,82,0.75)' },
  ctaButtonFull: { paddingHorizontal: 22 },
  ctaButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
