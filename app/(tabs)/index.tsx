import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- Logic & Hooks ---
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useSellerOrders } from '@/lib/firebase/firestore/orders';
import { useSellerProducts } from '@/lib/firebase/firestore/products';
import { useStore } from '@/lib/firebase/firestore/stores';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useOrderNotifications } from '@/lib/hooks/use-order-notifications';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';

export default function DashboardScreen() {
  const { user } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const { store, loading: storeLoading } = useStore(user?.uid || null);
  const { products } = useSellerProducts(user?.uid || null);
  const { orders } = useSellerOrders(user?.uid || null);
  
  // Theme logic for the custom toggle
  const { colors, colorScheme, toggleTheme } = useTheme();
  
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  
  useOrderNotifications();
  
  const lightBrown = '#A67C52'; 
  const styles = createStyles(colors, insets, lightBrown);

  const onRefresh = async () => {
    setRefreshing(true);
    haptics.light();
    setTimeout(() => setRefreshing(false), 800);
  };

  const storeName = profile?.storeName || store?.storeName;
  const hasStore = !!(profile?.storeName || store?.storeName);
  const isLoading = (profileLoading && storeLoading) && !profile && !store;
  
  // Check both store and user profile for bank details (web app might save to users collection)
  const payoutDetails = store?.payoutDetails || profile?.payoutDetails;
  const hasBankDetails = !!(payoutDetails?.accountNumber && payoutDetails?.accountName);
  
  const activeProducts = products.filter(p => p.status === 'active').length;
  const processingOrders = orders.filter(o => o.status === 'Processing').length;
  const sentOrders = orders.filter(o => o.status === 'Sent').length;
  const totalRevenue = orders
    .filter(o => o.status !== 'Cancelled' && o.status !== 'Disputed')
    .reduce((sum, order) => sum + (order.total || 0), 0);
  const pendingPayouts = orders
    .filter(o => o.status === 'Completed' || o.status === 'Received')
    .reduce((sum, order) => sum + (order.total || 0), 0);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={lightBrown} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* 1. FLOATING ISLAND HEADER */}
      <View style={styles.floatingHeaderContainer}>
        {/* Profile/Store Island */}
        <View style={styles.nameIsland}>
          <Text style={styles.islandLabel}>MERCHANT</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>
            {storeName || 'My Store'}
          </Text>
        </View>
        
        {/* Notification Island */}
        <TouchableOpacity 
          style={styles.iconIsland} 
          onPress={() => { haptics.light(); router.push('/notifications' as any); }}>
          <IconSymbol name="bell.fill" size={20} color={lightBrown} />
        </TouchableOpacity>

        {/* Custom Theme Toggle Island (Matches Bell exactly) */}
        <TouchableOpacity 
          style={styles.iconIsland} 
          onPress={() => { haptics.medium(); toggleTheme(); }}>
          <IconSymbol 
            name={colorScheme === 'dark' ? "sun.max.fill" : "moon.fill"} 
            size={20} 
            color={lightBrown} 
          />
        </TouchableOpacity>
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: 70 + insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.content}>
          
          {/* 2. REVENUE SECTION */}
          <View style={styles.revenueRow}>
            <View>
              <Text style={styles.sectionLabel}>LIFETIME REVENUE</Text>
              <Text style={styles.revenueMainText}>₦{totalRevenue.toLocaleString()}</Text>
            </View>
            <View style={[styles.revenueBadge, { backgroundColor: lightBrown + '15' }]}>
              <IconSymbol name="dollarsign.circle.fill" size={16} color={lightBrown} />
              <Text style={[styles.revenueBadgeText, { color: lightBrown }]}>Total</Text>
            </View>
          </View>

          {/* 3. GRADIENT PAYOUT CARD */}
          <AnimatedPressable 
            onPress={() => { haptics.medium(); router.push('/(tabs)/payouts'); }}>
            <LinearGradient
              colors={[lightBrown, '#8B623E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.payoutCard}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.payoutLabel}>Available for Payout</Text>
                <Text style={styles.payoutValue}>₦{pendingPayouts.toLocaleString()}</Text>
                {!hasBankDetails && (
                  <Text style={styles.payoutWarning}>⚠️ Set up bank account to receive payouts</Text>
                )}
              </View>
              <View style={styles.payoutButton}>
                <Text style={styles.payoutButtonText}>Withdraw</Text>
              </View>
            </LinearGradient>
          </AnimatedPressable>

          {/* 4. STATS BAR */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{activeProducts}</Text>
              <Text style={styles.statSub}>Products</Text>
            </View>
            <View style={[styles.statItem, styles.statBorder]}>
              <Text style={styles.statNum}>{processingOrders}</Text>
              <Text style={styles.statSub}>Processing</Text>
            </View>
            <View style={[styles.statItem, styles.statBorder]}>
              <Text style={styles.statNum}>{sentOrders}</Text>
              <Text style={styles.statSub}>Sent</Text>
            </View>
            <TouchableOpacity style={styles.statItem} onPress={() => router.push('/(tabs)/products')}>
              <IconSymbol name="plus.circle.fill" size={26} color={lightBrown} />
              <Text style={styles.statSub}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* 5. RECENT ORDERS */}
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Recent Orders</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/orders')}>
              <Text style={[styles.seeAll, { color: lightBrown }]}>See all</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.listContainer}>
            {orders.slice(0, 3).map((order, idx) => (
              <TouchableOpacity 
                key={order.id} 
                style={[styles.listItem, idx === 2 && { borderBottomWidth: 0 }]}
                onPress={() => router.push(`/orders/${order.id}` as any)}>
                <View style={styles.listIcon}>
                  <IconSymbol name="shippingbox" size={20} color={colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listMainText}>
                    {order.customerInfo.name?.split(' ')[0] || order.customerInfo.name}
                  </Text>
                  <Text style={styles.listSubText} numberOfLines={1}>
                    {(() => {
                      const productNames = order.items.length > 1 
                        ? `${order.items[0].name} +${order.items.length - 1} more`
                        : order.items[0]?.name || 'No items';
                      const dateStr = order.createdAt instanceof Date 
                        ? order.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : 'N/A';
                      return `${productNames} • ${dateStr}`;
                    })()}
                  </Text>
                </View>
                <Text style={styles.listAmountText}>₦{order.total?.toLocaleString()}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 6. QUICK TOOLS */}
          <Text style={[styles.listTitle, { marginTop: 32 }]}>Store Management</Text>
          <View style={styles.toolsGrid}>
            {[
              { n: 'Customers', i: 'person.2', r: '/(tabs)/customers' },
              { n: 'Shipping', i: 'bus', r: '/(tabs)/shipping' },
              { n: 'Marketing', i: 'megaphone', r: '/(tabs)/marketing' },
              { n: 'Settings', i: 'gearshape', r: '/store-settings' },
            ].map(tool => (
              <TouchableOpacity key={tool.n} style={styles.toolItem} onPress={() => router.push(tool.r as any)}>
                <IconSymbol name={tool.i} size={22} color={colors.text} />
                <Text style={styles.toolText}>{tool.n}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 7. SETUP BANNER */}
          {!hasStore && (
            <View style={[styles.setupBanner, { backgroundColor: colors.warning + '20', borderColor: colors.warning + '40' }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={32} color={colors.warning} />
              <Text style={[styles.setupBannerText, { color: colors.text }]}>
                Complete your store setup to start selling
              </Text>
              <AnimatedPressable
                style={[styles.setupButton, { backgroundColor: colors.warning }]}
                onPress={() => {
                  haptics.medium();
                  router.push('/store-settings' as any);
                }}
                scaleValue={0.95}>
                <Text style={styles.setupButtonText}>Setup Store</Text>
              </AnimatedPressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: any, insets: any, themeBrown: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  floatingHeaderContainer: {
    paddingTop: insets.top + 10,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    gap: 8,
  },
  nameIsland: {
    flex: 1,
    backgroundColor: themeBrown,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    ...Platform.select({
      ios: { shadowColor: themeBrown, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 5 },
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
  },
  islandLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  islandTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },

  content: { padding: 20 },

  revenueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 25 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 },
  revenueMainText: { fontSize: 36, fontWeight: '800', color: colors.text, marginTop: 4 },
  revenueBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 5, marginBottom: 8 },
  revenueBadgeText: { fontWeight: '700', fontSize: 13 },

  payoutCard: { 
    borderRadius: 24, 
    padding: 24, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: 28,
  },
  payoutLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  payoutValue: { fontSize: 24, fontWeight: '800', color: '#fff', marginTop: 2 },
  payoutWarning: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 8, fontWeight: '500' },
  payoutButton: { backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  payoutButtonText: { color: themeBrown, fontWeight: '800', fontSize: 14 },

  statsRow: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 22, paddingVertical: 18, borderWidth: 1, borderColor: colors.border },
  statItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  statNum: { fontSize: 20, fontWeight: '800', color: colors.text },
  statSub: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginTop: 3 },

  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 16 },
  listTitle: { fontSize: 19, fontWeight: '800', color: colors.text },
  seeAll: { fontSize: 15, fontWeight: '700' },
  listContainer: { backgroundColor: colors.card, borderRadius: 24, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  listItem: { flexDirection: 'row', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  listIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  listMainText: { fontSize: 16, fontWeight: '700', color: colors.text },
  listSubText: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  listAmountText: { fontSize: 17, fontWeight: '800', color: colors.text },

  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  toolItem: { width: '48%', backgroundColor: colors.card, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12 },
  toolText: { fontSize: 15, fontWeight: '700', color: colors.text },
  setupBanner: {
    marginTop: 24,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  setupBannerText: {
    fontSize: 14,
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  setupButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  setupButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
});