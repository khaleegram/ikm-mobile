import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { PostManageSheet } from '@/components/market/post-manage-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { marketPostsApi } from '@/lib/api/market-posts';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useUserMarketPosts } from '@/lib/firebase/firestore/market-posts';
import { useSellerOrders, useUserOrders } from '@/lib/firebase/firestore/orders';
import { useSellerPayouts } from '@/lib/firebase/firestore/payouts';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant, getSignupRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { uploadImage } from '@/lib/utils/image-upload';
import { toNameCase } from '@/lib/utils/name-case';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import { MarketPost } from '@/types';

const lightBrown = '#A67C52';

function getInitials(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

function formatPostDate(value: unknown): string {
  if (!value) return 'Just now';
  const date =
    value instanceof Date ? value : typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : null;
  if (!date || Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatAmount(value: number): string {
  return `NGN ${value.toLocaleString()}`;
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid ?? null);
  const { posts, loading: postsLoading } = useUserMarketPosts(user?.uid ?? null);
  const { orders: marketOrders, loading: marketOrdersLoading } = useUserOrders(user?.uid ?? null);
  const { orders: sellerOrders, loading: sellerOrdersLoading } = useSellerOrders(user?.uid ?? null);
  const { payouts, loading: payoutsLoading } = useSellerPayouts(user?.uid ?? null);

  const [managedPost, setManagedPost] = useState<MarketPost | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [updatingProfilePhoto, setUpdatingProfilePhoto] = useState(false);

  const displayName = useMemo(() => {
    const rawName = String(profile?.displayName || user?.displayName || '').trim();
    if (rawName) return toNameCase(rawName);
    return user?.email || 'Market User';
  }, [profile?.displayName, user?.displayName, user?.email]);
  const profilePhotoUrl = useMemo(() => String(profile?.storeLogoUrl || '').trim(), [profile?.storeLogoUrl]);
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const roleLabel = useMemo(() => {
    if (user?.isAdmin) return 'Administrator';
    if (user?.isSeller || profile?.storeName) return 'Seller and Buyer';
    return 'Market User';
  }, [profile?.storeName, user?.isAdmin, user?.isSeller]);
  const marketOrdersCount = useMemo(() => marketOrders.length, [marketOrders.length]);
  const availableWithdrawableBalance = useMemo(() => {
    const eligibleReleasedAmount = sellerOrders.reduce((sum, order) => {
      const status = String(order.status || '').toLowerCase();
      const escrowStatus = String(order.escrowStatus || '').toLowerCase();
      const hasReleasedSignal =
        escrowStatus === 'released' ||
        Boolean(order.fundsReleasedAt) ||
        status === 'completed' ||
        status === 'received';
      const amount = Number(order.total || 0);
      return hasReleasedSignal && Number.isFinite(amount) ? sum + amount : sum;
    }, 0);

    const committedPayoutAmount = payouts.reduce((sum, payout) => {
      const status = String(payout.status || '').toLowerCase();
      const shouldReserve = status === 'pending' || status === 'processing' || status === 'completed';
      const amount = Number(payout.amount || 0);
      return shouldReserve && Number.isFinite(amount) ? sum + amount : sum;
    }, 0);

    return Math.max(0, eligibleReleasedAmount - committedPayoutAmount);
  }, [payouts, sellerOrders]);

  const handleRoutePress = (path: string) => {
    haptics.light();
    router.push(path as any);
  };

  const persistProfilePhoto = async (nextUrl: string | null) => {
    if (!user?.uid) return;
    await updateDoc(doc(firestore, 'users', user.uid), {
      storeLogoUrl: nextUrl,
      updatedAt: serverTimestamp(),
    });
  };

  const handleSetNewProfilePic = async () => {
    if (!user?.uid || updatingProfilePhoto) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow photo access to update your profile picture.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
      });

      if (result.canceled || !result.assets[0]?.uri) return;

      setUpdatingProfilePhoto(true);
      haptics.medium();

      const uploadPath = `profile_pictures/${user.uid}/avatar_${Date.now()}.jpg`;
      const uploaded = await uploadImage(result.assets[0].uri, uploadPath);
      await persistProfilePhoto(uploaded.url);

      haptics.success();
      showToast('Profile picture updated.', 'success');
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Failed to update profile picture.', 'error');
    } finally {
      setUpdatingProfilePhoto(false);
    }
  };

  const handleRemoveProfilePic = async () => {
    if (!user?.uid || updatingProfilePhoto) return;
    try {
      setUpdatingProfilePhoto(true);
      haptics.light();
      await persistProfilePhoto(null);
      showToast('Profile picture removed.', 'success');
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Failed to remove profile picture.', 'error');
    } finally {
      setUpdatingProfilePhoto(false);
    }
  };

  const openProfilePhotoOptions = () => {
    haptics.light();
    const buttons: { text: string; style?: 'cancel' | 'destructive' | 'default'; onPress?: () => void }[] = [
      { text: 'Set New Profile Pic', onPress: () => void handleSetNewProfilePic() },
    ];

    if (profilePhotoUrl) {
      buttons.push({
        text: 'Remove Profile Pic',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Remove Profile Picture', 'Do you want to remove your profile picture?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => void handleRemoveProfilePic() },
          ]),
      });
    }

    buttons.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert('Profile Picture', 'Choose an action', buttons);
  };

  const openManageSheet = (post: MarketPost) => {
    haptics.light();
    setManagedPost(post);
  };

  const closeManageSheet = () => {
    setManagedPost(null);
  };

  const handleEditPost = () => {
    if (!managedPost?.id) return;
    closeManageSheet();
    router.push(`/(market)/post-edit/${managedPost.id}` as any);
  };

  const handleSharePost = async () => {
    if (!managedPost) return;
    try {
      await shareMarketPost(managedPost);
    } catch {
      showToast('Unable to open share options right now.', 'error');
    } finally {
      closeManageSheet();
    }
  };

  const confirmDeletePost = () => {
    if (!managedPost?.id || deletingPostId) return;

    Alert.alert('Delete Post', 'This will permanently remove this post from Market Street.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeletingPostId(managedPost.id!);
            await marketPostsApi.delete(managedPost.id!);
            haptics.success();
            showToast('Post deleted successfully.', 'success');
          } catch (error: any) {
            haptics.error();
            showToast(error?.message || 'Failed to delete post.', 'error');
          } finally {
            setDeletingPostId(null);
            closeManageSheet();
          }
        },
      },
    ]);
  };

  const renderGuestState = () => {
    return (
      <View style={[styles.guestContainer, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 96 }]}>
        <View style={[styles.headerIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.headerLabel}>MARKET STREET</Text>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        <View style={[styles.guestCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.guestAvatar, { backgroundColor: `${lightBrown}1E` }]}>
            <IconSymbol name="person.circle.fill" size={72} color={lightBrown} />
          </View>
          <Text style={[styles.guestTitle, { color: colors.text }]}>Create your account</Text>
          <Text style={[styles.guestSubtitle, { color: colors.textSecondary }]}>
            Sign in to post items, manage listings, and talk with buyers.
          </Text>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: lightBrown }]}
            onPress={() => handleRoutePress(getLoginRouteForVariant('market'))}>
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: lightBrown }]}
            onPress={() => handleRoutePress(getSignupRouteForVariant('market'))}>
            <Text style={[styles.secondaryButtonText, { color: lightBrown }]}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerWrapper}>
      <View style={styles.headerRow}>
        <View style={[styles.headerIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.headerLabel}>MARKET STREET</Text>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
        <TouchableOpacity
          style={[styles.settingsButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => handleRoutePress('/(market)/settings')}>
          <IconSymbol name="gearshape.fill" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.profileTopRow}>
          <View style={styles.avatarWrap}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={openProfilePhotoOptions}
              disabled={updatingProfilePhoto}
              style={[styles.avatar, { backgroundColor: `${lightBrown}1E` }]}>
              {profilePhotoUrl ? (
                <Image source={{ uri: profilePhotoUrl }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <Text style={[styles.avatarText, { color: lightBrown }]}>{initials || 'MU'}</Text>
              )}
              {updatingProfilePhoto ? (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : null}
            </TouchableOpacity>

            <View style={styles.avatarAddBadge}>
              <IconSymbol name="plus" size={13} color="#FFFFFF" />
            </View>
          </View>
          <View style={styles.profileMeta}>
            <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]} numberOfLines={1}>
              {user?.email || 'No email'}
            </Text>
            <View style={[styles.roleChip, { backgroundColor: `${lightBrown}20` }]}>
              <IconSymbol name="checkmark.circle.fill" size={14} color={lightBrown} />
              <Text style={[styles.roleChipText, { color: lightBrown }]}>{roleLabel}</Text>
            </View>
          </View>
          <View
            style={[
              styles.profilePostsCard,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.profilePostsLabel, { color: colors.textSecondary }]}>Posts</Text>
            <Text style={[styles.profilePostsValue, { color: colors.text }]}>
              {postsLoading ? '...' : posts.length}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.withdrawCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.withdrawLabel, { color: colors.textSecondary }]}>Available balance</Text>
        <View style={styles.withdrawActionRow}>
          <Text style={[styles.withdrawAmount, { color: colors.text }]}>
            {sellerOrdersLoading || payoutsLoading ? '...' : formatAmount(availableWithdrawableBalance)}
          </Text>
          <TouchableOpacity
            style={[styles.withdrawButton, { backgroundColor: lightBrown }]}
            onPress={() => handleRoutePress('/(market)/payouts')}>
            <Text style={styles.withdrawButtonText}>Withdraw</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.splitActionRow}>
        <TouchableOpacity
          style={[styles.splitActionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => handleRoutePress('/(market)/orders')}>
          <View style={styles.splitActionTop}>
            <IconSymbol name="shippingbox.fill" size={17} color={colors.text} />
            <Text style={[styles.splitActionTitle, { color: colors.text }]}>Market Orders</Text>
          </View>
          <Text style={[styles.splitActionMeta, { color: colors.textSecondary }]}>
            {marketOrdersLoading ? 'Loading...' : `${marketOrdersCount} orders`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.splitActionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => handleRoutePress('/(market)/delivery-settings')}>
          <View style={styles.splitActionTop}>
            <IconSymbol name="location.fill" size={17} color={colors.text} />
            <Text style={[styles.splitActionTitle, { color: colors.text }]}>Delivery Settings</Text>
          </View>
          <Text style={[styles.splitActionMeta, { color: colors.textSecondary }]}>
            Saved address and city
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.postsSectionHeader}>
        <Text style={[styles.postsSectionTitle, { color: colors.text }]}>Your Posts</Text>
        <Text style={[styles.postsSectionHint, { color: colors.textSecondary }]}>
          Tap a post to open comments. Use the 3 dots to manage.
        </Text>
      </View>
    </View>
  );

  const renderPostItem = ({ item }: { item: MarketPost }) => {
    const priceLabel = item.price && item.price > 0 ? formatAmount(item.price) : 'Ask for price';
    const descriptionLabel = item.description?.trim() || 'No caption yet';
    const imageUri = item.images?.[0] || '';

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.postCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => {
          if (!item.id) return;
          router.push(`/(market)/post/${item.id}` as any);
        }}>
        <Image source={{ uri: imageUri }} style={styles.postImage} contentFit="cover" />

        <View style={styles.postContent}>
          <View style={styles.postTopRow}>
            <Text style={[styles.postPrice, { color: colors.text }]} numberOfLines={1}>
              {priceLabel}
            </Text>
            <TouchableOpacity
              style={[styles.manageButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => openManageSheet(item)}>
              <IconSymbol name="ellipsis" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.postDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {descriptionLabel}
          </Text>

          <View style={styles.postMetaRow}>
            <View style={styles.metaItem}>
              <IconSymbol name="heart.fill" size={13} color={lightBrown} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{item.likes || 0}</Text>
            </View>
            <View style={styles.metaItem}>
              <IconSymbol name="message.fill" size={13} color={lightBrown} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{item.comments || 0}</Text>
            </View>
            <View style={styles.metaItem}>
              <IconSymbol name="eye.fill" size={13} color={lightBrown} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{item.views || 0}</Text>
            </View>
            <Text style={[styles.postDate, { color: colors.textSecondary }]}>
              {formatPostDate(item.createdAt)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingHorizontal: 20 }]}>
        {renderGuestState()}
      </View>
    );
  }

  if (profileLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={posts}
        renderItem={renderPostItem}
        keyExtractor={(item, index) => item.id || `post-${index}`}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          postsLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={lightBrown} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <IconSymbol name="photo.fill" size={26} color={lightBrown} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No posts yet</Text>
              <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                Your published posts will appear here.
              </Text>
            </View>
          )
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 110, paddingHorizontal: 20 },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
      />

      <PostManageSheet
        visible={managedPost != null}
        onClose={closeManageSheet}
        onEdit={handleEditPost}
        onShare={handleSharePost}
        onDelete={confirmDeletePost}
        deleting={Boolean(deletingPostId && deletingPostId === managedPost?.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    flexGrow: 1,
  },
  headerWrapper: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  headerIsland: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    paddingBottom: 18,
    marginBottom: 12,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: {
    width: 74,
    alignItems: 'center',
    position: 'relative',
  },
  avatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 27,
    fontWeight: '800',
  },
  avatarAddBadge: {
    position: 'absolute',
    left: '50%',
    bottom: -7,
    transform: [{ translateX: -11 }],
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: lightBrown,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileMeta: {
    flex: 1,
  },
  profilePostsCard: {
    width: 86,
    minHeight: 62,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  profilePostsLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  profilePostsValue: {
    marginTop: 4,
    fontSize: 19,
    fontWeight: '800',
  },
  profileName: {
    fontSize: 21,
    fontWeight: '800',
  },
  profileEmail: {
    marginTop: 2,
    fontSize: 13,
  },
  roleChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  withdrawCard: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  withdrawLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  withdrawActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 10,
  },
  withdrawAmount: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
  },
  withdrawButton: {
    minHeight: 34,
    minWidth: 90,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  withdrawButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  splitActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  splitActionCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 74,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  splitActionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  splitActionTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  splitActionMeta: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
  },
  postsSectionHeader: {
    marginBottom: 10,
  },
  postsSectionTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  postsSectionHint: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  postCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    gap: 10,
  },
  postImage: {
    width: 98,
    height: 98,
    borderRadius: 11,
  },
  postContent: {
    flex: 1,
  },
  postTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  postPrice: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  manageButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postDescription: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    minHeight: 36,
  },
  postMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    fontWeight: '700',
  },
  postDate: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyState: {
    borderRadius: 16,
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: '700',
  },
  emptyHint: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  guestContainer: {
    flex: 1,
    gap: 14,
  },
  guestCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
  },
  guestAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  guestTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  guestSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 22,
  },
  primaryButton: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '800',
  },
});
