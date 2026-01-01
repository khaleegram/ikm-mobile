// Admin products management
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Image, Alert } from 'react-native';
import { useState, useMemo } from 'react';
import { useTheme } from '@/lib/theme/theme-context';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useAllProducts } from '@/lib/firebase/firestore/admin';
import { Product } from '@/types';
import { productApi } from '@/lib/api/products';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeImage } from '@/components/safe-image';

export default function AdminProducts() {
  const { colors, colorScheme } = useTheme();
  const { products, loading } = useAllProducts();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'inactive'>('all');
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  // Filter products
  const filteredProducts = useMemo(() => {
    let filtered = products;

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(product => product.status === statusFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(product => 
        product.name?.toLowerCase().includes(query) ||
        product.description?.toLowerCase().includes(query) ||
        product.sellerId?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [products, statusFilter, searchQuery]);

  const statusOptions: ('all' | 'active' | 'draft' | 'inactive')[] = ['all', 'active', 'draft', 'inactive'];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return colors.success;
      case 'draft':
        return colors.warning;
      case 'inactive':
        return colors.textSecondary;
      default:
        return colors.textSecondary;
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    Alert.alert(
      'Delete Product',
      `Are you sure you want to delete "${product.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await productApi.delete(product.id!);
              Alert.alert('Success', 'Product deleted successfully');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete product');
            }
          },
        },
      ]
    );
  };

  const renderProduct = ({ item }: { item: Product }) => {
    // Handle price - check both price and initialPrice
    const price = item.price || (item as any).initialPrice || 0;
    
    // Check if imageUrl or imageUrls is valid
    const imageUrl = item.imageUrls?.[0] || item.imageUrl;
    const hasValidImage = imageUrl && 
      (imageUrl.startsWith('http://') || 
       imageUrl.startsWith('https://') || 
       imageUrl.startsWith('file://'));
    
    return (
      <TouchableOpacity
        style={[styles.productCard, { backgroundColor: colors.card }]}
        onPress={() => router.push(`/products/${item.id}` as any)}
        activeOpacity={0.7}>
        <View style={styles.productRow}>
          <SafeImage
            uri={item.imageUrls?.[0] || item.imageUrl || ''}
            style={styles.productImage}
            placeholderIcon="photo.fill"
            placeholderSize={32}
          />
          <View style={styles.productInfo}>
            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={[styles.productPrice, { color: colors.primary }]}>
              ₦{price.toLocaleString()}
            </Text>
            <View style={styles.productMeta}>
              <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(item.status || 'draft')}20` }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.status || 'draft') }]}>
                  {(item.status || 'draft').toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.stockText, { color: colors.textSecondary }]}>
                Stock: {item.stock || 0}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.deleteButton, { backgroundColor: colors.error + '20' }]}
            onPress={() => handleDeleteProduct(item)}
            activeOpacity={0.7}>
            <IconSymbol name="trash.fill" size={20} color={colors.error} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={colorScheme === 'light' 
          ? [colors.primary, colors.accent] 
          : [colors.gradientStart, colors.gradientEnd]}
        style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.title}>All Products</Text>
            <Text style={styles.subtitle}>{products.length} total products</Text>
          </View>
          <View style={[styles.iconContainer, { backgroundColor: colorScheme === 'light' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.2)' }]}>
            <IconSymbol name="cube.box.fill" size={24} color="#FFFFFF" />
          </View>
        </View>

        {/* Search */}
        <View style={[styles.searchContainer, { backgroundColor: colorScheme === 'light' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)' }]}>
          <IconSymbol name="magnifyingglass" size={20} color="#FFFFFF" />
          <TextInput
            style={[styles.searchInput, { color: '#FFFFFF' }]}
            placeholder="Search products..."
            placeholderTextColor="rgba(255, 255, 255, 0.7)"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Status Filter */}
        <View style={styles.filterContainer}>
          {statusOptions.map((status) => (
            <TouchableOpacity
              key={status}
              style={[
                styles.filterChip,
                {
                  backgroundColor: statusFilter === status 
                    ? 'rgba(255, 255, 255, 0.3)' 
                    : 'rgba(255, 255, 255, 0.1)',
                }
              ]}
              onPress={() => setStatusFilter(status)}>
              <Text style={styles.filterChipText}>
                {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
              </Text>
              {status !== 'all' && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>
                    {products.filter(p => p.status === status).length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <>
          {filteredProducts.length > 0 && (
            <View style={[styles.statsBar, { borderBottomColor: colors.cardBorder }]}>
              <Text style={[styles.statsText, { color: colors.textSecondary }]}>
                Showing {filteredProducts.length} of {products.length} products
              </Text>
            </View>
          )}
          <FlatList
            data={filteredProducts}
            renderItem={renderProduct}
            keyExtractor={(item) => item.id || ''}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <IconSymbol name="cube.box" size={64} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {searchQuery || statusFilter !== 'all' ? 'No products found' : 'No products yet'}
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
      paddingBottom: 20,
      paddingHorizontal: 20,
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
      ...premiumShadow,
    },
    headerContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
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
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      marginBottom: 12,
      gap: 12,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
    },
    filterContainer: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      gap: 6,
    },
    filterChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    filterBadge: {
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      minWidth: 20,
      alignItems: 'center',
    },
    filterBadgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    statsBar: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    statsText: {
      fontSize: 14,
    },
    list: {
      padding: 20,
    },
    productCard: {
      padding: 16,
      borderRadius: 16,
      marginBottom: 12,
      ...premiumShadow,
    },
    productRow: {
      flexDirection: 'row',
      gap: 12,
    },
    productImage: {
      width: 80,
      height: 80,
      borderRadius: 12,
      resizeMode: 'cover',
    },
    productImagePlaceholder: {
      width: 80,
      height: 80,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    productInfo: {
      flex: 1,
    },
    productName: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    productPrice: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    productMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    statusText: {
      fontSize: 10,
      fontWeight: '600',
    },
    stockText: {
      fontSize: 12,
    },
    deleteButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
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

