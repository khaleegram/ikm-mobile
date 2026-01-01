// Admin orders management
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useAllOrders } from '@/lib/firebase/firestore/admin';
import { adminApi } from '@/lib/api/admin';
import { OrderStatus } from '@/types';
import { useState, useMemo } from 'react';
import { Alert } from 'react-native';

export default function AdminOrders() {
  const { colors } = useTheme();
  const { orders, loading } = useAllOrders();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const styles = createStyles(colors);

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
    const orderDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A';
    
    return (
      <TouchableOpacity
        style={[styles.orderCard, { backgroundColor: colors.card }]}
        onPress={() => router.push(`../orders/${item.id}` as any)}
        activeOpacity={0.7}>
        <View style={styles.orderHeader}>
          <View>
            <Text style={[styles.orderId, { color: colors.text }]}>
              Order #{item.id?.slice(0, 8)}
            </Text>
            <Text style={[styles.customerName, { color: colors.textSecondary }]}>
              {customerName}
            </Text>
            {item.customerInfo?.email && (
              <Text style={[styles.customerEmail, { color: colors.textTertiary }]}>
                {item.customerInfo.email}
              </Text>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
              {item.status}
            </Text>
          </View>
        </View>
        <View style={styles.orderFooter}>
          <Text style={[styles.amount, { color: colors.primary }]}>
            ₦{(item.total || 0).toLocaleString()}
          </Text>
          <Text style={[styles.date, { color: colors.textSecondary }]}>{orderDate}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>All Orders</Text>
        
        {/* Search */}
        <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
          <IconSymbol name="magnifyingglass" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search orders..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Status Filter */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}>
          {statusOptions.map((status) => (
            <TouchableOpacity
              key={status}
              style={[
                styles.filterChip,
                {
                  backgroundColor: statusFilter === status ? colors.primary : colors.backgroundSecondary,
                  borderColor: statusFilter === status ? colors.primary : colors.cardBorder,
                }
              ]}
              onPress={() => setStatusFilter(status)}>
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
          <ActivityIndicator size="large" color={colors.primary} />
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

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingTop: 60,
      paddingBottom: 20,
      paddingHorizontal: 20,
      ...premiumShadow,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      marginTop: 16,
      gap: 12,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
    },
    filterContainer: {
      marginTop: 16,
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
    title: {
      fontSize: 28,
      fontWeight: 'bold',
    },
    list: {
      padding: 20,
    },
    orderCard: {
      padding: 16,
      borderRadius: 16,
      marginBottom: 12,
      ...premiumShadow,
    },
    orderHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 12,
    },
    orderId: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    customerName: {
      fontSize: 14,
    },
    statusBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '600',
    },
    orderFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    amount: {
      fontSize: 18,
      fontWeight: 'bold',
    },
    date: {
      fontSize: 12,
    },
    customerEmail: {
      fontSize: 12,
      marginTop: 2,
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
  });

