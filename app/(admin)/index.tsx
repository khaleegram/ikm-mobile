// Admin dashboard
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useAllOrders, useAllProducts, useAllUsers, usePlatformStats } from '@/lib/firebase/firestore/admin';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AdminDashboard() {
  const { colors, colorScheme, toggleTheme } = useTheme();
  const { user, signOut } = useUser();
  const stats = usePlatformStats();
  const { orders, loading: ordersLoading } = useAllOrders();
  const { users, loading: usersLoading } = useAllUsers();
  const { products, loading: productsLoading } = useAllProducts();
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const lightBrown = '#A67C52';
  const styles = createStyles(colors, insets, lightBrown);

  const onRefresh = async () => {
    setRefreshing(true);
    // Force refresh by waiting a bit (data will auto-update via Firestore listeners)
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleLogout = () => {
    haptics.medium();
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
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

  // Calculate additional stats
  const pendingOrders = orders.filter(o => o.status === 'Processing').length;
  const completedOrders = orders.filter(o => o.status === 'Completed' || o.status === 'Received').length;
  const totalSellers = users.filter(u => (u as any).role === 'seller' || u.storeName).length;
  const activeProducts = products.filter(p => p.status === 'active').length;

  const displayStats = [
    { 
      label: 'Total Users', 
      value: stats.totalUsers.toLocaleString(), 
      icon: 'person.2.fill', 
      color: colors.primary,
      subtitle: `${totalSellers} sellers`
    },
    { 
      label: 'Total Orders', 
      value: stats.totalOrders.toLocaleString(), 
      icon: 'bag.fill', 
      color: colors.success,
      subtitle: `${pendingOrders} pending`
    },
    { 
      label: 'Revenue', 
      value: `₦${(stats.totalRevenue / 1000000).toFixed(1)}M`, 
      icon: 'dollarsign.circle.fill', 
      color: colors.warning,
      subtitle: `${completedOrders} completed`
    },
    { 
      label: 'Products', 
      value: stats.totalProducts.toLocaleString(), 
      icon: 'cube.box.fill', 
      color: colors.accent,
      subtitle: `${activeProducts} active`
    },
  ];

  // Get recent orders for activity feed
  const recentOrders = orders.slice(0, 5);

  const quickActions = [
    { title: 'Manage Users', icon: 'person.2.fill', route: '/(admin)/users', color: colors.primary, description: 'View and manage all users' },
    { title: 'View Orders', icon: 'bag.fill', route: '/(admin)/orders', color: colors.success, description: 'Monitor all platform orders' },
    { title: 'Manage Products', icon: 'cube.box.fill', route: '/(admin)/products', color: colors.info, description: 'Review and manage products' },
    { title: 'Reports & Analytics', icon: 'doc.text.fill', route: '/(admin)/reports', color: colors.accent, description: 'Platform insights and metrics' },
    { title: 'Security & Access', icon: 'shield.fill', route: '/(admin)/security', color: colors.error, description: 'Security settings and logs' },
    { title: 'Platform Settings', icon: 'gearshape.fill', route: '/(admin)/settings', color: colors.warning, description: 'Configure platform settings' },
  ];

  const isLoading = ordersLoading || usersLoading || productsLoading;

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Floating Island Header */}
      <View style={styles.floatingHeaderContainer}>
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>ADMIN DASHBOARD</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>
            {user?.displayName || 'Admin'}
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

        <AnimatedPressable
          style={styles.iconIsland}
          onPress={handleLogout}
          scaleValue={0.9}>
          <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color={lightBrown} />
        </AnimatedPressable>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={lightBrown} />
        }>

      <View style={styles.content}>
        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          {displayStats.map((stat, index) => (
            <View
              key={index}
              style={[styles.statCard, { backgroundColor: colors.card }]}>
              <View style={[styles.statIcon, { backgroundColor: `${stat.color}20` }]}>
                <IconSymbol name={stat.icon as any} size={24} color={stat.color} />
              </View>
              <Text style={[styles.statValue, { color: colors.text }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
              {stat.subtitle && (
                <Text style={[styles.statSubtitle, { color: colors.textSecondary }]}>{stat.subtitle}</Text>
              )}
            </View>
          ))}
        </View>

        {/* Quick Actions */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Admin Tools</Text>
        <View style={styles.actionsGrid}>
          {quickActions.map((action, index) => (
            <AnimatedPressable
              key={index}
              style={[styles.actionCard, { backgroundColor: colors.card }]}
              onPress={() => { haptics.light(); router.push(action.route as any); }}
              scaleValue={0.98}>
              <View style={[styles.actionIcon, { backgroundColor: `${action.color}20` }]}>
                <IconSymbol name={action.icon as any} size={28} color={action.color} />
              </View>
              <View style={styles.actionContent}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>{action.title}</Text>
                {action.description && (
                  <Text style={[styles.actionDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                    {action.description}
                  </Text>
                )}
              </View>
              <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
            </AnimatedPressable>
          ))}
        </View>

        {/* Recent Activity */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Orders</Text>
        <View style={[styles.activityCard, { backgroundColor: colors.card }]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : recentOrders.length === 0 ? (
            <View style={styles.emptyContainer}>
              <IconSymbol name="bag" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No recent orders</Text>
            </View>
          ) : (
            <>
              {recentOrders.map((order, index) => (
                <AnimatedPressable
                  key={order.id}
                  style={styles.activityItem}
                  onPress={() => { haptics.light(); router.push(`../orders/${order.id}` as any); }}
                  scaleValue={0.98}>
                  <View style={[styles.activityDot, { backgroundColor: getStatusColor(order.status) }]} />
                  <View style={styles.activityContent}>
                    <Text style={[styles.activityText, { color: colors.text }]}>
                      Order #{order.id?.slice(0, 8)} • ₦{(order.total || 0).toLocaleString()}
                    </Text>
                    <View style={styles.activityMeta}>
                      <Text style={[styles.activityTime, { color: colors.textSecondary }]}>
                        {order.createdAt ? (order.createdAt instanceof Date ? order.createdAt : order.createdAt.toDate()).toLocaleString() : 'N/A'}
                      </Text>
                      <View style={[styles.statusChip, { backgroundColor: `${getStatusColor(order.status)}20` }]}>
                        <Text style={[styles.statusChipText, { color: getStatusColor(order.status) }]}>
                          {order.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
                </AnimatedPressable>
              ))}
              {orders.length > 5 && (
                <AnimatedPressable
                  style={styles.viewAllButton}
                  onPress={() => { haptics.light(); router.push('/(admin)/orders'); }}
                  scaleValue={0.98}>
                  <Text style={[styles.viewAllText, { color: lightBrown }]}>View All Orders</Text>
                  <IconSymbol name="chevron.right" size={16} color={lightBrown} />
                </AnimatedPressable>
              )}
            </>
          )}
        </View>
      </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>, insets: any, lightBrown: string) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingTop: insets.top + 10 + 44 + 15 + 20,
      paddingBottom: 20,
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
    content: {
      padding: 20,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 24,
    },
    statCard: {
      width: '47%',
      padding: 16,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      ...premiumShadow,
    },
    statIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    statValue: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    statLabel: {
      fontSize: 12,
    },
    statSubtitle: {
      fontSize: 10,
      marginTop: 2,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 16,
      marginTop: 8,
    },
    actionsGrid: {
      gap: 12,
      marginBottom: 24,
    },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 20,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
      ...premiumShadow,
    },
    actionIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionContent: {
      flex: 1,
    },
    actionTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    actionDescription: {
      fontSize: 12,
    },
    activityCard: {
      padding: 20,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      ...premiumShadow,
    },
    activityItem: {
      flexDirection: 'row',
      marginBottom: 16,
    },
    activityDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginTop: 6,
      marginRight: 12,
    },
    activityContent: {
      flex: 1,
    },
    activityText: {
      fontSize: 14,
      marginBottom: 4,
    },
    activityTime: {
      fontSize: 12,
    },
    emptyText: {
      fontSize: 14,
      textAlign: 'center',
      padding: 20,
    },
    emptyContainer: {
      alignItems: 'center',
      padding: 40,
      gap: 12,
    },
    loadingContainer: {
      padding: 20,
      alignItems: 'center',
    },
    activityMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    statusChip: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
    },
    statusChipText: {
      fontSize: 10,
      fontWeight: '600',
    },
    viewAllButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      marginTop: 8,
      gap: 4,
    },
    viewAllText: {
      fontSize: 14,
      fontWeight: '600',
    },
  });

function getStatusColor(status: string) {
  switch (status) {
    case 'Completed':
    case 'Received':
      return '#28A745';
    case 'Processing':
      return '#FFC107';
    case 'Sent':
      return '#17A2B8';
    case 'Cancelled':
    case 'Disputed':
      return '#DC3545';
    default:
      return '#6C757D';
  }
}

