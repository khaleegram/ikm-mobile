import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
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
import { updateUserProfile, useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant, getSignupRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { uploadImage } from '@/lib/utils/image-upload';
import { toNameCase } from '@/lib/utils/name-case';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import { getMarketBranding } from '@/lib/market-branding';
import { getMarketPostPrimaryImage } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

const ACCENT = '#A67C52';
const ACCENT_DARK = '#6b4a2e';
const GRID_COLS = 3;
const CELL_GAP = 3;
const H_PAD = 16;
const { width: SCREEN_W } = Dimensions.get('window');
const CELL = Math.floor((SCREEN_W - H_PAD * 2 - CELL_GAP * (GRID_COLS - 1)) / GRID_COLS);

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

function formatNgn(value: number): string {
  return `₦${value.toLocaleString()}`;
}

export default function ProfileScreen() {
  const brand = getMarketBranding();
  const { colors, colorScheme, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid ?? null);
  const { posts, loading: postsLoading } = useUserMarketPosts(user?.uid ?? null);
  const { orders: allOrders, loading: ordersLoading } = useUserOrders(user?.uid ?? null);
  const { orders: sellerOrders, loading: sellerOrdersLoading } = useSellerOrders(user?.uid ?? null);
  const { payouts, loading: payoutsLoading } = useSellerPayouts(user?.uid ?? null);

  const [managedPost, setManagedPost] = useState<MarketPost | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [updatingPhoto, setUpdatingPhoto] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  const isDark = colorScheme === 'dark';

  const displayName = useMemo(() => {
    const raw = String(profile?.displayName || user?.displayName || '').trim();
    return raw ? toNameCase(raw) : user?.email?.split('@')[0] || 'Market User';
  }, [profile?.displayName, user?.displayName, user?.email]);

  const avatarUrl = useMemo(() => String(profile?.storeLogoUrl || '').trim(), [profile?.storeLogoUrl]);
  const initials = useMemo(() => getInitials(displayName), [displayName]);

  const roleLabel = useMemo(() => {
    if (user?.isAdmin) return 'Admin';
    if ((user as any)?.isSeller || profile?.storeName) return 'Seller';
    return 'Buyer';
  }, [profile?.storeName, user?.isAdmin, (user as any)?.isSeller]);

  const balance = useMemo(() => {
    const released = sellerOrders.reduce((sum, o) => {
      const st = String(o.status || '').toLowerCase();
      const es = String((o as any).escrowStatus || '').toLowerCase();
      const ok =
        es === 'released' ||
        Boolean((o as any).fundsReleasedAt) ||
        st === 'completed' ||
        st === 'received';
      return ok ? sum + Number(o.total || 0) : sum;
    }, 0);
    const committed = payouts.reduce((sum, p) => {
      const st = String(p.status || '').toLowerCase();
      return ['pending', 'processing', 'completed'].includes(st)
        ? sum + Number(p.amount || 0)
        : sum;
    }, 0);
    return Math.max(0, released - committed);
  }, [payouts, sellerOrders]);

  // Must be above early returns to keep hook order stable
  const paddedPosts: (MarketPost | null)[] = useMemo(() => {
    if (posts.length === 0) return posts;
    const rem = posts.length % GRID_COLS;
    if (rem === 0) return posts;
    return [...posts, ...Array<null>(GRID_COLS - rem).fill(null)];
  }, [posts]);

  // ── Photo ──────────────────────────────────────────────────────────────────
  const persistPhoto = async (url: string | null) => {
    if (!user?.uid) return;
    await updateDoc(doc(firestore, 'users', user.uid), {
      storeLogoUrl: url,
      updatedAt: serverTimestamp(),
    });
  };

  const pickPhoto = async () => {
    if (!user?.uid || updatingPhoto) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access to update your photo.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      setUpdatingPhoto(true);
      haptics.medium();
      const up = await uploadImage(
        result.assets[0].uri,
        `profile_pictures/${user.uid}/avatar_${Date.now()}.jpg`
      );
      await persistPhoto(up.url);
      haptics.success();
      showToast('Profile photo updated.', 'success');
    } catch (e: any) {
      haptics.error();
      showToast(e?.message || 'Photo update failed.', 'error');
    } finally {
      setUpdatingPhoto(false);
    }
  };

  const promptPhotoOptions = () => {
    haptics.light();
    const opts: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'Change photo', onPress: () => void pickPhoto() },
    ];
    if (avatarUrl) {
      opts.push({
        text: 'Remove photo',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Remove photo?', 'Your profile photo will be removed.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: async () => {
                try {
                  setUpdatingPhoto(true);
                  await persistPhoto(null);
                  showToast('Photo removed.', 'success');
                } catch (e: any) {
                  showToast(e?.message || 'Failed.', 'error');
                } finally {
                  setUpdatingPhoto(false);
                }
              },
            },
          ]),
      });
    }
    opts.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Profile photo', 'Choose an action', opts);
  };

  // ── Bio + Name ─────────────────────────────────────────────────────────────
  const saveBio = async () => {
    if (!user?.uid) return;
    setSavingBio(true);
    haptics.light();
    try {
      await updateUserProfile(user.uid, { bio: bioInput.trim() });
      setEditingBio(false);
      showToast('Bio saved.', 'success');
    } catch {
      haptics.error();
      showToast('Failed to save bio.', 'error');
    } finally {
      setSavingBio(false);
    }
  };

  const saveName = async () => {
    if (!user?.uid) return;
    const val = nameInput.trim();
    if (!val) {
      showToast('Name cannot be empty.', 'error');
      return;
    }
    setSavingName(true);
    haptics.light();
    try {
      await updateUserProfile(user.uid, { displayName: toNameCase(val) });
      setEditingName(false);
      showToast('Name updated.', 'success');
    } catch {
      haptics.error();
      showToast('Failed to update name.', 'error');
    } finally {
      setSavingName(false);
    }
  };

  // ── Post management ────────────────────────────────────────────────────────
  const openManage = (post: MarketPost) => {
    haptics.light();
    setManagedPost(post);
  };
  const closeManage = () => setManagedPost(null);

  const handleEditPost = () => {
    if (!managedPost?.id) return;
    closeManage();
    router.push(`/(market)/post-edit/${managedPost.id}` as any);
  };

  const handleSharePost = async () => {
    if (!managedPost) return;
    try {
      await shareMarketPost(managedPost);
    } catch {
      showToast('Cannot share right now.', 'error');
    } finally {
      closeManage();
    }
  };

  const confirmDelete = () => {
    if (!managedPost?.id || deletingPostId) return;
    Alert.alert('Delete post', brand.deletePostMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeletingPostId(managedPost.id!);
            await marketPostsApi.delete(managedPost.id!);
            haptics.success();
            showToast('Post deleted.', 'success');
          } catch (e: any) {
            haptics.error();
            showToast(e?.message || 'Delete failed.', 'error');
          } finally {
            setDeletingPostId(null);
            closeManage();
          }
        },
      },
    ]);
  };

  // ── Guest ──────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" translucent />
        <LinearGradient
          colors={[ACCENT, ACCENT_DARK]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.guestCover, { paddingTop: insets.top + 14 }]}>
          <View>
            <Text style={styles.guestBrandLine}>{brand.headerLine}</Text>
            <Text style={styles.guestBrandTitle}>Profile</Text>
          </View>
          <View style={styles.guestAvatarWrap}>
            <IconSymbol name="person.fill" size={52} color="rgba(255,255,255,0.55)" />
          </View>
        </LinearGradient>

        <View
          style={[
            styles.guestBody,
            { paddingHorizontal: H_PAD + 4, paddingBottom: insets.bottom + 100 },
          ]}>
          <Text style={[styles.guestTitle, { color: colors.text }]}>
            Join {brand.proseName}
          </Text>
          <Text style={[styles.guestSub, { color: colors.textSecondary }]}>
            Create an account to post items, manage listings and connect with buyers.
          </Text>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: ACCENT }]}
            activeOpacity={0.85}
            onPress={() => {
              haptics.light();
              router.push(getLoginRouteForVariant('market') as any);
            }}>
            <Text style={styles.primaryBtnText}>Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.outlineBtn, { borderColor: ACCENT }]}
            activeOpacity={0.85}
            onPress={() => {
              haptics.light();
              router.push(getSignupRouteForVariant('market') as any);
            }}>
            <Text style={[styles.outlineBtnText, { color: ACCENT }]}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (profileLoading) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  // ── Compact sticky overlay (position:absolute, fades in when scrolled) ────
  // ── Scrollable header (avatar + info + CTA + balance + posts heading) ──────
  const renderHeader = () => (
    <View>
      {/* Avatar */}
      <View style={styles.avatarFloat}>
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={promptPhotoOptions}
          disabled={updatingPhoto}
          style={[styles.avatarRing, { borderColor: colors.background }]}>
          <View style={[styles.avatarCircle, { backgroundColor: `${ACCENT}28` }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            ) : (
              <Text style={[styles.avatarInitials, { color: ACCENT }]}>{initials || '?'}</Text>
            )}
            {updatingPhoto && (
              <View style={[StyleSheet.absoluteFill, styles.avatarLoader]}>
                <ActivityIndicator size="small" color="#FFF" />
              </View>
            )}
          </View>
          <View style={[styles.cameraBadge, { backgroundColor: ACCENT, borderColor: colors.background }]}>
            <IconSymbol name="camera.fill" size={11} color="#FFF" />
          </View>
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={[styles.infoSection, { paddingHorizontal: H_PAD }]}>
        {editingName ? (
          <View style={[styles.nameEditBox, { borderColor: ACCENT, backgroundColor: colors.backgroundSecondary }]}>
            <TextInput
              style={[styles.nameEditInput, { color: colors.text }]}
              value={nameInput}
              onChangeText={setNameInput}
              maxLength={40}
              autoFocus
              placeholder="Your name"
              placeholderTextColor={colors.textSecondary}
              editable={!savingName}
              returnKeyType="done"
              onSubmitEditing={() => void saveName()}
              textAlign="center"
            />
            <View style={styles.nameEditBtns}>
              <TouchableOpacity onPress={() => setEditingName(false)} disabled={savingName}>
                <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: ACCENT }]} onPress={() => void saveName()} disabled={savingName}>
                {savingName ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.nameRow} activeOpacity={0.7} onPress={() => { setNameInput(displayName); setEditingName(true); }}>
            <Text style={[styles.displayName, { color: colors.text }]} numberOfLines={1}>{displayName}</Text>
            <View style={[styles.editBadge, { backgroundColor: `${ACCENT}1A` }]}>
              <IconSymbol name="pencil" size={12} color={ACCENT} />
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.metaRow}>
          <View style={[styles.roleChip, { backgroundColor: `${ACCENT}18` }]}>
            <IconSymbol name="checkmark.seal.fill" size={12} color={ACCENT} />
            <Text style={[styles.roleText, { color: ACCENT }]}>{roleLabel}</Text>
          </View>
          {user.email ? (
            <Text style={[styles.emailText, { color: colors.textSecondary }]} numberOfLines={1}>{user.email}</Text>
          ) : null}
        </View>

        {editingBio ? (
          <View style={[styles.bioBox, { borderColor: ACCENT, backgroundColor: colors.backgroundSecondary }]}>
            <TextInput
              style={[styles.bioInput, { color: colors.text }]}
              multiline maxLength={150} autoFocus
              value={bioInput}
              onChangeText={setBioInput}
              placeholder="Write something about yourself..."
              placeholderTextColor={colors.textSecondary}
              editable={!savingBio}
              textAlignVertical="top"
            />
            <View style={styles.bioFooter}>
              <Text style={[styles.bioCounter, { color: bioInput.length >= 140 ? colors.error : colors.textSecondary }]}>
                {bioInput.length}/150
              </Text>
              <View style={styles.bioBtnRow}>
                <TouchableOpacity onPress={() => setEditingBio(false)} disabled={savingBio}>
                  <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: ACCENT }]} onPress={() => void saveBio()} disabled={savingBio}>
                  {savingBio ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.saveBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.bioDisplay} activeOpacity={0.7} onPress={() => { setBioInput(profile?.bio || ''); setEditingBio(true); }}>
            {profile?.bio ? (
              <Text style={[styles.bioText, { color: colors.text }]}>{profile.bio}</Text>
            ) : (
              <View style={styles.bioEmptyRow}>
                <IconSymbol name="plus.circle" size={14} color={ACCENT} />
                <Text style={[styles.bioEmpty, { color: ACCENT }]}>Add a bio</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Stats row */}
        <View style={[styles.statsRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statVal, { color: colors.text }]}>{postsLoading ? '—' : posts.length}</Text>
            <Text style={[styles.statLbl, { color: colors.textSecondary }]}>Posts</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statVal, { color: colors.text }]}>{profile?.followerCount ?? 0}</Text>
            <Text style={[styles.statLbl, { color: colors.textSecondary }]}>Followers</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <TouchableOpacity style={styles.statItem} activeOpacity={0.7} onPress={() => { haptics.light(); router.push('/(market)/following' as any); }}>
            <Text style={[styles.statVal, { color: colors.text }]}>{profile?.followingCount ?? 0}</Text>
            <Text style={[styles.statLbl, { color: ACCENT }]}>Following ›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* CTA + balance card */}
      <View style={[styles.ctaWrapper, { paddingHorizontal: H_PAD }]}>
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={[styles.ctaPrimary, { backgroundColor: ACCENT }]}
            activeOpacity={0.85}
            onPress={() => { haptics.light(); router.push('/(market)/create-post' as any); }}>
            <IconSymbol name="plus" size={15} color="#FFF" />
            <Text style={styles.ctaPrimaryText}>New Post</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctaSecondary, { borderColor: colors.border, backgroundColor: colors.card }]}
            activeOpacity={0.85}
            onPress={() => { haptics.light(); router.push('/(market)/orders' as any); }}>
            <IconSymbol name="shippingbox.fill" size={15} color={colors.text} />
            <Text style={[styles.ctaSecondaryText, { color: colors.text }]}>
              {ordersLoading ? brand.ordersNavLabel : `Orders${allOrders.length > 0 ? ` (${allOrders.length})` : ''}`}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.balanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.balanceLeft}>
            <Text style={[styles.balanceLabel, { color: ACCENT }]}>Available balance</Text>
            <Text style={[styles.balanceAmount, { color: colors.text }]}>
              {sellerOrdersLoading || payoutsLoading ? '···' : formatNgn(balance)}
            </Text>
            <Text style={[styles.balanceSub, { color: colors.textSecondary }]}>Released escrow earnings</Text>
          </View>
          <TouchableOpacity
            style={[styles.withdrawBtn, { backgroundColor: ACCENT }]}
            activeOpacity={0.85}
            onPress={() => { haptics.light(); router.push('/(market)/payouts' as any); }}>
            <IconSymbol name="arrow.up.circle.fill" size={15} color="#FFF" />
            <Text style={styles.withdrawBtnText}>Withdraw</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Posts heading */}
      <View style={[styles.postsTitleRow, { paddingHorizontal: H_PAD, marginTop: 14, marginBottom: 10 }]}>
        <IconSymbol name="square.grid.2x2.fill" size={16} color={ACCENT} />
        <Text style={[styles.postsTitleText, { color: colors.text }]}>My Posts</Text>
        <Text style={[styles.postsCountText, { color: colors.textSecondary }]}>
          {postsLoading ? '' : `${posts.length} listed`}
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border, marginHorizontal: H_PAD }]} />
    </View>
  );

  // ── Grid cell ──────────────────────────────────────────────────────────────
  const renderCell = ({ item, index }: { item: MarketPost | null; index: number }) => {
    if (!item) {
      const col = index % GRID_COLS;
      return (
        <View style={{ width: CELL, height: CELL, marginLeft: col === 0 ? 0 : CELL_GAP }} />
      );
    }
    const col = index % GRID_COLS;
    const thumb = getMarketPostPrimaryImage(item) || item.images?.[0] || '';
    const hasPrice = typeof item.price === 'number' && item.price > 0;
    return (
      <TouchableOpacity
        activeOpacity={0.88}
        style={[styles.cell, { width: CELL, height: CELL, marginLeft: col === 0 ? 0 : CELL_GAP }]}
        onPress={() => item.id && router.push(`/(market)/post-view/${item.id}` as any)}
        onLongPress={() => openManage(item)}>
        <Image
          source={{ uri: thumb }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          placeholder={{ blurhash: 'L3BWWB~q00ay00WV00j[_4WV00WV' }}
        />
        {/* gradient overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.60)']}
          style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}
          pointerEvents="none"
        />
        {/* price badge */}
        {hasPrice && (
          <View style={styles.priceBadge}>
            <Text style={styles.priceBadgeText} numberOfLines={1}>
              ₦{Number(item.price).toLocaleString()}
            </Text>
          </View>
        )}
        {/* manage button */}
        <TouchableOpacity
          style={styles.cellManageBtn}
          onPress={() => openManage(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <IconSymbol name="ellipsis" size={13} color="#FFF" />
        </TouchableOpacity>
        {/* likes + comments mini bar */}
        <View style={styles.cellStats}>
          <View style={styles.cellStatItem}>
            <IconSymbol name="heart.fill" size={9} color="rgba(255,255,255,0.8)" />
            <Text style={styles.cellStatText}>{item.likes || 0}</Text>
          </View>
          <View style={styles.cellStatItem}>
            <IconSymbol name="message.fill" size={9} color="rgba(255,255,255,0.8)" />
            <Text style={styles.cellStatText}>{item.comments || 0}</Text>
          </View>
        </View>
        {/* deleting overlay */}
        {deletingPostId === item.id && (
          <View style={[StyleSheet.absoluteFill, styles.deletingOverlay]}>
            <ActivityIndicator size="small" color="#FFF" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Fixed island app bar */}
      <View style={[styles.islandHeader, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        {/* Island pill — brand text left, mode toggle right (inside pill) */}
        <TouchableOpacity
          style={[styles.nameIsland, styles.nameIslandRow, { backgroundColor: ACCENT }]}
          activeOpacity={0.85}
          onPress={() => { haptics.light(); toggleTheme(); }}>
          <View>
            <Text style={styles.islandLabel}>{brand.headerLine}</Text>
            <Text style={styles.islandTitle}>Profile</Text>
          </View>
          <IconSymbol
            name={isDark ? 'sun.max.fill' : 'moon.fill'}
            size={18}
            color="rgba(255,255,255,0.85)"
          />
        </TouchableOpacity>

        {/* Settings — outside right */}
        <TouchableOpacity
          style={styles.settingsPill}
          activeOpacity={0.75}
          onPress={() => { haptics.light(); router.push('/(market)/settings' as any); }}>
          <IconSymbol name="gearshape.fill" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={paddedPosts}
        renderItem={renderCell}
        keyExtractor={(item, i) => (item ? item.id || `post-${i}` : `pad-${i}`)}
        numColumns={GRID_COLS}
        ListHeaderComponent={renderHeader()}
        ListEmptyComponent={
          postsLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={ACCENT} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: `${ACCENT}18` }]}>
                <IconSymbol name="camera.fill" size={30} color={ACCENT} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing listed yet</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                Tap "New Post" above to list your first item.
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: ACCENT }]}
                onPress={() => { haptics.light(); router.push('/(market)/create-post' as any); }}>
                <IconSymbol name="plus" size={14} color="#FFF" />
                <Text style={styles.emptyBtnText}>Create First Post</Text>
              </TouchableOpacity>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        columnWrapperStyle={
          paddedPosts.length > 0
            ? { paddingHorizontal: H_PAD, gap: CELL_GAP, marginBottom: CELL_GAP }
            : undefined
        }
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
      />

      <PostManageSheet
        visible={managedPost != null}
        onClose={closeManage}
        onEdit={handleEditPost}
        onShare={handleSharePost}
        onDelete={confirmDelete}
        deleting={Boolean(deletingPostId && deletingPostId === managedPost?.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },

  // ── Floating island header (mirrors settings screen) ──────────────────────
  islandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: H_PAD,
    marginBottom: 4,
  },
  nameIsland: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  nameIslandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  islandLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginBottom: 2,
  },
  islandTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  settingsPill: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── CTA wrapper (inside collapsible animated section) ────────────────────
  ctaWrapper: {
    paddingTop: 8,
    paddingBottom: 4,
  },

  // ── Avatar ─────────────────────────────────────────────────────────────────
  avatarFloat: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  avatarRing: {
    padding: 3,
    borderRadius: 48,
    borderWidth: 3,
  },
  avatarCircle: {
    width: 80,    // was 100
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInitials: {
    fontSize: 28,   // was 36
    fontWeight: '800',
  },
  avatarLoader: {
    backgroundColor: 'rgba(0,0,0,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Info section ───────────────────────────────────────────────────────────
  infoSection: {
    alignItems: 'center',
    marginBottom: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 4,  // was 6
  },
  displayName: {
    fontSize: 20,   // was 23
    fontWeight: '800',
    textAlign: 'center',
    flexShrink: 1,
  },
  editBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameEditBox: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  nameEditInput: {
    fontSize: 19,
    fontWeight: '700',
    paddingVertical: 2,
  },
  nameEditBtns: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 10,
  },

  // ── Shared inline edit controls ────────────────────────────────────────────
  cancelText: {
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  saveBtn: {
    paddingHorizontal: 22,
    paddingVertical: 7,
    borderRadius: 10,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },

  // ── Meta row ───────────────────────────────────────────────────────────────
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 8,  // was 12
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emailText: {
    fontSize: 12,
  },

  // ── Bio ────────────────────────────────────────────────────────────────────
  bioDisplay: {
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 10,  // was 16
    minHeight: 22,
  },
  bioText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  bioEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bioEmpty: {
    fontSize: 14,
    fontWeight: '600',
  },
  bioBox: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  bioInput: {
    fontSize: 14,
    lineHeight: 20,
    minHeight: 60,
  },
  bioFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  bioCounter: {
    fontSize: 11,
    fontWeight: '600',
  },
  bioBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  // ── Stats row ──────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 10,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,  // was 14
  },
  statVal: {
    fontSize: 19,   // was 22
    fontWeight: '800',
  },
  statLbl: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,  // was 38
    opacity: 0.6,
  },

  // ── CTA row ────────────────────────────────────────────────────────────────
  ctaRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginBottom: 6,
  },
  ctaPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 14,
    borderRadius: 16,
  },
  ctaPrimaryText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  ctaSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  ctaSecondaryText: {
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Balance card ───────────────────────────────────────────────────────────
  balanceCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceLeft: {
    flex: 1,
    marginRight: 12,
  },
  balanceLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  balanceAmount: {
    fontSize: 26,
    fontWeight: '800',
    marginTop: 3,
    marginBottom: 2,
  },
  balanceSub: {
    fontSize: 11,
  },
  withdrawBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
  },
  withdrawBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },

  // ── Posts heading ──────────────────────────────────────────────────────────
  postsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  postsTitleText: {
    fontSize: 17,
    fontWeight: '800',
    flex: 1,
  },
  postsCountText: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginBottom: 10,
    opacity: 0.5,
  },

  // ── Grid cell ──────────────────────────────────────────────────────────────
  cell: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
  },
  priceBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.60)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: '80%',
  },
  priceBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  cellManageBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellStats: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    gap: 3,
    alignItems: 'flex-end',
  },
  cellStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  cellStatText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 9,
    fontWeight: '700',
  },
  deletingOverlay: {
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: H_PAD + 8,
    gap: 8,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 8,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  emptyBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },

  // ── Guest ──────────────────────────────────────────────────────────────────
  guestCover: {
    paddingHorizontal: H_PAD,
    paddingBottom: 56,
    alignItems: 'center',
  },
  guestBrandLine: {
    color: 'rgba(255,255,255,0.60)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    alignSelf: 'flex-start',
  },
  guestBrandTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    alignSelf: 'flex-start',
    marginBottom: 24,
  },
  guestAvatarWrap: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: 'rgba(255,255,255,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestBody: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 28,
  },
  guestTitle: {
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  guestSub: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 28,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  outlineBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  outlineBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
