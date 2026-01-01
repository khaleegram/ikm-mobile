// Admin reports and analytics
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useMemo, useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow, premiumCard } from '@/lib/theme/styles';
import { usePlatformStats, useAllOrders, useAllUsers, useAllProducts } from '@/lib/firebase/firestore/admin';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OrderStatus } from '@/types';

export default function AdminReports() {
  const { colors, colorScheme } = useTheme();
  const stats = usePlatformStats();
  const { orders, loading: ordersLoading } = useAllOrders();
  const { users, loading: usersLoading } = useAllUsers();
  const { products, loading: productsLoading } = useAllProducts();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const styles = createStyles(colors);

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  // Calculate detailed analytics
  const analytics = useMemo(() => {
    // Revenue by status
    const revenueByStatus = orders.reduce(
      (acc, order) => {
        if (order.status !== 'Cancelled' && order.status !== 'Disputed') {
          acc[order.status] = (acc[order.status] || 0) + (order.total || 0);
        }
        return acc;
      },
      {} as Record<OrderStatus, number>
    );

    // Order counts by status
    const orderCounts = orders.reduce(
      (acc, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      },
      {} as Record<OrderStatus, number>
    );

    // Revenue trend (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const revenueTrend = new Array(30).fill(0).map((_, i) => {
      const date = new Date(thirtyDaysAgo);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      return {
        date: dateKey,
        revenue: orders
          .filter(o => {
            if (!o.createdAt) return false;
            const orderDate = new Date(o.createdAt);
            return orderDate.toISOString().split('T')[0] === dateKey &&
              o.status !== 'Cancelled' && o.status !== 'Disputed';
          })
          .reduce((sum, order) => sum + (order.total || 0), 0),
      };
    });

    // Top sellers
    const sellerRevenue = orders.reduce((acc, order) => {
      if (order.status !== 'Cancelled' && order.status !== 'Disputed') {
        acc[order.sellerId] = (acc[order.sellerId] || 0) + (order.total || 0);
      }
      return acc;
    }, {} as Record<string, number>);

    const topSellers = Object.entries(sellerRevenue)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([sellerId, revenue]) => {
        const seller = users.find(u => u.id === sellerId);
        return {
          sellerId,
          name: seller?.storeName || seller?.displayName || 'Unknown Seller',
          revenue,
        };
      });

    // User growth (last 30 days)
    const userGrowth = new Array(30).fill(0).map((_, i) => {
      const date = new Date(thirtyDaysAgo);
      date.setDate(date.getDate() + i);
      return {
        date: date.toISOString().split('T')[0],
        count: users.filter(u => {
          if (!u.createdAt) return false;
          const userDate = new Date(u.createdAt);
          return userDate.toISOString().split('T')[0] === date.toISOString().split('T')[0];
        }).length,
      };
    });

    return {
      revenueByStatus,
      orderCounts,
      revenueTrend,
      topSellers,
      userGrowth,
    };
  }, [orders, users]);

  const overviewStats = [
    { 
      label: 'Total Revenue', 
      value: `₦${(stats.totalRevenue / 1000000).toFixed(2)}M`, 
      icon: 'dollarsign.circle.fill', 
      color: colors.success 
    },
    { 
      label: 'Total Users', 
      value: stats.totalUsers.toLocaleString(), 
      icon: 'person.2.fill', 
      color: colors.primary 
    },
    { 
      label: 'Total Orders', 
      value: stats.totalOrders.toLocaleString(), 
      icon: 'bag.fill', 
      color: colors.info 
    },
    { 
      label: 'Active Products', 
      value: stats.activeProducts.toLocaleString(), 
      icon: 'cube.box.fill', 
      color: colors.accent 
    },
  ];

  const isLoading = ordersLoading || usersLoading || productsLoading;

  return (
    <ScrollView 
      style={styles.container} 
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }>
      {/* Header */}
      <LinearGradient
        colors={colorScheme === 'light' 
          ? [colors.primary, colors.accent] 
          : [colors.gradientStart, colors.gradientEnd]}
        style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.title}>Reports & Analytics</Text>
            <Text style={styles.subtitle}>Platform insights and metrics</Text>
          </View>
          <View style={[styles.iconContainer, { backgroundColor: colorScheme === 'light' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.2)' }]}>
            <IconSymbol name="chart.bar.fill" size={24} color="#FFFFFF" />
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* Overview Stats */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Overview</Text>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <View style={styles.statsGrid}>
            {overviewStats.map((stat, index) => (
              <View key={index} style={[styles.statCard, { backgroundColor: colors.card }]}>
                <View style={[styles.statIcon, { backgroundColor: `${stat.color}20` }]}>
                  <IconSymbol name={stat.icon as any} size={24} color={stat.color} />
                </View>
                <Text style={[styles.statValue, { color: colors.text }]}>{stat.value}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Revenue by Status */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Revenue by Order Status</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
          {Object.entries(analytics.revenueByStatus).map(([status, revenue]) => (
            <View key={status} style={[styles.revenueRow, { borderBottomColor: colors.cardBorder }]}>
              <Text style={[styles.revenueLabel, { color: colors.text }]}>{status}</Text>
              <Text style={[styles.revenueValue, { color: colors.primary }]}>
                ₦{revenue.toLocaleString()}
              </Text>
            </View>
          ))}
        </View>

        {/* Order Counts by Status */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Orders by Status</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
          {Object.entries(analytics.orderCounts).map(([status, count]) => (
            <View key={status} style={[styles.orderRow, { borderBottomColor: colors.cardBorder }]}>
              <Text style={[styles.orderLabel, { color: colors.text }]}>{status}</Text>
              <Text style={[styles.orderValue, { color: colors.text }]}>{count}</Text>
            </View>
          ))}
        </View>

        {/* Top Sellers */}
        {analytics.topSellers.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Sellers</Text>
            <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
              {analytics.topSellers.map((seller, index) => (
                <View key={seller.sellerId} style={[styles.sellerRow, { borderBottomColor: colors.cardBorder }]}>
                  <View style={styles.sellerRank}>
                    <Text style={[styles.rankText, { color: colors.textSecondary }]}>#{index + 1}</Text>
                  </View>
                  <View style={styles.sellerInfo}>
                    <Text style={[styles.sellerName, { color: colors.text }]}>{seller.name}</Text>
                  </View>
                  <Text style={[styles.sellerRevenue, { color: colors.primary }]}>
                    ₦{(seller.revenue / 1000).toFixed(0)}K
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* User Breakdown */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>User Breakdown</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.card }]}>
          <View style={[styles.userRow, { borderBottomColor: colors.cardBorder }]}>
            <Text style={[styles.userLabel, { color: colors.text }]}>Total Users</Text>
            <Text style={[styles.userValue, { color: colors.text }]}>{stats.totalUsers}</Text>
          </View>
          <View style={[styles.userRow, { borderBottomColor: colors.cardBorder }]}>
            <Text style={[styles.userLabel, { color: colors.text }]}>Sellers</Text>
            <Text style={[styles.userValue, { color: colors.text }]}>{stats.totalSellers}</Text>
          </View>
          <View style={styles.userRow}>
            <Text style={[styles.userLabel, { color: colors.text }]}>Customers</Text>
            <Text style={[styles.userValue, { color: colors.text }]}>{stats.totalCustomers}</Text>
          </View>
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
      paddingBottom: 24,
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
    title: {
      fontSize: 32,
      fontWeight: 'bold',
      color: '#FFFFFF',
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 16,
      color: 'rgba(255, 255, 255, 0.9)',
    },
    iconContainer: {
      width: 56,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      padding: 20,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 16,
      marginTop: 8,
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
    sectionCard: {
      padding: 20,
      borderRadius: 16,
      marginBottom: 24,
      ...premiumShadow,
    },
    revenueRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    revenueLabel: {
      fontSize: 14,
      fontWeight: '500',
    },
    revenueValue: {
      fontSize: 16,
      fontWeight: 'bold',
    },
    orderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    orderLabel: {
      fontSize: 14,
      fontWeight: '500',
    },
    orderValue: {
      fontSize: 16,
      fontWeight: 'bold',
    },
    sellerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      gap: 12,
    },
    sellerRank: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.backgroundSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankText: {
      fontSize: 14,
      fontWeight: 'bold',
    },
    sellerInfo: {
      flex: 1,
    },
    sellerName: {
      fontSize: 14,
      fontWeight: '500',
    },
    sellerRevenue: {
      fontSize: 16,
      fontWeight: 'bold',
    },
    userRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    userLabel: {
      fontSize: 14,
      fontWeight: '500',
    },
    userValue: {
      fontSize: 16,
      fontWeight: 'bold',
    },
    loadingContainer: {
      padding: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

