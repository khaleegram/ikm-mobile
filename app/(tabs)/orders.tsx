// Modern Orders List Screen - Floating Island Design
import { AnimatedListItem } from '@/components/animated-list-item';
import { AnimatedPressable } from '@/components/animated-pressable';
import { EmptyState } from '@/components/empty-state';
import { SkeletonOrderCard } from '@/components/skeleton-loader';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useSellerOrders } from '@/lib/firebase/firestore/orders';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { Order, OrderStatus } from '@/types';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Platform, RefreshControl, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const getStatusColor = (status: OrderStatus, colors: any): string => {
  const statusColors: Record<OrderStatus, string> = {
    Processing: colors.warning || '#F5A623',
    Sent: colors.info || '#4A90E2',
    Received: colors.success || '#4CAF50',
    Completed: colors.success || '#4CAF50',
    Cancelled: colors.error || '#F44336',
    Disputed: '#FF6B6B',
    AvailabilityCheck: colors.warning || '#F5A623',
  };
  return statusColors[status] || colors.textSecondary;
};

export default function OrdersScreen() {
  const { user } = useUser();
  const { orders, loading, error } = useSellerOrders(user?.uid || null);
  const { colors, colorScheme, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const lightBrown = '#A67C52';
  const styles = createStyles(colors, insets, lightBrown);

  const onRefresh = async () => {
    setRefreshing(true);
    haptics.light();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const renderOrder = ({ item, index }: { item: Order; index: number }) => {
    const statusColor = getStatusColor(item.status, colors);
    return (
      <AnimatedListItem index={index}>
        <AnimatedPressable
          style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {
            haptics.light();
            router.push(`../orders/${item.id}` as any);
          }}
          scaleValue={0.98}>
          
          <View style={styles.cardTop}>
            <View style={styles.orderIdentity}>
              <IconSymbol name="person.fill" size={16} color={colors.primary} />
              <View>
                <Text style={[styles.customerName, { color: colors.text }]}>
                  {item.customerInfo.name?.split(' ')[0] || item.customerInfo.name}
                </Text>
                <Text style={[styles.orderSubtext, { color: colors.textSecondary }]} numberOfLines={1}>
                  {(() => {
                    const productNames = item.items.length > 1 
                      ? `${item.items[0].name} +${item.items.length - 1} more`
                      : item.items[0]?.name || 'No items';
                    const dateStr = item.createdAt instanceof Date 
                      ? item.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : 'N/A';
                    return `${productNames} • ${dateStr}`;
                  })()}
                </Text>
              </View>
            </View>
            <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
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
      </AnimatedListItem>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      {/* FLOATING ISLAND HEADER */}
      <View style={styles.floatingHeaderContainer}>
        <View style={styles.nameIsland}>
          <Text style={styles.islandLabel}>SALES OVERVIEW</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>
            {orders.length} Orders Recieved
          </Text>
        </View>
        
        <TouchableOpacity style={styles.iconIsland} onPress={() => { haptics.medium(); toggleTheme(); }}>
          <IconSymbol name={colorScheme === 'dark' ? "sun.max.fill" : "moon.fill"} size={20} color={lightBrown} />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.error }]}>Error loading orders</Text>
        </View>
      ) : loading && orders.length === 0 ? (
        <FlatList
          data={[1, 2, 3, 4]}
          renderItem={() => <SkeletonOrderCard />}
          contentContainerStyle={styles.list}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon="bag.fill"
          title="Quiet day so far"
          description="Your orders will appear here once customers start checking out."
        />
      ) : (
        <FlatList
          data={orders}
          renderItem={renderOrder}
          keyExtractor={(item) => item.id || ''}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={lightBrown} />
          }
        />
      )}
    </View>
  );
}

const createStyles = (colors: any, insets: any, themeBrown: string) => StyleSheet.create({
  container: { flex: 1 },
  floatingHeaderContainer: {
    paddingTop: insets.top + 10,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  nameIsland: {
    flex: 1,
    backgroundColor: themeBrown,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
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
  islandLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  islandTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },

  list: { padding: 20, paddingBottom: 100 },
  
  orderCard: {
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10 },
      android: { elevation: 2 }
    })
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  orderIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customerName: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  orderSubtext: { fontSize: 12, fontWeight: '500' },

  statusPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 10, 
    paddingVertical: 6, 
    borderRadius: 12,
    gap: 6
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },

  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  itemsInfo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemsCount: { fontSize: 14, fontWeight: '500' },
  orderTotal: { fontSize: 22, fontWeight: '800' },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  viewDetails: { fontSize: 13, fontWeight: '700' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
  },
});