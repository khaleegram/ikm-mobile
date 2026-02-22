// Admin user detail screen
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTheme } from '@/lib/theme/theme-context';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { adminApi } from '@/lib/api/admin';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/lib/firebase/auth/use-user';

function normalizeUserRole(role: unknown, isAdmin: boolean, hasStore: boolean): 'user' | 'seller' | 'admin' {
  if (isAdmin) return 'admin';
  if (role === 'admin' || role === 'seller' || role === 'user') return role;
  if (role === 'customer') return 'user';
  if (hasStore) return 'seller';
  return 'user';
}

export default function AdminUserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, colorScheme } = useTheme();
  const { user: currentUser } = useUser();
  const { user, loading } = useUserProfile(id);
  const [updating, setUpdating] = useState(false);
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  const handleUpdateRole = async (newRole: 'user' | 'seller' | 'admin') => {
    if (!user || !user.id) return;

    if (user.id === currentUser?.uid) {
      Alert.alert('Error', 'You cannot change your own role');
      return;
    }

    Alert.alert(
      'Confirm Role Change',
      `Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setUpdating(true);
            try {
              await adminApi.updateUserRole(user.id, {
                role: newRole,
                isAdmin: newRole === 'admin',
              });
              Alert.alert('Success', `User role updated to ${newRole}`);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to update user role');
            } finally {
              setUpdating(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.text }]}>User not found</Text>
      </View>
    );
  }

  const currentRole = normalizeUserRole((user as any).role, user.isAdmin === true, !!user.storeName);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <LinearGradient
        colors={colorScheme === 'light' 
          ? [colors.primary, colors.accent] 
          : [colors.gradientStart, colors.gradientEnd]}
        style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()}>
            <IconSymbol name="arrow.left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={[styles.roleBadge, { backgroundColor: 'rgba(255, 255, 255, 0.3)' }]}>
            <Text style={styles.roleText}>{currentRole.toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.userHeader}>
          <View style={[styles.avatar, { backgroundColor: 'rgba(255, 255, 255, 0.3)' }]}>
            <Text style={styles.avatarText}>
              {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user.displayName || user.email || 'Unknown User'}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* Role Management */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Role Management</Text>
          <View style={[styles.currentRoleCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.currentRoleLabel, { color: colors.textSecondary }]}>Current Role</Text>
            <View style={[styles.currentRoleBadge, { backgroundColor: `${getRoleColor(currentRole)}20` }]}>
              <Text style={[styles.currentRoleText, { color: getRoleColor(currentRole) }]}>
                {currentRole.toUpperCase()}
              </Text>
            </View>
          </View>

          {user.id !== currentUser?.uid && (
            <>
              <Text style={[styles.changeRoleLabel, { color: colors.textSecondary, marginTop: 20 }]}>
                Change Role
              </Text>
              <View style={styles.roleButtons}>
                {(['user', 'seller', 'admin'] as const).map((role) => {
                  const isSelected = role === currentRole;
                  return (
                    <TouchableOpacity
                      key={role}
                      style={[
                        styles.roleButton,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.backgroundSecondary,
                          borderColor: isSelected ? colors.primary : colors.cardBorder,
                          opacity: updating ? 0.5 : 1,
                        }
                      ]}
                      onPress={() => handleUpdateRole(role)}
                      disabled={isSelected || updating}>
                      <Text style={[
                        styles.roleButtonText,
                        { color: isSelected ? '#fff' : colors.text }
                      ]}>
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>

        {/* Account Information */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Account Information</Text>
          {user.phone && (
            <View style={[styles.infoRow, { borderBottomColor: colors.cardBorder }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Phone</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{user.phone}</Text>
            </View>
          )}
          {user.firstName && (
            <View style={[styles.infoRow, { borderBottomColor: colors.cardBorder }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Name</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {user.firstName} {user.lastName || ''}
              </Text>
            </View>
          )}
          <View style={[styles.infoRow, { borderBottomColor: colors.cardBorder }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>User ID</Text>
            <Text style={[styles.infoValue, { color: colors.text, fontSize: 12 }]} numberOfLines={1}>
              {user.id}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Joined</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>
              {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
            </Text>
          </View>
        </View>

        {/* Store Information */}
        {user.storeName && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Store Information</Text>
            <View style={[styles.infoRow, { borderBottomColor: colors.cardBorder }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Store Name</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{user.storeName}</Text>
            </View>
            {user.storeDescription && (
              <View style={[styles.infoRow, { borderBottomColor: colors.cardBorder }]}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Description</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>{user.storeDescription}</Text>
              </View>
            )}
            {user.storeLocation && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Location</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {user.storeLocation.city}, {user.storeLocation.state}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function getRoleColor(role: string) {
  switch (role) {
    case 'admin':
      return '#FF3B30';
    case 'seller':
      return '#007AFF';
    case 'user':
      return '#34C759';
    default:
      return '#8E8E93';
  }
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    header: {
      paddingBottom: 24,
      paddingHorizontal: 20,
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
      ...premiumShadow,
    },
    headerTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    roleBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    roleText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '600',
    },
    userHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: '#fff',
      fontSize: 28,
      fontWeight: 'bold',
    },
    userInfo: {
      flex: 1,
    },
    userName: {
      fontSize: 24,
      fontWeight: 'bold',
      color: '#FFFFFF',
      marginBottom: 4,
    },
    userEmail: {
      fontSize: 16,
      color: 'rgba(255, 255, 255, 0.9)',
    },
    content: {
      padding: 20,
    },
    section: {
      padding: 20,
      borderRadius: 20,
      marginBottom: 20,
      ...premiumShadow,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 16,
    },
    currentRoleCard: {
      padding: 16,
      borderRadius: 12,
    },
    currentRoleLabel: {
      fontSize: 14,
      marginBottom: 8,
    },
    currentRoleBadge: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 12,
      alignSelf: 'flex-start',
    },
    currentRoleText: {
      fontSize: 14,
      fontWeight: '600',
    },
    changeRoleLabel: {
      fontSize: 14,
      marginBottom: 12,
    },
    roleButtons: {
      flexDirection: 'row',
      gap: 8,
    },
    roleButton: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
    },
    roleButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    infoLabel: {
      fontSize: 14,
      flex: 1,
    },
    infoValue: {
      fontSize: 14,
      fontWeight: '500',
      flex: 2,
      textAlign: 'right',
    },
    errorText: {
      fontSize: 16,
    },
  });

