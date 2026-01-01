// Customers management screen
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState, useMemo } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useSellerCustomers } from '@/lib/firebase/firestore/customers';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useSellerOrders } from '@/lib/firebase/firestore/orders';
import { Customer } from '@/lib/firebase/firestore/customers';
import { router } from 'expo-router';

export default function CustomersScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const { customers, loading } = useSellerCustomers(user?.uid || null);
  const { orders } = useSellerOrders(user?.uid || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<'all' | 'VIP' | 'Regular' | 'New'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const styles = createStyles(colors);

  // Filter customers
  const filteredCustomers = useMemo(() => {
    let filtered = customers;

    // Filter by segment
    if (segmentFilter !== 'all') {
      filtered = filtered.filter(c => c.segment === segmentFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.name?.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query) ||
        c.phone?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [customers, segmentFilter, searchQuery]);

  const getSegmentColor = (segment: string) => {
    switch (segment) {
      case 'VIP':
        return colors.warning;
      case 'Regular':
        return colors.primary;
      case 'New':
        return colors.success;
      default:
        return colors.textSecondary;
    }
  };

  // Get customer's orders
  const getCustomerOrders = (customerId: string) => {
    return orders.filter(o => o.customerId === customerId);
  };

  const handleCustomerPress = (customer: Customer) => {
    setSelectedCustomer(customer);
    setModalVisible(true);
  };

  const renderCustomer = ({ item }: { item: Customer }) => {
    return (
      <TouchableOpacity
        style={[styles.customerCard, { backgroundColor: colors.card }]}
        onPress={() => handleCustomerPress(item)}
        activeOpacity={0.7}>
        <View style={styles.customerHeader}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.customerInfo}>
            <Text style={[styles.customerName, { color: colors.text }]}>{item.name}</Text>
            <Text style={[styles.customerEmail, { color: colors.textSecondary }]}>{item.email}</Text>
            {item.phone && (
              <Text style={[styles.customerPhone, { color: colors.textSecondary }]}>{item.phone}</Text>
            )}
          </View>
          <View style={[styles.segmentBadge, { backgroundColor: `${getSegmentColor(item.segment)}20` }]}>
            <Text style={[styles.segmentText, { color: getSegmentColor(item.segment) }]}>
              {item.segment}
            </Text>
          </View>
        </View>
        <View style={styles.customerStats}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Orders</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{item.orderCount}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Total Spent</Text>
            <Text style={[styles.statValue, { color: colors.primary }]}>
              ₦{item.totalSpent.toLocaleString()}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const segmentCounts = useMemo(() => {
    return {
      all: customers.length,
      VIP: customers.filter(c => c.segment === 'VIP').length,
      Regular: customers.filter(c => c.segment === 'Regular').length,
      New: customers.filter(c => c.segment === 'New').length,
    };
  }, [customers]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>Customers</Text>

        {/* Search */}
        <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
          <IconSymbol name="magnifyingglass" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search customers..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Segment Filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}>
          {(['all', 'VIP', 'Regular', 'New'] as const).map((segment) => (
            <TouchableOpacity
              key={segment}
              style={[
                styles.filterChip,
                {
                  backgroundColor: segmentFilter === segment ? colors.primary : colors.backgroundSecondary,
                  borderColor: segmentFilter === segment ? colors.primary : colors.cardBorder,
                }
              ]}
              onPress={() => setSegmentFilter(segment)}>
              <Text style={[
                styles.filterChipText,
                { color: segmentFilter === segment ? '#fff' : colors.text }
              ]}>
                {segment === 'all' ? 'All' : segment}
              </Text>
              <View style={[styles.filterBadge, { backgroundColor: segmentFilter === segment ? 'rgba(255,255,255,0.3)' : colors.cardBorder }]}>
                <Text style={[styles.filterBadgeText, { color: segmentFilter === segment ? '#fff' : colors.textSecondary }]}>
                  {segmentCounts[segment]}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredCustomers}
          renderItem={renderCustomer}
          keyExtractor={(item) => item.customerId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {searchQuery || segmentFilter !== 'all' ? 'No customers found' : 'No customers yet'}
              </Text>
            </View>
          }
        />
      )}

      {/* Customer Detail Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Customer Details</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedCustomer && (
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <View style={styles.customerDetailSection}>
                  <View style={[styles.detailAvatar, { backgroundColor: colors.primary }]}>
                    <Text style={styles.detailAvatarText}>
                      {selectedCustomer.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.detailName, { color: colors.text }]}>
                    {selectedCustomer.name}
                  </Text>
                  <Text style={[styles.detailEmail, { color: colors.textSecondary }]}>
                    {selectedCustomer.email}
                  </Text>
                  <View style={[styles.segmentBadge, { backgroundColor: `${getSegmentColor(selectedCustomer.segment)}20`, marginTop: 12 }]}>
                    <Text style={[styles.segmentText, { color: getSegmentColor(selectedCustomer.segment) }]}>
                      {selectedCustomer.segment} CUSTOMER
                    </Text>
                  </View>
                </View>

                <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.detailSectionTitle, { color: colors.text }]}>Contact Information</Text>
                  {selectedCustomer.phone && (
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Phone</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCustomer.phone}</Text>
                    </View>
                  )}
                  {selectedCustomer.whatsappNumber && (
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>WhatsApp</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCustomer.whatsappNumber}</Text>
                    </View>
                  )}
                </View>

                <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.detailSectionTitle, { color: colors.text }]}>Statistics</Text>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Total Orders</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCustomer.orderCount}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Total Spent</Text>
                    <Text style={[styles.detailValue, { color: colors.primary, fontWeight: 'bold' }]}>
                      ₦{selectedCustomer.totalSpent.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Average Order Value</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      ₦{selectedCustomer.orderCount > 0 ? (selectedCustomer.totalSpent / selectedCustomer.orderCount).toFixed(2) : '0.00'}
                    </Text>
                  </View>
                  {selectedCustomer.firstOrderDate && (
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>First Order</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {selectedCustomer.firstOrderDate.toLocaleDateString()}
                      </Text>
                    </View>
                  )}
                  {selectedCustomer.lastOrderDate && (
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Last Order</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {selectedCustomer.lastOrderDate.toLocaleDateString()}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={[styles.detailSectionTitle, { color: colors.text }]}>Recent Orders</Text>
                  {getCustomerOrders(selectedCustomer.customerId).slice(0, 5).map((order) => (
                    <TouchableOpacity
                      key={order.id}
                      style={styles.orderItem}
                      onPress={() => {
                        setModalVisible(false);
                        router.push(`/orders/${order.id}` as any);
                      }}>
                      <View style={styles.orderItemLeft}>
                        <Text style={[styles.orderItemId, { color: colors.text }]}>
                          Order #{order.id?.slice(0, 8)}
                        </Text>
                        <Text style={[styles.orderItemDate, { color: colors.textSecondary }]}>
                          {order.createdAt instanceof Date ? order.createdAt.toLocaleDateString() : new Date(order.createdAt as any).toLocaleDateString()}
                        </Text>
                      </View>
                      <Text style={[styles.orderItemAmount, { color: colors.primary }]}>
                        ₦{(order.total || 0).toLocaleString()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {getCustomerOrders(selectedCustomer.customerId).length === 0 && (
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                      No orders found
                    </Text>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      marginBottom: 16,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      marginBottom: 16,
      gap: 12,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
    },
    filterContainer: {
      marginTop: 8,
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
    list: {
      padding: 20,
    },
    customerCard: {
      padding: 16,
      borderRadius: 16,
      marginBottom: 12,
      ...premiumShadow,
    },
    customerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    avatarText: {
      color: '#fff',
      fontSize: 20,
      fontWeight: 'bold',
    },
    customerInfo: {
      flex: 1,
    },
    customerName: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    customerEmail: {
      fontSize: 14,
      marginBottom: 2,
    },
    customerPhone: {
      fontSize: 12,
    },
    segmentBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    segmentText: {
      fontSize: 12,
      fontWeight: '600',
    },
    customerStats: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    statItem: {
      alignItems: 'center',
    },
    statLabel: {
      fontSize: 12,
      marginBottom: 4,
    },
    statValue: {
      fontSize: 16,
      fontWeight: '600',
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
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '90%',
      paddingBottom: 40,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    modalTitle: {
      fontSize: 24,
      fontWeight: 'bold',
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalBody: {
      padding: 20,
    },
    customerDetailSection: {
      alignItems: 'center',
      paddingVertical: 24,
    },
    detailAvatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    detailAvatarText: {
      color: '#fff',
      fontSize: 32,
      fontWeight: 'bold',
    },
    detailName: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    detailEmail: {
      fontSize: 16,
    },
    detailCard: {
      padding: 16,
      borderRadius: 12,
      marginBottom: 16,
    },
    detailSectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 16,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    detailLabel: {
      fontSize: 14,
      flex: 1,
    },
    detailValue: {
      fontSize: 14,
      fontWeight: '500',
      flex: 2,
      textAlign: 'right',
    },
    orderItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    orderItemLeft: {
      flex: 1,
    },
    orderItemId: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 4,
    },
    orderItemDate: {
      fontSize: 12,
    },
    orderItemAmount: {
      fontSize: 16,
      fontWeight: 'bold',
    },
  });

