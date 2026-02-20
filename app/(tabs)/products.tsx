import { AnimatedPressable } from '@/components/animated-pressable';
import { EmptyState } from '@/components/empty-state';
import { SafeImage } from '@/components/safe-image';
import { SkeletonProductCard } from '@/components/skeleton-loader';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { productApi } from '@/lib/api/products';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useSellerProducts } from '@/lib/firebase/firestore/products';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { Product } from '@/types';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  RefreshControl, StatusBar,
  StyleSheet, Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = (width - 52) / 2;

export default function ProductsScreen() {
  const { user } = useUser();
  const { products, loading, error } = useSellerProducts(user?.uid || null);
  const { colors, colorScheme, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);

  const lightBrown = '#A67C52';
  const styles = createStyles(colors, insets, lightBrown);

  const getStatusColor = (status: string) => {
    if (status === 'active') return colors.success;
    if (status === 'draft') return colors.warning;
    return colors.error;
  };


  // Filter Logic
  const filteredProducts = useMemo(() => {
    return products.filter(p => p.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [products, searchQuery]);

  const onRefresh = async () => {
    setRefreshing(true);
    haptics.light();
    setTimeout(() => setRefreshing(false), 1000);
  };


  // Loading state with skeleton
  if (loading && products.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={styles.floatingHeaderContainer}>
          <View style={styles.nameIsland}>
            <Text style={styles.islandLabel}>INVENTORY</Text>
            <Text style={styles.islandTitle}>Loading...</Text>
          </View>
        </View>
        <FlatList
          data={[1, 2, 3, 4]}
          renderItem={() => <SkeletonProductCard />}
          keyExtractor={(item) => item.toString()}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContainer}
        />
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
        <Text style={[styles.errorText, { color: colors.error }]}>Error loading products</Text>
      </View>
    );
  }

  const toggleSelect = (id: string) => {
    haptics.light();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const enterSelectMode = (id: string) => {
    haptics.medium();
    setIsSelectMode(true);
    setSelectedIds([id]);
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds([]);
  };

  const handleDelete = async (ids: string[]) => {
    Alert.alert(
      "Delete Products",
      `Are you sure you want to delete ${ids.length} item(s)? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            try {
              haptics.medium();
              // Delete all products
              await Promise.all(ids.map(id => productApi.delete(id)));
              haptics.success();
              showToast(`${ids.length} product(s) deleted successfully`, 'success');
              exitSelectMode();
            } catch (error: any) {
              haptics.error();
              showToast(error.message || 'Failed to delete products', 'error');
            }
          } 
        }
      ]
    );
  };

  const renderProduct = ({ item }: { item: Product }) => {
    const isSelected = selectedIds.includes(item.id || '');

    return (
      <AnimatedPressable
        style={[
          styles.gridCard, 
          { backgroundColor: colors.card, borderColor: isSelected ? lightBrown : colors.border }
        ]}
        onPress={() => isSelectMode ? toggleSelect(item.id!) : router.push(`../products/${item.id}` as any)}
        onLongPress={() => !isSelectMode && enterSelectMode(item.id!)}
        scaleValue={0.96}>
        
        <View style={styles.imageWrapper}>
          <SafeImage uri={item.imageUrls?.[0] || item.imageUrl || ''} style={styles.cardImage} />
          
          {/* Status Badge */}
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status || 'inactive') }]}>
            <Text style={styles.statusBadgeText}>
              {item.status === 'active' ? 'Active' : item.status === 'draft' ? 'Draft' : 'Inactive'}
            </Text>
          </View>
          
          {/* Multi-select Checkbox */}
          {isSelectMode && (
            <View style={[styles.checkCircle, { backgroundColor: isSelected ? lightBrown : 'rgba(0,0,0,0.3)' }]}>
              {isSelected && <IconSymbol name="checkmark" size={12} color="#fff" />}
            </View>
          )}

          {/* Individual Delete Button (Only visible if NOT in multi-select mode) */}
          {!isSelectMode && (
            <TouchableOpacity 
              style={styles.trashIcon} 
              onPress={() => handleDelete([item.id!])}>
              <IconSymbol name="trash.fill" size={14} color="#FF4444" />
            </TouchableOpacity>
          )}
        </View>
        
        <View style={styles.cardInfo}>
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
          <View style={styles.priceRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.productPrice, { color: lightBrown }]}>₦{item.price?.toLocaleString()}</Text>
              {item.compareAtPrice && item.price && item.compareAtPrice > item.price && (
                <Text style={[styles.comparePrice, { color: colors.textSecondary }]}>
                  ₦{item.compareAtPrice.toLocaleString()}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{item.stock || 0} in stock</Text>
            {item.salesCount !== undefined && item.salesCount > 0 && (
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>• {item.salesCount} sold</Text>
            )}
          </View>
        </View>
      </AnimatedPressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      {/* HEADER ISLANDS */}
      <View style={styles.floatingHeaderContainer}>
        <View style={[styles.nameIsland, isSelectMode && { backgroundColor: '#333' }]}>
          <Text style={styles.islandLabel}>{isSelectMode ? 'SELECTING' : 'INVENTORY'}</Text>
          <Text style={styles.islandTitle}>{isSelectMode ? `${selectedIds.length} Selected` : `${products.length} Items`}</Text>
        </View>
        
        {isSelectMode ? (
          <>
            <TouchableOpacity style={styles.iconIsland} onPress={exitSelectMode}>
              <IconSymbol name="xmark" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconIsland, { backgroundColor: '#FF4444' }]} onPress={() => handleDelete(selectedIds)}>
              <IconSymbol name="trash.fill" size={20} color="#fff" />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.iconIsland} onPress={() => toggleTheme()}>
              <IconSymbol name={colorScheme === 'dark' ? "sun.max.fill" : "moon.fill"} size={20} color={lightBrown} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconIsland, { backgroundColor: lightBrown }]} onPress={() => router.push('/products/new')}>
              <IconSymbol name="plus.circle.fill" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* SEARCH BAR ISLAND */}
      {!isSelectMode && (
        <View style={styles.searchContainer}>
          <View style={[styles.searchIsland, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <IconSymbol name="magnifyingglass" size={18} color={colors.textSecondary} />
            <TextInput
              placeholder="Search your products..."
              placeholderTextColor={colors.textSecondary}
              style={[styles.searchInput, { color: colors.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon="cube.box"
          title="No products yet"
          description="Start selling by creating your first product"
          actionLabel="Create Your First Product"
          onAction={() => router.push('/products/new')}
        />
      ) : (
        <FlatList
          key={'product-grid'}
          data={filteredProducts}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id || ''}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={lightBrown} />}
        />
      )}
    </View>
  );
}

const createStyles = (colors: any, insets: any, themeBrown: string) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  floatingHeaderContainer: { paddingTop: insets.top + 10, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameIsland: { flex: 1, backgroundColor: themeBrown, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 22 },
  iconIsland: { backgroundColor: colors.card, width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  islandLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800' },
  islandTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },

  searchContainer: { paddingHorizontal: 20, marginTop: 12 },
  searchIsland: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 48, borderRadius: 24, borderWidth: 1 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15, fontWeight: '600' },

  listContainer: { paddingHorizontal: 20, paddingBottom: 70 + insets.bottom + 20, paddingTop: 10 },
  columnWrapper: { justifyContent: 'space-between', marginBottom: 16 },
  gridCard: { width: COLUMN_WIDTH, borderRadius: 24, borderWidth: 1, padding: 8 },
  imageWrapper: { width: '100%', aspectRatio: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: '#f5f5f5', position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  
  statusBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  trashIcon: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(255,255,255,0.9)', padding: 6, borderRadius: 12, zIndex: 2 },
  checkCircle: { position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', zIndex: 3 },
  
  cardInfo: { paddingVertical: 10, paddingHorizontal: 4 },
  productName: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  productPrice: { fontSize: 16, fontWeight: '800' },
  comparePrice: {
    fontSize: 12,
    textDecorationLine: 'line-through',
    fontWeight: '500',
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  metaText: {
    fontSize: 11,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
