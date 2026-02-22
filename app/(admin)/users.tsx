// Admin users management
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { adminApi } from '@/lib/api/admin';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useAllUsers } from '@/lib/firebase/firestore/admin';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { User } from '@/types';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeUserRole(role: unknown, isAdmin: boolean, hasStore: boolean): 'user' | 'seller' | 'admin' {
  if (isAdmin) return 'admin';
  if (role === 'admin' || role === 'seller' || role === 'user') return role;
  if (role === 'customer') return 'user';
  if (hasStore) return 'seller';
  return 'user';
}

export default function AdminUsers() {
  const { colors, colorScheme, toggleTheme } = useTheme();
  const { user: currentUser } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { users, loading } = useAllUsers();
  const insets = useSafeAreaInsets();
  const lightBrown = '#A67C52';
  const styles = createStyles(colors, insets, lightBrown);

  // Filter users by search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const query = searchQuery.toLowerCase();
    return users.filter(
      (user) =>
        user.displayName?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query) ||
        user.storeName?.toLowerCase().includes(query)
    );
  }, [users, searchQuery]);

  const handleUpdateRole = async (userId: string, newRole: 'user' | 'seller' | 'admin') => {
    if (userId === currentUser?.uid) {
      haptics.error();
      Alert.alert('Error', 'You cannot change your own role');
      return;
    }

    haptics.medium();
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
              await adminApi.updateUserRole(userId, { 
                role: newRole,
                isAdmin: newRole === 'admin'
              });
              Alert.alert('Success', `User role updated to ${newRole}`);
              setModalVisible(false);
              setSelectedUser(null);
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

  const handleUserPress = (user: User) => {
    haptics.light();
    // Navigate to user detail screen instead of modal
    router.push(`/(admin)/users/${user.id}` as any);
  };

  const renderUser = ({ item }: { item: typeof filteredUsers[0] }) => {
    const role = normalizeUserRole((item as any).role, item.isAdmin === true, !!item.storeName);
    const displayName = item.displayName || item.email || 'Unknown';
    
    return (
      <AnimatedPressable
        style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleUserPress(item)}
        scaleValue={0.98}>
        <View style={styles.userHeader}>
          <View style={[styles.avatar, { backgroundColor: lightBrown }]}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{displayName}</Text>
            {item.storeName && (
              <Text style={[styles.storeName, { color: colors.textSecondary }]}>
                🏪 {item.storeName}
              </Text>
            )}
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{item.email}</Text>
          </View>
          <View style={[styles.roleBadge, { backgroundColor: `${getRoleColor(role)}20` }]}>
            <Text style={[styles.roleText, { color: getRoleColor(role) }]}>
              {role.toUpperCase()}
            </Text>
          </View>
        </View>
      </AnimatedPressable>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Floating Island Header */}
      <View style={styles.floatingHeaderContainer}>
        <AnimatedPressable
          style={styles.iconIsland}
          onPress={() => { haptics.light(); router.back(); }}
          scaleValue={0.9}>
          <IconSymbol name="chevron.left" size={20} color={colors.text} />
        </AnimatedPressable>
        
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>USER MANAGEMENT</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>
            {users.length} Users
          </Text>
        </View>
        
        <AnimatedPressable
          style={styles.iconIsland}
          onPress={() => { haptics.medium(); toggleTheme(); }}
          scaleValue={0.9}>
          <IconSymbol 
            name={colorScheme === 'dark' ? "sun.max.fill" : "moon.fill"} 
            size={20} 
            color={lightBrown} 
          />
        </AnimatedPressable>
      </View>

      {/* Search Island */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchIsland, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={18} color={colors.textSecondary} />
          <TextInput
            placeholder="Search users..."
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderUser}
          keyExtractor={(item) => item.id || ''}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <IconSymbol name="person.2.fill" size={64} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {searchQuery ? 'No users found' : 'No users yet'}
              </Text>
            </View>
          }
        />
      )}

      {/* User Detail Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>User Details</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <View style={styles.userDetailSection}>
                  <View style={[styles.detailAvatar, { backgroundColor: colors.primary }]}>
                    <Text style={styles.detailAvatarText}>
                      {(selectedUser.displayName || selectedUser.email || 'U').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.detailName, { color: colors.text }]}>
                    {selectedUser.displayName || selectedUser.email || 'Unknown User'}
                  </Text>
                  <Text style={[styles.detailEmail, { color: colors.textSecondary }]}>
                    {selectedUser.email}
                  </Text>
                </View>

                <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.detailSectionTitle, { color: colors.text }]}>Role Management</Text>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Current Role</Text>
                  <View style={[styles.currentRoleBadge, { backgroundColor: `${getRoleColor(normalizeUserRole((selectedUser as any).role, selectedUser.isAdmin === true, !!selectedUser.storeName))}20` }]}>
                    <Text style={[styles.currentRoleText, { color: getRoleColor(normalizeUserRole((selectedUser as any).role, selectedUser.isAdmin === true, !!selectedUser.storeName)) }]}>
                      {normalizeUserRole((selectedUser as any).role, selectedUser.isAdmin === true, !!selectedUser.storeName).toUpperCase()}
                    </Text>
                  </View>

                  {selectedUser.id !== currentUser?.uid && (
                    <>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary, marginTop: 16 }]}>Change Role</Text>
                      <View style={styles.roleButtons}>
                        {(['user', 'seller', 'admin'] as const).map((role) => {
                          const currentRole = normalizeUserRole((selectedUser as any).role, selectedUser.isAdmin === true, !!selectedUser.storeName);
                          const isSelected = role === currentRole;
                          return (
                            <TouchableOpacity
                              key={role}
                              style={[
                                styles.roleButton,
                                { 
                                  backgroundColor: isSelected ? colors.primary : colors.background,
                                  borderColor: colors.cardBorder,
                                  opacity: updating ? 0.5 : 1
                                }
                              ]}
                              onPress={() => handleUpdateRole(selectedUser.id!, role)}
                              disabled={isSelected || updating}>
                              <Text style={[
                                styles.roleButtonText,
                                { color: isSelected ? '#fff' : colors.text }
                              ]}>
                                {role.toUpperCase()}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}
                </View>

                {selectedUser.storeName && (
                  <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary }]}>
                    <Text style={[styles.detailSectionTitle, { color: colors.text }]}>Store Information</Text>
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Store Name</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.storeName}</Text>
                    </View>
                    {selectedUser.storeDescription && (
                      <View style={styles.detailRow}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Description</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.storeDescription}</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.detailSectionTitle, { color: colors.text }]}>Account Information</Text>
                  {selectedUser.phone && (
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Phone</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.phone}</Text>
                    </View>
                  )}
                  {selectedUser.firstName && (
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Name</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {selectedUser.firstName} {selectedUser.lastName || ''}
                      </Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>User ID</Text>
                    <Text style={[styles.detailValue, { color: colors.text, fontSize: 12 }]} numberOfLines={1}>
                      {selectedUser.id}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Joined</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {selectedUser.createdAt ? (selectedUser.createdAt instanceof Date ? selectedUser.createdAt : selectedUser.createdAt.toDate()).toLocaleDateString() : 'N/A'}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
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

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>, insets: any, lightBrown: string) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    floatingHeaderContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      paddingTop: insets.top + 10,
      paddingHorizontal: 20,
      paddingBottom: 15,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
      gap: 8,
      pointerEvents: 'box-none',
    },
    nameIsland: {
      flex: 1,
      backgroundColor: lightBrown,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 22,
      ...Platform.select({
        ios: { shadowColor: lightBrown, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 5 },
        android: { elevation: 3 }
      })
    },
    iconIsland: {
      backgroundColor: colors.card,
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      ...premiumShadow,
    },
    islandLabel: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    islandTitle: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '800',
    },
    searchContainer: {
      paddingTop: insets.top + 10 + 44 + 15 + 12,
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    searchIsland: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      gap: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
    },
    list: {
      padding: 20,
      paddingBottom: 100,
    },
    userCard: {
      padding: 16,
      borderRadius: 20,
      marginBottom: 12,
      borderWidth: 1,
      ...premiumShadow,
    },
    userHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
      backgroundColor: lightBrown,
    },
    avatarText: {
      color: '#fff',
      fontSize: 20,
      fontWeight: 'bold',
    },
    userInfo: {
      flex: 1,
    },
    userName: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    userEmail: {
      fontSize: 14,
    },
    roleBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    roleText: {
      fontSize: 12,
      fontWeight: '600',
    },
    storeName: {
      fontSize: 12,
      marginBottom: 2,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      padding: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 16,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '90%',
      paddingBottom: 40,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    modalTitle: {
      fontSize: 24,
      fontWeight: 'bold',
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalBody: {
      padding: 20,
    },
    userDetailSection: {
      alignItems: 'center',
      paddingVertical: 24,
    },
    detailAvatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    detailAvatarText: {
      color: '#fff',
      fontSize: 32,
      fontWeight: 'bold',
    },
    detailName: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    detailEmail: {
      fontSize: 16,
    },
    detailCard: {
      padding: 16,
      borderRadius: 12,
      marginBottom: 16,
    },
    detailSectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 16,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    detailLabel: {
      fontSize: 14,
      flex: 1,
    },
    detailValue: {
      fontSize: 14,
      fontWeight: '500',
      flex: 2,
      textAlign: 'right',
    },
    currentRoleBadge: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 12,
      alignSelf: 'flex-start',
      marginTop: 8,
    },
    currentRoleText: {
      fontSize: 14,
      fontWeight: '600',
    },
    roleButtons: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
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
  });

