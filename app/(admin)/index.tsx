// Admin dashboard
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useUser } from '@/lib/firebase/auth/use-user';
import { LinearGradient } from 'expo-linear-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemeToggle } from '@/components/theme-toggle';
import { router } from 'expo-router';
import { premiumCard, premiumShadow } from '@/lib/theme/styles';
import { usePlatformStats, useAllOrders, useAllUsers, useAllProducts } from '@/lib/firebase/firestore/admin';
import { useState } from 'react';
import { Order } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AdminDashboard() {
  const { colors, colorScheme } = useTheme();
  const { user, signOut } = useUser();
  const stats = usePlatformStats();
  const { orders, loading: ordersLoading } = useAllOrders();
  const { users, loading: usersLoading } = useAllUsers();
  const { products, loading: productsLoading } = useAllProducts();
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  const onRefresh = async () => {
    setRefreshing(true);
    // Force refresh by waiting a bit (data will auto-update via Firestore listeners)
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleLogout = () => {
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
    <ScrollView 
      style={styles.container} 
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }>
      {/* Header with gradient */}
      <LinearGradient
        colors={colorScheme === 'light' 
          ? [colors.primary, colors.accent] 
          : [colors.gradientStart, colors.gradientEnd]}
        style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <View style={[styles.badge, { backgroundColor: 'rgba(255, 255, 255, 0.25)' }]}>
              <IconSymbol name="shield.fill" size={28} color="#fff" />
            </View>
            <View>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.adminName}>{user?.displayName || 'Admin'}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <ThemeToggle />
            <TouchableOpacity
              style={[styles.logoutButton, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}
              onPress={handleLogout}
              activeOpacity={0.7}>
              <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          {displayStats.map((stat, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.statCard, { backgroundColor: colors.card }]}
              activeOpacity={0.7}>
              <View style={[styles.statIcon, { backgroundColor: `${stat.color}20` }]}>
                <IconSymbol name={stat.icon as any} size={24} color={stat.color} />
              </View>
              <Text style={[styles.statValue, { color: colors.text }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
              {stat.subtitle && (
                <Text style={[styles.statSubtitle, { color: colors.textSecondary }]}>{stat.subtitle}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick Actions */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Admin Tools</Text>
        <View style={styles.actionsGrid}>
          {quickActions.map((action, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.actionCard, { backgroundColor: colors.card }]}
              onPress={() => router.push(action.route as any)}
              activeOpacity={0.7}>
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
            </TouchableOpacity>
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
                <TouchableOpacity
                  key={order.id}
                  style={styles.activityItem}
                  onPress={() => router.push(`../orders/${order.id}` as any)}
                  activeOpacity={0.7}>
                  <View style={[styles.activityDot, { backgroundColor: getStatusColor(order.status) }]} />
                  <View style={styles.activityContent}>
                    <Text style={[styles.activityText, { color: colors.text }]}>
                      Order #{order.id?.slice(0, 8)} • ₦{(order.total || 0).toLocaleString()}
                    </Text>
                    <View style={styles.activityMeta}>
                      <Text style={[styles.activityTime, { color: colors.textSecondary }]}>
                        {new Date(order.createdAt).toLocaleString()}
                      </Text>
                      <View style={[styles.statusChip, { backgroundColor: `${getStatusColor(order.status)}20` }]}>
                        <Text style={[styles.statusChipText, { color: getStatusColor(order.status) }]}>
                          {order.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
              {orders.length > 5 && (
                <TouchableOpacity
                  style={styles.viewAllButton}
                  onPress={() => router.push('/(admin)/orders')}
                  activeOpacity={0.7}>
                  <Text style={[styles.viewAllText, { color: colors.primary }]}>View All Orders</Text>
                  <IconSymbol name="chevron.right" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingBottom: 32,
      paddingHorizontal: 20,
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
      ...premiumShadow,
    },
    headerContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    logoutButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    welcomeText: {
      fontSize: 16,
      color: 'rgba(255, 255, 255, 0.8)',
      marginBottom: 4,
    },
    adminName: {
      fontSize: 28,
      fontWeight: 'bold',
      color: '#fff',
    },
    badge: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      alignItems: 'center',
      justifyContent: 'center',
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
      borderRadius: 16,
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
      borderRadius: 16,
      gap: 12,
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
      borderRadius: 16,
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

