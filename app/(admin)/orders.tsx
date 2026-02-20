// Admin orders management
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAllOrders } from '@/lib/firebase/firestore/admin';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { OrderStatus } from '@/types';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AdminOrders() {
  const { colors, colorScheme, toggleTheme } = useTheme();
  const { orders, loading } = useAllOrders();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const insets = useSafeAreaInsets();
  const lightBrown = '#A67C52';
  const styles = createStyles(colors, insets, lightBrown);

  // Filter orders
  const filteredOrders = useMemo(() => {
    let filtered = orders;

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status === statusFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(order => 
        order.id?.toLowerCase().includes(query) ||
        order.customerInfo?.name?.toLowerCase().includes(query) ||
        order.customerInfo?.email?.toLowerCase().includes(query) ||
        order.sellerId?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [orders, statusFilter, searchQuery]);

  const statusOptions: (OrderStatus | 'all')[] = ['all', 'Processing', 'Sent', 'Received', 'Completed', 'Cancelled', 'Disputed'];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
      case 'Received':
        return colors.success;
      case 'Processing':
        return colors.warning;
      case 'Sent':
        return colors.info;
      case 'Cancelled':
      case 'Disputed':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const renderOrder = ({ item }: { item: typeof orders[0] }) => {
    const customerName = item.customerInfo?.name || 'Guest Customer';
    const statusColor = getStatusColor(item.status);
    
    return (
      <AnimatedPressable
        style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => { haptics.light(); router.push(`../orders/${item.id}` as any); }}
        scaleValue={0.98}>
        <View style={styles.cardTop}>
          <View style={styles.orderIdentity}>
            <IconSymbol name="person.fill" size={16} color={colors.primary} />
            <View>
              <Text style={[styles.customerName, { color: colors.text }]}>
                {customerName.split(' ')[0]}
              </Text>
              <Text style={[styles.orderSubtext, { color: colors.textSecondary }]} numberOfLines={1}>
                {(() => {
                  const productNames = item.items.length > 1 
                    ? `${item.items[0].name} +${item.items.length - 1} more`
                    : item.items[0]?.name || 'No items';
                  const dateStr = item.createdAt 
                    ? (item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : 'N/A';
                  return `${productNames} • ${dateStr}`;
                })()}
              </Text>
            </View>
          </View>
          <View style={[styles.statusPill, { backgroundColor: `${statusColor}20` }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusPillText, { color: statusColor }]}>{item.status}</Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.itemsInfo}>
            <IconSymbol name="bag.fill" size={14} color={colors.textSecondary} />
            <Text style={[styles.itemsCount, { color: colors.textSecondary }]}>
              {item.items.length} {item.items.length === 1 ? 'Product' : 'Products'}
            </Text>
          </View>
          <Text style={[styles.orderTotal, { color: colors.text }]}>
            ₦{(item.total || 0).toLocaleString()}
          </Text>
        </View>

        <View style={styles.cardFooter}>
          <Text style={[styles.viewDetails, { color: lightBrown }]}>View Transaction Details</Text>
          <IconSymbol name="chevron.right" size={14} color={lightBrown} />
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
          <Text style={styles.islandLabel}>ALL ORDERS</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>
            {orders.length} Total
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
            placeholder="Search orders..."
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Status Filter */}
      <View style={styles.filterContainer}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}>
          {statusOptions.map((status) => (
            <TouchableOpacity
              key={status}
              style={[
                styles.filterChip,
                {
                  backgroundColor: statusFilter === status ? lightBrown : colors.backgroundSecondary,
                  borderColor: statusFilter === status ? lightBrown : colors.cardBorder,
                }
              ]}
              onPress={() => { haptics.light(); setStatusFilter(status); }}>
              <Text style={[
                styles.filterChipText,
                { color: statusFilter === status ? '#fff' : colors.text }
              ]}>
                {status === 'all' ? 'All' : status}
              </Text>
              {status !== 'all' && (
                <View style={[styles.filterBadge, { backgroundColor: statusFilter === status ? 'rgba(255,255,255,0.3)' : colors.cardBorder }]}>
                  <Text style={[styles.filterBadgeText, { color: statusFilter === status ? '#fff' : colors.textSecondary }]}>
                    {orders.filter(o => o.status === status).length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      ) : (
        <>
          {filteredOrders.length > 0 && (
            <View style={styles.statsBar}>
              <Text style={[styles.statsText, { color: colors.textSecondary }]}>
                Showing {filteredOrders.length} of {orders.length} orders
              </Text>
            </View>
          )}
          <FlatList
            data={filteredOrders}
            renderItem={renderOrder}
            keyExtractor={(item) => item.id || ''}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <IconSymbol name="bag.fill" size={64} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {searchQuery || statusFilter !== 'all' ? 'No orders found' : 'No orders yet'}
                </Text>
              </View>
            }
          />
        </>
      )}
    </View>
  );
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
    filterContainer: {
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    filterContent: {
      gap: 8,
      paddingRight: 20,
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      gap: 8,
    },
    filterChipText: {
      fontSize: 14,
      fontWeight: '600',
    },
    filterBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      minWidth: 24,
      alignItems: 'center',
    },
    filterBadgeText: {
      fontSize: 12,
      fontWeight: '600',
    },
    statsBar: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    statsText: {
      fontSize: 14,
    },
    list: {
      padding: 20,
      paddingBottom: 100,
    },
    orderCard: {
      padding: 16,
      borderRadius: 24,
      borderWidth: 1,
      marginBottom: 16,
      ...premiumShadow,
    },
    cardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    orderIdentity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    customerName: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 2,
    },
    orderSubtext: {
      fontSize: 12,
      fontWeight: '500',
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
      gap: 6,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusPillText: {
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    cardBody: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: 16,
    },
    itemsInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    itemsCount: {
      fontSize: 14,
      fontWeight: '500',
    },
    orderTotal: {
      fontSize: 22,
      fontWeight: '800',
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    viewDetails: {
      fontSize: 13,
      fontWeight: '700',
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      padding: 40,
      alignItems: 'center',
      gap: 16,
    },
    emptyText: {
      fontSize: 16,
      textAlign: 'center',
    },
  });

