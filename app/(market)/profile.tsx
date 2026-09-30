import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { PostManageSheet } from '@/components/market/post-manage-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';
import { showToast } from '@/components/toast';
import { marketPostsApi } from '@/lib/api/market-posts';
import { usersApi } from '@/lib/api/users-api';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useUserMarketPosts } from '@/lib/hooks/use-market-post';
import { useUserOrders } from '@/lib/hooks/use-order';
import { useSellerPayouts } from '@/lib/firebase/firestore/payouts';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import {
  avatarUriFromProfile,
  displayNameFromProfile,
  useUserIdentity,
} from '@/lib/hooks/use-user-identity';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant, getSignupRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { buildUserMediaPath } from '@/lib/utils/media-path';
import { uploadImage } from '@/lib/utils/image-upload';
import { toNameCase } from '@/lib/utils/name-case';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import { getMarketBranding } from '@/lib/market-branding';
import { getMarketPostPrimaryImage } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';
import { Alert } from '@/components/app-alert';

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
  const { user: firestoreProfile } = useUserProfile(user?.uid ?? null);
  const { user: identity, publicUser } = useUserIdentity(user?.uid ?? null);
  const { posts, loading: postsLoading, error: postsError, refetch: refetchPosts } = useUserMarketPosts(
    user?.uid ?? null
  );
  const { orders: allOrders, loading: ordersLoading } = useUserOrders(user?.uid ?? null);
  const { orders: sellerOrders, loading: sellerOrdersLoading } = useUserOrders(user?.uid ?? null, 'seller');
  const { payouts, loading: payoutsLoading } = useSellerPayouts(user?.uid ?? null);

  useFocusEffect(
    useCallback(() => {
      void refetchPosts();
    }, [refetchPosts])
  );

  const [managedPost, setManagedPost] = useState<MarketPost | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [updatingPhoto, setUpdatingPhoto] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const bioMigratedRef = useRef(false);

  const isDark = colorScheme === 'dark';

  const displayName = useMemo(() => {
    const fromIdentity = displayNameFromProfile(identity, '');
    const raw = String(fromIdentity || firestoreProfile?.displayName || user?.displayName || '').trim();
    return raw ? toNameCase(raw) : user?.email?.split('@')[0] || 'Market User';
  }, [firestoreProfile?.displayName, identity, user?.displayName, user?.email]);

  const avatarUrl = useMemo(
    () =>
      avatarUriFromProfile(identity) ||
      String(firestoreProfile?.storeLogoUrl || '').trim() ||
      '',
    [firestoreProfile?.storeLogoUrl, identity]
  );
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const profileBio = String(identity?.bio || publicUser?.bio || '').trim();

  const roleLabel = useMemo(() => {
    if (user?.isAdmin) return 'Admin';
    if ((user as any)?.isSeller || identity?.storeName || firestoreProfile?.storeName) return 'Seller';
    return 'Buyer';
  }, [firestoreProfile?.storeName, identity?.storeName, user?.isAdmin, (user as any)?.isSeller]);

  // One-time: copy Firestore bio into Neon when market identity has none yet.
  useEffect(() => {
    if (!user?.uid || bioMigratedRef.current || !identity) return;
    if (String(identity.bio || '').trim()) {
      bioMigratedRef.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'users', user.uid));
        const legacyBio = String(snap.data()?.bio || '').trim();
        if (!legacyBio || cancelled) {
          bioMigratedRef.current = true;
          return;
        }
        await usersApi.updateMe({ bio: legacyBio.slice(0, 150) });
      } catch {
        // ignore — seller page will stay empty until user re-saves bio
      } finally {
        if (!cancelled) bioMigratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, user?.uid]);

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

  const openSellerOrders = useMemo(() => {
    return sellerOrders.filter((o) => {
      const st = String(o.status || '').toLowerCase();
      return !['completed', 'cancelled', 'canceled'].includes(st);
    }).length;
  }, [sellerOrders]);

  const followerCount = Number(identity?.followerCount ?? firestoreProfile?.followerCount ?? 0);
  const followingCount = Number(identity?.followingCount ?? firestoreProfile?.followingCount ?? 0);

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
    try {
      await usersApi.updateMe({ storeLogoUrl: url, avatarUrl: url });
    } catch {
      // Fall back for seller/admin profile fields still on Firestore.
      await updateDoc(doc(firestore, 'users', user.uid), {
        storeLogoUrl: url,
        updatedAt: serverTimestamp(),
      });
    }
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
        buildUserMediaPath('profile_pictures', user.uid, `avatar_${Date.now()}.jpg`)
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
      await usersApi.updateMe({ bio: bioInput.trim().slice(0, 150) || null });
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
      const cleaned = toNameCase(val);
      await usersApi.updateMe({ displayName: cleaned, storeName: cleaned });
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
  // Never block the whole profile on Firestore profile hydrate — posts come from API.
  if (!user) {
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
            <VerifiedBadge size={16} />
            <View style={[styles.editBadge, { backgroundColor: `${ACCENT}1A` }]}>
              <IconSymbol name="pencil" size={12} color={ACCENT} />
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.metaRow}>
          <View style={[styles.roleChip, { backgroundColor: `${ACCENT}18` }]}>
            <Text style={[styles.roleText, { color: ACCENT }]}>{roleLabel}</Text>
          </View>
          <TouchableOpacity
            style={[styles.followersPill, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.75}
            onPress={() =>
              router.push({
                pathname: '/(market)/social-people',
                params: { mode: 'followers', userId: user.uid },
              } as any)
            }>
            <IconSymbol name="person.2.fill" size={12} color={ACCENT} />
            <Text style={[styles.followersPillText, { color: colors.text }]}>
              {followerCount.toLocaleString()}
            </Text>
            <Text style={[styles.followersPillLabel, { color: colors.textSecondary }]}>
              {followerCount === 1 ? 'follower' : 'followers'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.followersPill, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.75}
            onPress={() =>
              router.push({
                pathname: '/(market)/social-people',
                params: { mode: 'following', userId: user.uid },
              } as any)
            }>
            <Text style={[styles.followersPillText, { color: colors.text }]}>
              {followingCount.toLocaleString()}
            </Text>
            <Text style={[styles.followersPillLabel, { color: colors.textSecondary }]}>following</Text>
          </TouchableOpacity>
        </View>

        {editingBio ? (
          <View style={[styles.bioBox, { borderColor: ACCENT, backgroundColor: colors.backgroundSecondary }]}>
            <TextInput
              style={[styles.bioInput, { color: colors.text }]}
              multiline maxLength={150} autoFocus
              value={bioInput}
              onChangeText={setBioInput}
              placeholder="Write something about your store..."
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
          <TouchableOpacity style={styles.bioDisplay} activeOpacity={0.7} onPress={() => { setBioInput(profileBio); setEditingBio(true); }}>
            {profileBio ? (
              <Text style={[styles.bioText, { color: colors.text }]}>{profileBio}</Text>
            ) : (
              <View style={styles.bioEmptyRow}>
                <IconSymbol name="plus.circle" size={14} color={ACCENT} />
                <Text style={[styles.bioEmpty, { color: ACCENT }]}>Add a store bio</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* One slim seller strip — orders + money */}
      <View style={[styles.ctaWrapper, { paddingHorizontal: H_PAD }]}>
        <View style={[styles.sellerStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.sellerStripRow}
            activeOpacity={0.75}
            onPress={() => { haptics.light(); router.push('/(market)/orders' as any); }}>
            <View style={[styles.sellerStripIcon, { backgroundColor: `${ACCENT}18` }]}>
              <IconSymbol name="shippingbox.fill" size={14} color={ACCENT} />
            </View>
            <View style={styles.sellerStripCopy}>
              <Text style={[styles.sellerStripTitle, { color: colors.text }]}>
                {ordersLoading || sellerOrdersLoading ? brand.ordersNavLabel : 'Orders'}
              </Text>
              <Text style={[styles.sellerStripMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                {sellerOrdersLoading
                  ? 'Loading…'
                  : openSellerOrders > 0
                    ? `${openSellerOrders} open`
                    : 'All clear'}
              </Text>
            </View>
            {openSellerOrders > 0 && !sellerOrdersLoading ? (
              <View style={[styles.sellerStripCount, { backgroundColor: ACCENT }]}>
                <Text style={styles.sellerStripCountText}>{openSellerOrders}</Text>
              </View>
            ) : null}
            <IconSymbol name="chevron.right" size={13} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={[styles.sellerStripDivider, { backgroundColor: colors.border }]} />

          <View style={styles.sellerStripRow}>
            <View style={[styles.sellerStripIcon, { backgroundColor: `${ACCENT}18` }]}>
              <IconSymbol name="dollarsign.circle.fill" size={14} color={ACCENT} />
            </View>
            <View style={styles.sellerStripCopy}>
              <Text style={[styles.sellerStripMeta, { color: colors.textSecondary }]}>Available</Text>
              <Text style={[styles.sellerStripBalance, { color: colors.text }]} numberOfLines={1}>
                {sellerOrdersLoading || payoutsLoading ? '···' : formatNgn(balance)}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.sellerStripWithdraw, { backgroundColor: ACCENT }]}
              activeOpacity={0.85}
              onPress={() => { haptics.light(); router.push('/(market)/payouts' as any); }}>
              <Text style={styles.sellerStripWithdrawText}>Withdraw</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Catalog */}
      <View style={[styles.postsTitleRow, { paddingHorizontal: H_PAD, marginTop: 14, marginBottom: 10 }]}>
        <IconSymbol name="square.grid.2x2.fill" size={16} color={ACCENT} />
        <Text style={[styles.postsTitleText, { color: colors.text }]}>Items listed</Text>
        <View style={[styles.itemsCountChip, { backgroundColor: `${ACCENT}18` }]}>
          <Text style={[styles.itemsCountChipText, { color: ACCENT }]}>
            {postsLoading ? '—' : posts.length}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.listItemBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          activeOpacity={0.85}
          onPress={() => { haptics.light(); router.push('/(market)/create-post' as any); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <IconSymbol name="plus" size={14} color={ACCENT} />
          <Text style={[styles.listItemBtnText, { color: colors.text }]}>List</Text>
        </TouchableOpacity>
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
        {/* Icons only. The card that used to sit here repeated the name and avatar right below it. */}
        <TouchableOpacity
          style={styles.settingsPill}
          activeOpacity={0.7}
          onPress={() => { haptics.light(); toggleTheme(); }}>
          <IconSymbol
            name={isDark ? 'sun.max.fill' : 'moon.fill'}
            size={20}
            color={colors.text}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.settingsPill}
          activeOpacity={0.7}
          onPress={() => { haptics.light(); router.push('/(market)/settings' as any); }}>
          <IconSymbol name="gearshape.fill" size={20} color={colors.text} />
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
          ) : postsError ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn&apos;t load posts</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                {postsError.message || 'Pull to try again.'}
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: ACCENT }]}
                onPress={() => {
                  haptics.light();
                  void refetchPosts();
                }}>
                <Text style={styles.emptyBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: `${ACCENT}18` }]}>
                <IconSymbol name="camera.fill" size={30} color={ACCENT} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No items listed yet</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                List a product so buyers can find you and order with protection.
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: ACCENT }]}
                onPress={() => { haptics.light(); router.push('/(market)/create-post' as any); }}>
                <IconSymbol name="plus" size={14} color="#FFF" />
                <Text style={styles.emptyBtnText}>List an item</Text>
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

  // ── Floating island header (icons right) ──────────────────────────────────
  islandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingHorizontal: H_PAD,
    marginBottom: 4,
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

  followersPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  followersPillText: {
    fontSize: 13,
    fontWeight: '800',
  },
  followersPillLabel: {
    fontSize: 11,
    fontWeight: '600',
  },

  // ── Slim seller strip ──────────────────────────────────────────────────────
  sellerStrip: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sellerStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
    minHeight: 52,
  },
  sellerStripIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerStripCopy: {
    flex: 1,
    minWidth: 0,
  },
  sellerStripTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  sellerStripMeta: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  sellerStripBalance: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 1,
  },
  sellerStripCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerStripCountText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  sellerStripWithdraw: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  sellerStripWithdrawText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  sellerStripDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 54,
  },

  // ── Items heading ──────────────────────────────────────────────────────────
  postsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  postsTitleText: {
    fontSize: 17,
    fontWeight: '800',
  },
  itemsCountChip: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignItems: 'center',
  },
  itemsCountChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  listItemBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  listItemBtnText: {
    fontSize: 13,
    fontWeight: '700',
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
