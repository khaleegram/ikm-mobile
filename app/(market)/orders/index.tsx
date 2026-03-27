import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserOrders } from '@/lib/firebase/firestore/orders';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';

const lightBrown = '#A67C52';

type FilterKey = 'all' | 'buying' | 'selling' | 'active';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'buying', label: 'Buying' },
  { key: 'selling', label: 'Selling' },
  { key: 'active', label: 'Active' },
];

function formatAmount(value: number): string {
  return `NGN ${value.toLocaleString()}`;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate();
  return null;
}

function getStatusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'completed' || normalized === 'received') return '#10B981';
  if (normalized === 'sent') return '#0EA5E9';
  if (normalized === 'processing') return '#F59E0B';
  if (normalized === 'disputed') return '#EF4444';
  if (normalized === 'cancelled') return '#9CA3AF';
  return '#A67C52';
}

function isActiveStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'processing' || normalized === 'sent' || normalized === 'received';
}

export default function MarketOrdersScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const marketLoginRoute = getLoginRouteForVariant('market');

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');

  const { orders, loading } = useUserOrders(user?.uid || null);

  const filteredOrders = useMemo(() => {
    if (!user) return [];
    const queryValue = searchText.trim().toLowerCase();

    return orders.filter((order) => {
      const isBuyer = order.customerId === user.uid;
      const isSeller = order.sellerId === user.uid;

      const matchesFilter =
        activeFilter === 'buying'
          ? isBuyer
          : activeFilter === 'selling'
            ? isSeller
            : activeFilter === 'active'
              ? isActiveStatus(order.status)
              : true;

      if (!matchesFilter) return false;
      if (!queryValue) return true;

      const firstItemName = String(order.items?.[0]?.name || '').toLowerCase();
      const orderId = String(order.id || '').toLowerCase();
      const status = String(order.status || '').toLowerCase();
      const amountText = String(order.total || '').toLowerCase();

      return (
        firstItemName.includes(queryValue) ||
        orderId.includes(queryValue) ||
        status.includes(queryValue) ||
        amountText.includes(queryValue)
      );
    });
  }, [activeFilter, orders, searchText, user]);

  const onRefresh = async () => {
    haptics.light();
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  };

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <IconSymbol name="bag.fill" size={48} color={lightBrown} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sign in to track orders</Text>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: lightBrown }]}
          onPress={() => router.push(marketLoginRoute as any)}>
          <Text style={styles.primaryButtonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {
            haptics.light();
            router.back();
          }}>
          <IconSymbol name="arrow.left" size={18} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerIsland}>
          <Text style={styles.headerLabel}>MARKET STREET</Text>
          <Text style={styles.headerTitle}>Orders</Text>
        </View>
        <TouchableOpacity
          style={[styles.searchButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {
            haptics.light();
            setSearchOpen((previous) => {
              const next = !previous;
              if (!next) setSearchText('');
              return next;
            });
          }}>
          <IconSymbol name={searchOpen ? 'xmark' : 'magnifyingglass'} size={16} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((filter) => {
          const active = activeFilter === filter.key;
          return (
            <TouchableOpacity
              key={filter.key}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? lightBrown : colors.card,
                  borderColor: active ? lightBrown : colors.border,
                },
              ]}
              onPress={() => {
                haptics.light();
                setActiveFilter(filter.key);
              }}>
              <Text
                style={[
                  styles.filterChipText,
                  { color: active ? '#FFFFFF' : colors.textSecondary },
                ]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {searchOpen ? (
        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchInputWrap,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}>
            <IconSymbol name="magnifyingglass" size={15} color={colors.textSecondary} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search by item, order ID, or status"
              placeholderTextColor={colors.textSecondary}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      ) : filteredOrders.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="shippingbox.fill" size={42} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No orders yet</Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            New purchases and sales will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => item.id || `${item.customerId}-${item.sellerId}-${item.createdAt}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={lightBrown} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 96, paddingHorizontal: 16, paddingTop: 8 }}
          renderItem={({ item }) => {
            const isBuyer = item.customerId === user.uid;
            const itemName = item.items?.[0]?.name || 'Market Street item';
            const itemCount = item.items?.length || 0;
            const orderDate = toDate(item.createdAt);
            const statusColor = getStatusColor(item.status);

            return (
              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                activeOpacity={0.9}
                onPress={() => {
                  haptics.light();
                  router.push(`/(market)/orders/${item.id}` as any);
                }}>
                <View style={styles.cardTopRow}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                      {itemName}
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                      {isBuyer ? 'Buying' : 'Selling'} {itemCount > 1 ? `- ${itemCount} items` : ''}
                    </Text>
                  </View>
                  <View style={[styles.statusChip, { backgroundColor: `${statusColor}20` }]}>
                    <Text style={[styles.statusText, { color: statusColor }]}>{item.status}</Text>
                  </View>
                </View>

                <View style={styles.cardBottomRow}>
                  <Text style={[styles.cardAmount, { color: colors.text }]}>
                    {formatAmount(Number(item.total || 0))}
                  </Text>
                  <Text style={[styles.cardDate, { color: colors.textSecondary }]}>
                    {orderDate ? orderDate.toLocaleDateString() : 'Today'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIsland: {
    flex: 1,
    backgroundColor: lightBrown,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  searchRow: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  searchInputWrap: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  cardSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardAmount: {
    fontSize: 17,
    fontWeight: '800',
  },
  cardDate: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
