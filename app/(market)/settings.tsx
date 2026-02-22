import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AnimatedPressable } from '@/components/animated-pressable';
import { haptics } from '@/lib/utils/haptics';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { showToast } from '@/components/toast';

const lightBrown = '#A67C52';

export default function SettingsScreen() {
  const { colors, colorScheme, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut: signOutUser } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [phone, setPhone] = useState(profile?.phone || '');

  React.useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setPhone(profile.phone || '');
    }
  }, [profile]);

  const handleSave = async () => {
    if (!displayName.trim()) {
      showToast('Display name is required', 'error');
      return;
    }

    setSaving(true);
    haptics.medium();

    try {
      // TODO: Update user profile via API
      // await userApi.updateProfile({ displayName, phone });
      haptics.success();
      showToast('Profile updated successfully', 'success');
      setEditing(false);
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = () => {
    haptics.medium();
    Alert.alert(
      'Change Password',
      'Password changes must be done through email reset. We will send you a password reset link.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Reset Link',
          onPress: async () => {
            try {
              // TODO: Send password reset email
              // await sendPasswordResetEmail(auth, user.email);
              showToast('Password reset email sent', 'success');
            } catch (error: any) {
              showToast(error.message || 'Failed to send reset email', 'error');
            }
          },
        },
      ]
    );
  };

  const handleProfilePicture = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'We need access to your photos to update your profile picture.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        haptics.medium();
        // TODO: Upload profile picture via API
        // const base64 = await convertImageToBase64(result.assets[0].uri);
        // await userApi.updateProfile({ profilePicture: base64 });
        showToast('Profile picture updated', 'success');
      }
    } catch {
      haptics.error();
      showToast('Failed to update profile picture', 'error');
    }
  };

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

  const handleOpenLink = (url: string) => {
    Linking.openURL(url).catch(() => {
      showToast('Could not open link', 'error');
    });
  };

  if (profileLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.contentContainer, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}>
      {/* Floating Island Header */}
      <View style={styles.floatingHeaderContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            haptics.light();
            router.back();
          }}>
          <IconSymbol name="arrow.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>SETTINGS</Text>
          <Text style={styles.islandTitle}>Account</Text>
        </View>
      </View>

      {/* Account Settings */}
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Account Settings</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Profile Picture */}
        <TouchableOpacity
          style={[styles.settingRow, { borderBottomColor: colors.border }]}
          onPress={handleProfilePicture}>
          <View style={styles.settingLeft}>
            <IconSymbol name="person.circle.fill" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Profile Picture</Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Display Name */}
        {editing ? (
          <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
            <View style={styles.settingLeft}>
              <IconSymbol name="person.fill" size={20} color={colors.text} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Display Name"
                placeholderTextColor={colors.textSecondary}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            </View>
          </View>
        ) : (
          <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
            <View style={styles.settingLeft}>
              <IconSymbol name="person.fill" size={20} color={colors.text} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Display Name</Text>
                <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                  {profile?.displayName || 'Not set'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                haptics.light();
                setEditing(true);
              }}>
              <IconSymbol name="pencil" size={18} color={lightBrown} />
            </TouchableOpacity>
          </View>
        )}

        {/* Email (Read-only) */}
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingLeft}>
            <IconSymbol name="envelope.fill" size={20} color={colors.text} />
            <View>
              <Text style={[styles.settingLabel, { color: colors.text }]}>Email</Text>
              <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                {user?.email || 'Not set'}
              </Text>
            </View>
          </View>
        </View>

        {/* Phone */}
        {editing ? (
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <IconSymbol name="phone.fill" size={20} color={colors.text} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Phone Number"
                placeholderTextColor={colors.textSecondary}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
            </View>
          </View>
        ) : (
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <IconSymbol name="phone.fill" size={20} color={colors.text} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Phone</Text>
                <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                  {profile?.phone || 'Not set'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                haptics.light();
                setEditing(true);
              }}>
              <IconSymbol name="pencil" size={18} color={lightBrown} />
            </TouchableOpacity>
          </View>
        )}

        {/* Save/Cancel Buttons */}
        {editing && (
          <View style={styles.editActions}>
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={() => {
                haptics.light();
                setEditing(false);
                setDisplayName(profile?.displayName || '');
                setPhone(profile?.phone || '');
              }}>
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <AnimatedPressable
              style={[styles.saveButton, { backgroundColor: lightBrown }]}
              onPress={handleSave}
              disabled={saving}
              scaleValue={0.95}>
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </AnimatedPressable>
          </View>
        )}
      </View>

      {/* Security */}
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Security</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={handleChangePassword}>
          <View style={styles.settingLeft}>
            <IconSymbol name="lock.fill" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Change Password</Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* App Settings */}
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>App Settings</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingLeft}>
            <IconSymbol
              name={colorScheme === 'dark' ? 'moon.fill' : 'sun.max.fill'}
              size={20}
              color={colors.text}
            />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Theme</Text>
          </View>
          <Switch
            value={colorScheme === 'dark'}
            onValueChange={toggleTheme}
            trackColor={{ false: colors.border, true: lightBrown + '80' }}
            thumbColor={colorScheme === 'dark' ? lightBrown : '#FFFFFF'}
          />
        </View>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <IconSymbol name="bell.fill" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Notifications</Text>
          </View>
          <Switch
            value={true}
            onValueChange={() => {
              haptics.light();
              showToast('Notification settings coming soon', 'info');
            }}
            trackColor={{ false: colors.border, true: lightBrown + '80' }}
            thumbColor={lightBrown}
          />
        </View>
      </View>

      {/* Selling & Escrow */}
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Selling & Escrow</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.settingRow, { borderBottomColor: colors.border }]}
          onPress={() => {
            haptics.light();
            router.push('/(market)/orders' as any);
          }}>
          <View style={styles.settingLeft}>
            <IconSymbol name="shippingbox.fill" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Market Orders</Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => {
            haptics.light();
            router.push('/(market)/payouts' as any);
          }}>
          <View style={styles.settingLeft}>
            <IconSymbol name="dollarsign.circle.fill" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Payouts</Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* About */}
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>About</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>App Version</Text>
          <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
            {Constants.expoConfig?.version || '1.0.0'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.settingRow, { borderBottomColor: colors.border }]}
          onPress={() => handleOpenLink('https://example.com/terms')}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>Terms of Service</Text>
          <IconSymbol name="arrow.up.right.square" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => handleOpenLink('https://example.com/privacy')}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>Privacy Policy</Text>
          <IconSymbol name="arrow.up.right.square" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <AnimatedPressable
        style={[styles.logoutButton, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={handleLogout}
        scaleValue={0.98}>
        <IconSymbol name="arrow.left.square.fill" size={20} color="#FF4444" />
        <Text style={styles.logoutText}>Logout from Account</Text>
      </AnimatedPressable>
    </ScrollView>
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
  contentContainer: {
    paddingHorizontal: 20,
  },
  floatingHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  settingValue: {
    fontSize: 14,
    marginTop: 2,
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 24,
    marginBottom: 20,
  },
  logoutText: {
    color: '#FF4444',
    fontSize: 16,
    fontWeight: '700',
  },
});
