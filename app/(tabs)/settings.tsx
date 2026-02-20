import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { isAdmin } from '@/lib/utils/auth-helpers';
import { haptics } from '@/lib/utils/haptics';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SettingsTabScreen() {
  const { user, signOut, loading: authLoading } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const { colors, colorScheme, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();

  const lightBrown = '#A67C52';

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
              await signOut();
              router.replace('/(auth)/login');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  if (authLoading || profileLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={lightBrown} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* 1. FLOATING ISLAND HEADER - Increased padding/height */}
      <View style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 10, paddingBottom: 15 }]}>
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>MERCHANT SYSTEM</Text>
          <Text style={styles.islandTitle}>Settings</Text>
        </View>

        {/* Removed border here as requested */}
        <TouchableOpacity 
          style={[styles.iconIsland, { borderWidth: 0 }]} 
          onPress={() => { haptics.medium(); toggleTheme(); }}>
          <IconSymbol 
            name={colorScheme === 'dark' ? "sun.max.fill" : "moon.fill"} 
            size={22} 
            color={lightBrown} 
          />
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 70 + insets.bottom + 20 }]} 
        showsVerticalScrollIndicator={false}>
        
        {/* 2. PROFILE ISLAND */}
        <View style={[styles.island, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.profileHeader}>
            <View style={[styles.avatar, { backgroundColor: lightBrown + '15' }]}>
              <Text style={[styles.avatarText, { color: lightBrown }]}>
                {(profile?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.profileName, { color: colors.text }]}>
                {profile?.displayName || 'Merchant'}
              </Text>
              <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{user?.email}</Text>
              {profile?.storeName && (
                <Text style={[styles.storeNameText, { color: lightBrown }]}>{profile.storeName}</Text>
              )}
            </View>
            <View style={[styles.roleBadge, { backgroundColor: isAdmin(user) ? '#EAB30815' : lightBrown + '15' }]}>
              <Text style={[styles.roleText, { color: isAdmin(user) ? '#EAB308' : lightBrown }]}>
                {isAdmin(user) ? 'ADMIN' : 'SELLER'}
              </Text>
            </View>
          </View>
        </View>

        {/* 3. STORE MANAGEMENT SECTION */}
        <Text style={styles.sectionTitle}>Store Management</Text>
        <View style={[styles.island, { backgroundColor: colors.card, borderColor: colors.border, padding: 4 }]}>
          <MenuRow label="Store Settings" icon="gearshape.fill" onPress={() => router.push('/store-settings' as any)} colors={colors} />
          <MenuRow label="Storefront Customization" icon="paintpalette.fill" onPress={() => router.push('/storefront' as any)} colors={colors} />
          <MenuRow label="Domain Settings" icon="globe" onPress={() => router.push('/domain' as any)} colors={colors} isLast />
        </View>

        {/* 4. ACCOUNT & SECURITY */}
        <Text style={styles.sectionTitle}>Account & Security</Text>
        <View style={[styles.island, { backgroundColor: colors.card, borderColor: colors.border, padding: 4 }]}>
           {isAdmin(user) && (
            <MenuRow label="Admin Panel" icon="crown.fill" onPress={() => router.push('/(admin)' as any)} colors={colors} />
          )}
          <MenuRow label="Security & Password" icon="lock.shield.fill" onPress={() => {}} colors={colors} isLast />
        </View>

        {/* 5. ABOUT SECTION (User ID Removed) */}
        <Text style={styles.sectionTitle}>About</Text>
        <View style={[styles.island, { backgroundColor: colors.card, borderColor: colors.border, padding: 4 }]}>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>App Version</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>1.0.0</Text>
          </View>
        </View>

        {/* 6. LOGOUT BUTTON */}
        <AnimatedPressable style={styles.logoutButton} onPress={handleLogout} scaleValue={0.98}>
          <IconSymbol name="arrow.left.square.fill" size={20} color="#FF4444" />
          <Text style={styles.logoutText}>Logout from Account</Text>
        </AnimatedPressable>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

function MenuRow({ label, icon, onPress, colors, isLast }: any) {
  return (
    <TouchableOpacity 
      style={[styles.menuRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]} 
      onPress={() => { haptics.light(); onPress(); }}
    >
      <View style={styles.menuLeft}>
        <View style={styles.iconContainer}>
          <IconSymbol name={icon} size={18} color={colors.text} />
        </View>
        <Text style={[styles.menuLabel, { color: colors.text }]}>{label}</Text>
      </View>
      <IconSymbol name="chevron.right" size={14} color="#CCC" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  // HEADER UPDATED: Added bottom padding and removed border from icons
  floatingHeaderContainer: { 
    paddingHorizontal: 20, 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8,
  },
  nameIsland: { 
    flex: 1, 
    paddingVertical: 12, // Increased for height
    paddingHorizontal: 16, 
    borderRadius: 22 
  },
  iconIsland: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: 'transparent', // Cleaner look
  },
  islandLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  islandTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },

  scrollContent: { padding: 20, paddingBottom: 70 + 20 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#999', textTransform: 'uppercase', marginBottom: 12, marginLeft: 4, marginTop: 20 },
  island: { borderRadius: 24, borderWidth: 1, overflow: 'hidden', marginBottom: 16 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 27, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 22, fontWeight: '800' },
  profileName: { fontSize: 19, fontWeight: '800' },
  profileEmail: { fontSize: 12, color: '#999', marginTop: 1 },
  storeNameText: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  roleText: { fontSize: 10, fontWeight: '900' },
  menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconContainer: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  menuLabel: { fontSize: 15, fontWeight: '600' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  infoLabel: { fontSize: 14, fontWeight: '600' },
  infoValue: { fontSize: 14, fontWeight: '700' },
  logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FF444410', padding: 18, borderRadius: 22, marginTop: 10 },
  logoutText: { color: '#FF4444', fontWeight: '800', fontSize: 15 }
});