import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useUserMarketPosts, useUserLikesCount } from '@/lib/firebase/firestore/market-posts';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AnimatedPressable } from '@/components/animated-pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { Alert } from 'react-native';
import { haptics } from '@/lib/utils/haptics';

const lightBrown = '#A67C52';

export default function ProfileScreen() {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut: signOutUser } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const { posts, loading: postsLoading } = useUserMarketPosts(user?.uid || null);
  const { likesCount, loading: likesLoading } = useUserLikesCount(user?.uid || null);

  const handleLogout = () => {
    haptics.medium();
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOutUser();
              haptics.success();
              router.replace('/(market)');
            } catch (error: any) {
              haptics.error();
              Alert.alert('Error', error.message || 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  if (!user) {
    // Guest state
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.contentContainer, { paddingTop: insets.top + 20 }]}>
        <View style={styles.guestContainer}>
          <View style={[styles.guestIconContainer, { backgroundColor: colors.backgroundSecondary }]}>
            <IconSymbol name="person.circle" size={80} color={lightBrown} />
          </View>
          <Text style={[styles.welcomeText, { color: colors.text }]}>
            Welcome to Market Street
          </Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Log in to post, like, comment, and message sellers
          </Text>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: lightBrown }]}
            onPress={() => {
              haptics.medium();
              router.push('/(auth)/login');
            }}>
            <Text style={styles.buttonText}>Login</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.outlineButton, { borderColor: lightBrown }]}
            onPress={() => {
              haptics.medium();
              router.push('/(auth)/signup');
            }}>
            <Text style={[styles.buttonText, { color: lightBrown }]}>Sign Up</Text>
          </TouchableOpacity>

          {/* Info Cards */}
          <View style={styles.infoCardsContainer}>
            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="photo.fill" size={24} color={lightBrown} />
              <Text style={[styles.infoCardTitle, { color: colors.text }]}>Post Products</Text>
              <Text style={[styles.infoCardText, { color: colors.textSecondary }]}>
                Share up to 20 images per post
              </Text>
            </View>
            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="heart.fill" size={24} color={lightBrown} />
              <Text style={[styles.infoCardTitle, { color: colors.text }]}>Engage</Text>
              <Text style={[styles.infoCardText, { color: colors.textSecondary }]}>
                Like, comment, and message sellers
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  // Logged-in state
  const displayName = profile?.displayName || user.displayName || user.email || 'User';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.contentContainer, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}>
      {/* Floating Island Header */}
      <View style={styles.floatingHeaderContainer}>
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>MARKET STREET</Text>
          <Text style={styles.islandTitle}>Profile</Text>
        </View>
      </View>

      {/* Profile Card */}
      <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.profileHeader}>
          <View style={[styles.avatar, { backgroundColor: lightBrown + '20' }]}>
            {profile?.storeLogoUrl ? (
              <Text style={[styles.avatarText, { color: lightBrown }]}>{initials}</Text>
            ) : (
              <Text style={[styles.avatarText, { color: lightBrown }]}>{initials}</Text>
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{displayName}</Text>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{user.email}</Text>
            {profile?.storeName && (
              <Text style={[styles.storeName, { color: lightBrown }]}>{profile.storeName}</Text>
            )}
          </View>
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {postsLoading ? '...' : posts.length}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Posts</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {likesLoading ? '...' : likesCount}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Likes</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={[styles.actionsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <AnimatedPressable
          style={[styles.actionButton, { borderBottomColor: colors.border }]}
          onPress={() => {
            haptics.light();
            router.push('/(market)/settings');
          }}
          scaleValue={0.98}>
          <View style={styles.actionLeft}>
            <IconSymbol name="gearshape.fill" size={20} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Settings</Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
        </AnimatedPressable>
        <AnimatedPressable
          style={styles.actionButton}
          onPress={handleLogout}
          scaleValue={0.98}>
          <View style={styles.actionLeft}>
            <IconSymbol name="arrow.left.square.fill" size={20} color="#FF4444" />
            <Text style={[styles.actionText, { color: '#FF4444' }]}>Logout</Text>
          </View>
        </AnimatedPressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
  },
  floatingHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  nameIsland: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 22,
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
  guestContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  guestIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  infoText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  infoCardsContainer: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    marginTop: 30,
  },
  infoCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  infoCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  infoCardText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  profileCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    marginBottom: 4,
  },
  storeName: {
    fontSize: 14,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionsCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
