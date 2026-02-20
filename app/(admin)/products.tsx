// Admin products management
import { AnimatedPressable } from '@/components/animated-pressable';
import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { productApi } from '@/lib/api/products';
import { useAllProducts } from '@/lib/firebase/firestore/admin';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { Product } from '@/types';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AdminProducts() {
  const { colors, colorScheme, toggleTheme } = useTheme();
  const { products, loading } = useAllProducts();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'inactive'>('all');
  const insets = useSafeAreaInsets();
  const lightBrown = '#A67C52';
  const styles = createStyles(colors, insets, lightBrown);

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
    haptics.medium();
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
              haptics.success();
              Alert.alert('Success', 'Product deleted successfully');
            } catch (error: any) {
              haptics.error();
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
    
    return (
      <AnimatedPressable
        style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => { haptics.light(); router.push(`/products/${item.id}` as any); }}
        scaleValue={0.98}>
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
            <Text style={[styles.productPrice, { color: lightBrown }]}>
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
          <AnimatedPressable
            style={[styles.deleteButton, { backgroundColor: colors.error + '20' }]}
            onPress={(e) => {
              e.stopPropagation();
              handleDeleteProduct(item);
            }}
            scaleValue={0.9}>
            <IconSymbol name="trash.fill" size={20} color={colors.error} />
          </AnimatedPressable>
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
          <Text style={styles.islandLabel}>PLATFORM PRODUCTS</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>
            {products.length} Products
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
            placeholder="Search products..."
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Status Filter */}
      <View style={styles.filterContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={statusOptions}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.filterContent}
          renderItem={({ item: status }) => (
            <TouchableOpacity
              style={[
                styles.filterChip,
                {
                  backgroundColor: statusFilter === status 
                    ? lightBrown 
                    : colors.backgroundSecondary,
                  borderColor: statusFilter === status ? lightBrown : colors.border,
                }
              ]}
              onPress={() => { haptics.light(); setStatusFilter(status); }}>
              <Text style={[styles.filterChipText, { color: statusFilter === status ? '#fff' : colors.text }]}>
                {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
              </Text>
              {status !== 'all' && (
                <View style={[styles.filterBadge, { backgroundColor: statusFilter === status ? 'rgba(255,255,255,0.3)' : colors.cardBorder }]}>
                  <Text style={[styles.filterBadgeText, { color: statusFilter === status ? '#fff' : colors.textSecondary }]}>
                    {products.filter(p => p.status === status).length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightBrown} />
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
    },
    statsText: {
      fontSize: 14,
    },
    list: {
      padding: 20,
    },
    productCard: {
      padding: 16,
      borderRadius: 20,
      marginBottom: 12,
      borderWidth: 1,
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

