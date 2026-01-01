// Analytics and reporting screen
import { useUser } from '@/lib/firebase/auth/use-user';
import { useSellerOrders } from '@/lib/firebase/firestore/orders';
import { useSellerProducts } from '@/lib/firebase/firestore/products';
import { OrderStatus } from '@/types';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/lib/theme/theme-context';
import { premiumShadow, premiumCard, premiumShadowSmall } from '@/lib/theme/styles';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AnalyticsScreen() {
  const { user } = useUser();
  const { orders, loading: ordersLoading } = useSellerOrders(user?.uid || null);
  const { products, loading: productsLoading } = useSellerProducts(user?.uid || null);
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  const analytics = useMemo(() => {
    if (!orders || !products) {
      return null;
    }

    // Calculate total revenue
    const totalRevenue = orders
      .filter((o) => o.status !== 'Cancelled' && o.status !== 'Disputed')
      .reduce((sum, order) => sum + (order.total || 0), 0);

    // Calculate revenue by status
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

    // Total orders
    const totalOrders = orders.length;
    const completedOrders = (orderCounts.Completed || 0) + (orderCounts.Received || 0);
    const cancelledOrders = orderCounts.Cancelled || 0;
    const disputedOrders = orderCounts.Disputed || 0;

    // Average order value
    const averageOrderValue =
      totalOrders > 0 ? totalRevenue / (totalOrders - cancelledOrders - disputedOrders) : 0;

    // Products statistics - using status field instead of isActive
    const activeProducts = products.filter((p) => p.status === 'active').length;
    const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
    const lowStockProducts = products.filter((p) => p.stock < 10 && p.status === 'active').length;

    // Recent orders (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentOrders = orders.filter(
      (o) => new Date(o.createdAt) >= sevenDaysAgo
    ).length;

    // Recent revenue (last 7 days)
    const recentRevenue = orders
      .filter(
        (o) =>
          new Date(o.createdAt) >= sevenDaysAgo && o.status !== 'Cancelled' && o.status !== 'Disputed'
      )
      .reduce((sum, order) => sum + (order.total || 0), 0);

    // Conversion and completion rates
    const conversionRate = totalOrders > 0 
      ? ((completedOrders / (totalOrders - cancelledOrders)) * 100) 
      : 0;
    const completionRate = totalOrders > 0 
      ? ((completedOrders / totalOrders) * 100) 
      : 0;
    const cancellationRate = totalOrders > 0 
      ? ((cancelledOrders / totalOrders) * 100) 
      : 0;

    // Average delivery time (for completed/received orders)
    const completedOrdersList = orders.filter((o) => o.status === 'Completed' || o.status === 'Received');
    const avgDeliveryTime = completedOrdersList.length > 0
      ? completedOrdersList.reduce((sum, order) => {
          const completedAt = order.receivedAt || order.updatedAt || order.createdAt;
          const deliveryTime = new Date(completedAt).getTime() - new Date(order.createdAt).getTime();
          return sum + deliveryTime;
        }, 0) / completedOrdersList.length
      : 0;
    const avgDeliveryDays = avgDeliveryTime / (1000 * 60 * 60 * 24);

    // Top products by revenue
    const productRevenue = orders
      .filter((o) => o.status !== 'Cancelled' && o.status !== 'Disputed')
      .reduce((acc, order) => {
        order.items.forEach((item) => {
          const subtotal = item.quantity * item.price;
          acc[item.productId] = (acc[item.productId] || 0) + subtotal;
        });
        return acc;
      }, {} as Record<string, number>);

    const topProducts = Object.entries(productRevenue)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([productId, revenue]) => {
        const product = products.find((p) => p.id === productId);
        return {
          productId,
          name: product?.name || 'Unknown Product',
          revenue,
          quantity: orders
            .filter((o) => o.status !== 'Cancelled')
            .reduce((sum, order) => {
              const item = order.items.find((i) => i.productId === productId);
              return sum + (item?.quantity || 0);
            }, 0),
        };
      });

    // Revenue trends (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyRevenue: Record<string, number> = {};
    
    orders
      .filter((o) => new Date(o.createdAt) >= thirtyDaysAgo && o.status !== 'Cancelled')
      .forEach((order) => {
        const date = new Date(order.createdAt).toISOString().split('T')[0];
        dailyRevenue[date] = (dailyRevenue[date] || 0) + (order.total || 0);
      });

    const revenueTrend = Object.entries(dailyRevenue)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7) // Last 7 days
      .map(([date, revenue]) => ({
        date,
        revenue,
        day: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
      }));

    // Monthly revenue (last 3 months)
    const monthlyRevenue: Record<string, number> = {};
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    orders
      .filter((o) => new Date(o.createdAt) >= threeMonthsAgo && o.status !== 'Cancelled' && o.status !== 'Disputed')
      .forEach((order) => {
        const month = new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        monthlyRevenue[month] = (monthlyRevenue[month] || 0) + (order.total || 0);
      });

    // Product performance metrics
    const productPerformance = products.map((product) => {
      const productOrders = orders.filter((o) =>
        o.items.some((item) => item.productId === product.id)
      );
      const productRevenue = productOrders
        .filter((o) => o.status !== 'Cancelled' && o.status !== 'Disputed')
        .reduce((sum, order) => {
          const item = order.items.find((i) => i.productId === product.id);
          return sum + ((item ? item.quantity * item.price : 0));
        }, 0);
      const unitsSold = productOrders
        .filter((o) => o.status !== 'Cancelled' && o.status !== 'Disputed')
        .reduce((sum, order) => {
          const item = order.items.find((i) => i.productId === product.id);
          return sum + (item?.quantity || 0);
        }, 0);

      return {
        id: product.id,
        name: product.name,
        revenue: productRevenue,
        unitsSold,
        ordersCount: productOrders.length,
        conversionRate: productOrders.length > 0 
          ? (productOrders.filter((o) => o.status === 'Completed' || o.status === 'Received').length / productOrders.length) * 100 
          : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

    // Time-based metrics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter((o) => new Date(o.createdAt) >= today);
    const todayRevenue = todayOrders
      .filter((o) => o.status !== 'Cancelled' && o.status !== 'Disputed')
      .reduce((sum, order) => sum + (order.total || 0), 0);

    const thisWeek = new Date();
    thisWeek.setDate(thisWeek.getDate() - 7);
    const weekOrders = orders.filter((o) => new Date(o.createdAt) >= thisWeek);
    const weekRevenue = weekOrders
      .filter((o) => o.status !== 'Cancelled' && o.status !== 'Disputed')
      .reduce((sum, order) => sum + (order.total || 0), 0);

    const thisMonth = new Date();
    thisMonth.setMonth(thisMonth.getMonth() - 1);
    const monthOrders = orders.filter((o) => new Date(o.createdAt) >= thisMonth);
    const monthRevenue = monthOrders
      .filter((o) => o.status !== 'Cancelled' && o.status !== 'Disputed')
      .reduce((sum, order) => sum + (order.total || 0), 0);

    return {
      totalRevenue,
      revenueByStatus,
      totalOrders,
      completedOrders,
      cancelledOrders,
      disputedOrders,
      averageOrderValue,
      activeProducts,
      totalStock,
      lowStockProducts,
      recentOrders,
      recentRevenue,
      orderCounts,
      // New metrics
      conversionRate,
      completionRate,
      cancellationRate,
      avgDeliveryDays,
      topProducts,
      revenueTrend,
      monthlyRevenue,
      productPerformance,
      todayRevenue,
      weekRevenue,
      monthRevenue,
      todayOrders: todayOrders.length,
      weekOrders: weekOrders.length,
      monthOrders: monthOrders.length,
    };
  }, [orders, products]);

  if (ordersLoading || productsLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!analytics) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>No data available</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      {/* Premium Header with Gradient */}
      <LinearGradient
        colors={colorScheme === 'light' 
          ? [colors.primary, colors.accent] 
          : [colors.gradientStart, colors.gradientEnd]}
        style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.title}>Analytics & Reports</Text>
            <Text style={styles.subtitle}>Track your business performance</Text>
          </View>
          <View style={[styles.iconContainer, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
            <IconSymbol name="chart.bar.fill" size={24} color="#FFFFFF" />
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* Revenue Overview */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Revenue Overview</Text>
          <LinearGradient
            colors={[colors.primary, colors.accent]}
            style={styles.statCard}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}>
            <Text style={styles.statValue}>₦{analytics.totalRevenue.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Total Revenue</Text>
          </LinearGradient>
          <View style={styles.statRow}>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>
                ₦{analytics.recentRevenue.toLocaleString()}
              </Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Last 7 Days</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>
                ₦{analytics.averageOrderValue.toLocaleString()}
              </Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Avg Order Value</Text>
            </View>
          </View>
        </View>

        {/* Orders Overview */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Orders Overview</Text>
          <View style={styles.statRow}>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>{analytics.totalOrders}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Total Orders</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.success }]}>{analytics.completedOrders}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Completed</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.info }]}>{analytics.recentOrders}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Last 7 Days</Text>
            </View>
          </View>
        </View>

        {/* Order Status Breakdown */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Order Status</Text>
          <View style={styles.statusContainer}>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Processing</Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>{analytics.orderCounts.Processing || 0}</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: colors.info }]} />
              <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Shipped</Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>{analytics.orderCounts.Shipped || 0}</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: colors.info }]} />
              <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Sent</Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>{analytics.orderCounts.Sent || 0}</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Received</Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>{analytics.orderCounts.Received || 0}</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Completed</Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>{analytics.orderCounts.Completed || 0}</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: colors.error }]} />
              <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Cancelled</Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>{analytics.orderCounts.Cancelled || 0}</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: '#FF6B6B' }]} />
              <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Disputed</Text>
              <Text style={[styles.statusValue, { color: colors.text }]}>{analytics.orderCounts.Disputed || 0}</Text>
            </View>
          </View>
        </View>

        {/* Products Overview */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Products Overview</Text>
          <View style={styles.statRow}>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>{analytics.activeProducts}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Active Products</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.info }]}>{analytics.totalStock}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Total Stock</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: analytics.lowStockProducts > 0 ? colors.error : colors.primary }]}>
                {analytics.lowStockProducts}
              </Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Low Stock</Text>
            </View>
          </View>
        </View>

        {/* Revenue by Status */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Revenue by Status</Text>
          <View style={styles.revenueContainer}>
            <View style={styles.revenueItem}>
              <Text style={[styles.revenueLabel, { color: colors.textSecondary }]}>Processing</Text>
              <Text style={[styles.revenueValue, { color: colors.primary }]}>
                ₦{(analytics.revenueByStatus.Processing || 0).toLocaleString()}
              </Text>
            </View>
            <View style={styles.revenueItem}>
              <Text style={[styles.revenueLabel, { color: colors.textSecondary }]}>Sent</Text>
              <Text style={[styles.revenueValue, { color: colors.primary }]}>
                ₦{(analytics.revenueByStatus.Sent || 0).toLocaleString()}
              </Text>
            </View>
            <View style={styles.revenueItem}>
              <Text style={[styles.revenueLabel, { color: colors.textSecondary }]}>Received</Text>
              <Text style={[styles.revenueValue, { color: colors.success }]}>
                ₦{(analytics.revenueByStatus.Received || 0).toLocaleString()}
              </Text>
            </View>
            <View style={styles.revenueItem}>
              <Text style={[styles.revenueLabel, { color: colors.textSecondary }]}>Completed</Text>
              <Text style={[styles.revenueValue, { color: colors.success }]}>
                ₦{(analytics.revenueByStatus.Completed || 0).toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* Performance Metrics */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Performance Metrics</Text>
          <View style={styles.statRow}>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.success }]}>{analytics.completionRate.toFixed(1)}%</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Completion Rate</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.info }]}>{analytics.conversionRate.toFixed(1)}%</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Conversion Rate</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>
                {analytics.avgDeliveryDays > 0 ? analytics.avgDeliveryDays.toFixed(1) : 'N/A'}
              </Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Avg Delivery (days)</Text>
            </View>
          </View>
          <View style={[styles.metricRow, { borderTopColor: colors.cardBorder }]}>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Cancellation Rate:</Text>
            <Text style={[styles.metricValue, { color: analytics.cancellationRate > 10 ? colors.error : colors.text }]}>
              {analytics.cancellationRate.toFixed(1)}%
            </Text>
          </View>
        </View>

        {/* Time-based Revenue */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Revenue by Period</Text>
          <View style={styles.statRow}>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>₦{analytics.todayRevenue.toLocaleString()}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>Today</Text>
              <Text style={[styles.statSubLabel, { color: colors.textTertiary }]}>{analytics.todayOrders} orders</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>₦{analytics.weekRevenue.toLocaleString()}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>This Week</Text>
              <Text style={[styles.statSubLabel, { color: colors.textTertiary }]}>{analytics.weekOrders} orders</Text>
            </View>
            <View style={[styles.statCardSmall, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.statValueSmall, { color: colors.primary }]}>₦{analytics.monthRevenue.toLocaleString()}</Text>
              <Text style={[styles.statLabelSmall, { color: colors.textSecondary }]}>This Month</Text>
              <Text style={[styles.statSubLabel, { color: colors.textTertiary }]}>{analytics.monthOrders} orders</Text>
            </View>
          </View>
        </View>

        {/* Top Products */}
        {analytics.topProducts.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Products by Revenue</Text>
            {analytics.topProducts.map((product, index) => (
              <View key={product.productId} style={[styles.productItem, { borderBottomColor: colors.cardBorder }]}>
                <View style={[styles.productRank, { backgroundColor: colors.primary }]}>
                  <Text style={styles.rankNumber}>{index + 1}</Text>
                </View>
                <View style={styles.productInfo}>
                  <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={[styles.productDetails, { color: colors.textSecondary }]}>
                    {product.quantity} sold • ₦{product.revenue.toLocaleString()}
                  </Text>
                </View>
                <Text style={[styles.productRevenue, { color: colors.primary }]}>
                  ₦{product.revenue.toLocaleString()}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Revenue Trend */}
        {analytics.revenueTrend.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Revenue Trend (Last 7 Days)</Text>
            {analytics.revenueTrend.map((day) => (
              <View key={day.date} style={[styles.trendItem, { borderBottomColor: colors.cardBorder }]}>
                <View style={styles.trendDay}>
                  <Text style={[styles.trendDayName, { color: colors.text }]}>{day.day}</Text>
                  <Text style={[styles.trendDate, { color: colors.textSecondary }]}>
                    {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <Text style={[styles.trendValue, { color: colors.primary }]}>₦{day.revenue.toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Monthly Revenue */}
        {Object.keys(analytics.monthlyRevenue).length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Monthly Revenue (Last 3 Months)</Text>
            {Object.entries(analytics.monthlyRevenue)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([month, revenue]) => (
                <View key={month} style={[styles.revenueItem, { borderBottomColor: colors.cardBorder }]}>
                  <Text style={[styles.revenueLabel, { color: colors.textSecondary }]}>{month}</Text>
                  <Text style={[styles.revenueValue, { color: colors.primary }]}>₦{revenue.toLocaleString()}</Text>
                </View>
              ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingTop: 60,
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
    padding: 16,
  },
  section: {
    ...premiumCard(colors),
    marginBottom: 16,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  statCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    ...premiumShadow,
  },
  statValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    opacity: 0.95,
    fontWeight: '600',
  },
  statRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCardSmall: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    ...premiumShadowSmall,
  },
  statValueSmall: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  statLabelSmall: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusContainer: {
    gap: 12,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 14,
  },
  statusLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  statusValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  revenueContainer: {
    gap: 8,
  },
  revenueItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  revenueLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  revenueValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  metricLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  metricValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  statSubLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
  },
  productItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  productRank: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    ...premiumShadowSmall,
  },
  rankNumber: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  productDetails: {
    fontSize: 13,
    fontWeight: '500',
  },
  productRevenue: {
    fontSize: 17,
    fontWeight: 'bold',
  },
  trendItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  trendDay: {
    flex: 1,
  },
  trendDayName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  trendDate: {
    fontSize: 13,
    fontWeight: '500',
  },
  trendValue: {
    fontSize: 17,
    fontWeight: '700',
  },
});

