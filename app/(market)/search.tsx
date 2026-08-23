import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import KeyboardFlatList from '@/components/layout/KeyboardFlatList';
import { FeedCard } from '@/components/market/feed-card';
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { marketPostsApi } from '@/lib/api/market-posts';
import { usersApi, type ApiUserProfile } from '@/lib/api/users-api';
import { NIGERIA_LOCATION_OPTIONS } from '@/lib/constants/nigeria-locations';
import { useMarketPostsSearch } from '@/lib/hooks/use-market-post';
import {
  avatarUriFromProfile,
  displayNameFromProfile,
} from '@/lib/hooks/use-user-identity';
import { queryKeys } from '@/lib/query/keys';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { toNameCase } from '@/lib/utils/name-case';

const lightBrown = '#A67C52';
const RECENT_SEARCHES_KEY = '@market_street_recent_searches';
const MAX_RECENT_SEARCHES = 10;

type SearchTab = 'posts' | 'sellers';

interface TrendingHashtag {
  id: string;
  tag: string;
  count: number;
}

export default function SearchScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [trendingHashtags, setTrendingHashtags] = useState<TrendingHashtag[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedHashtag, setSelectedHashtag] = useState<string | null>(null);
  const [tab, setTab] = useState<SearchTab>('posts');
  const [cityFilter, setCityFilter] = useState<{ city: string; state: string } | null>(null);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');

  const postSearchTerm = isSearching && tab === 'posts' ? selectedHashtag || searchQuery : null;
  const { posts, loading: postsLoading, error: postsError } = useMarketPostsSearch(postSearchTerm);

  const sellerQ = tab === 'sellers' && isSearching ? searchQuery.trim() : '';
  const sellerCity = cityFilter?.city || '';
  const sellerState = cityFilter?.state || '';
  const sellersEnabled =
    tab === 'sellers' && isSearching && Boolean(sellerQ || sellerCity || sellerState);

  const sellersQuery = useQuery({
    queryKey: queryKeys.posts.sellersSearch(sellerQ, sellerCity, sellerState),
    enabled: sellersEnabled,
    staleTime: 20_000,
    queryFn: () =>
      usersApi.search({
        q: sellerQ || undefined,
        city: sellerCity || undefined,
        state: sellerState || undefined,
        limit: 40,
      }),
  });

  const locationSuggestions = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    const pool = !q
      ? NIGERIA_LOCATION_OPTIONS
      : NIGERIA_LOCATION_OPTIONS.filter((option) => option.label.toLowerCase().includes(q));
    return pool.slice(0, 80);
  }, [locationSearch]);

  useEffect(() => {
    const loadRecentSearches = async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
        if (stored) setRecentSearches(JSON.parse(stored));
      } catch {
        // ignore
      }
    };
    void loadRecentSearches();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const trending = await marketPostsApi.listTrendingHashtags(10);
        if (!cancelled) setTrendingHashtags(trending);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveRecentSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    try {
      setRecentSearches((prev) => {
        const updated = [
          query.trim(),
          ...prev.filter((s) => s.toLowerCase() !== query.trim().toLowerCase()),
        ].slice(0, MAX_RECENT_SEARCHES);
        void AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch {
      // ignore
    }
  }, []);

  const handleSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query && !(tab === 'sellers' && cityFilter)) {
      setIsSearching(false);
      setSelectedHashtag(null);
      return;
    }
    haptics.light();
    setIsSearching(true);
    setSelectedHashtag(null);
    if (query) void saveRecentSearch(query);
  }, [cityFilter, saveRecentSearch, searchQuery, tab]);

  const handleHashtagPress = useCallback(
    (hashtag: string) => {
      haptics.light();
      setTab('posts');
      setSelectedHashtag(hashtag);
      setIsSearching(true);
      setSearchQuery(`#${hashtag}`);
      void saveRecentSearch(`#${hashtag}`);
    },
    [saveRecentSearch]
  );

  const handleRecentSearchPress = useCallback((query: string) => {
    haptics.light();
    setSearchQuery(query);
    if (query.startsWith('#')) {
      setTab('posts');
      setSelectedHashtag(query.slice(1));
    } else {
      setSelectedHashtag(null);
    }
    setIsSearching(true);
  }, []);

  const clearSearch = () => {
    haptics.light();
    setSearchQuery('');
    setIsSearching(false);
    setSelectedHashtag(null);
  };

  const clearRecentSearches = async () => {
    haptics.medium();
    try {
      await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
      setRecentSearches([]);
    } catch {
      // ignore
    }
  };

  const renderSellerRow = (seller: ApiUserProfile) => {
    const name = toNameCase(displayNameFromProfile(seller, 'Seller'));
    const avatar = avatarUriFromProfile(seller);
    const loc = [seller.marketLocation?.city, seller.marketLocation?.state]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(', ');
    const initials = name
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2);

    return (
      <TouchableOpacity
        key={seller.id}
        style={[styles.sellerRow, { borderBottomColor: colors.border }]}
        activeOpacity={0.75}
        onPress={() => router.push(`/(market)/seller/${seller.id}` as any)}>
        <View style={[styles.sellerAvatar, { backgroundColor: `${lightBrown}22` }]}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={StyleSheet.absoluteFillObject} />
          ) : (
            <Text style={{ color: lightBrown, fontWeight: '800' }}>{initials || '?'}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sellerName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          {loc ? (
            <Text style={[styles.sellerMeta, { color: colors.textSecondary }]} numberOfLines={1}>
              {loc}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.sellerMeta, { color: colors.textSecondary }]}>
          {Number(seller.followerCount || 0).toLocaleString()} followers
        </Text>
      </TouchableOpacity>
    );
  };

  const renderSearchResults = () => {
    if (tab === 'sellers') {
      if (sellersQuery.isPending && !sellersQuery.data) {
        return (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={lightBrown} />
          </View>
        );
      }
      if (sellersQuery.isError) {
        return (
          <View style={styles.centerContainer}>
            <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>Error loading sellers</Text>
          </View>
        );
      }
      const sellers = sellersQuery.data ?? [];
      if (sellers.length === 0) {
        return (
          <View style={styles.centerContainer}>
            <IconSymbol name="person.2" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No sellers found</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Try a store name or pick a city
            </Text>
          </View>
        );
      }
      return (
        <FlatList
          data={sellers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderSellerRow(item)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          keyboardShouldPersistTaps="always"
        />
      );
    }

    if (postsLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      );
    }
    if (postsError) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>Error loading results</Text>
        </View>
      );
    }
    if (posts.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol name="magnifyingglass" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No posts found</Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
            Try a different search term or hashtag
          </Text>
        </View>
      );
    }

    return (
      <KeyboardFlatList
        data={posts}
        estimatedItemSize={320}
        renderItem={({ item }) => (
          <FeedCard
            post={item}
            onComment={() => {
              if (item.id) router.push(`/(market)/post/${item.id}` as any);
            }}
          />
        )}
        keyExtractor={(item) => item.id || Math.random().toString()}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      />
    );
  };

  const renderBrowse = () => (
    <KeyboardScreen
      style={styles.scrollView}
      keyboardVerticalOffset={insets.top}
      extraScrollHeight={32}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}>
      {trendingHashtags.length > 0 && tab === 'posts' ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Trending Hashtags</Text>
          <View style={styles.hashtagContainer}>
            {trendingHashtags.map((item) => (
              <AnimatedPressable
                key={item.id}
                style={[styles.hashtagChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => handleHashtagPress(item.tag)}
                scaleValue={0.96}>
                <Text style={[styles.hashtagText, { color: lightBrown }]}>#{item.tag}</Text>
                <Text style={[styles.hashtagCount, { color: colors.textSecondary }]}>{item.count}</Text>
              </AnimatedPressable>
            ))}
          </View>
        </View>
      ) : null}

      {recentSearches.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Recent</Text>
            <TouchableOpacity onPress={() => void clearRecentSearches()}>
              <Text style={[styles.clearText, { color: lightBrown }]}>Clear</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.recentSearchesContainer}>
            {recentSearches.map((search, index) => (
              <AnimatedPressable
                key={`${search}-${index}`}
                style={[styles.recentSearchItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => handleRecentSearchPress(search)}
                scaleValue={0.98}>
                <IconSymbol name="clock.fill" size={16} color={colors.textSecondary} />
                <Text style={[styles.recentSearchText, { color: colors.text }]}>{search}</Text>
                <TouchableOpacity
                  onPress={() => {
                    haptics.light();
                    const updated = recentSearches.filter((_, i) => i !== index);
                    setRecentSearches(updated);
                    void AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
                  }}>
                  <IconSymbol name="xmark.circle.fill" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </AnimatedPressable>
            ))}
          </View>
        </View>
      ) : null}

      {trendingHashtags.length === 0 && recentSearches.length === 0 ? (
        <View style={styles.centerContainer}>
          <IconSymbol name="magnifyingglass" size={64} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.text }]}>Start Searching</Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
            Search posts, hashtags, or sellers
          </Text>
        </View>
      ) : null}
    </KeyboardScreen>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.searchBarContainer, { paddingTop: insets.top + 10 }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={tab === 'sellers' ? 'Search sellers or stores…' : 'Search posts, hashtags…'}
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity onPress={clearSearch}>
              <IconSymbol name="xmark.circle.fill" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.tabRow}>
          {(['posts', 'sellers'] as SearchTab[]).map((value) => {
            const active = tab === value;
            return (
              <TouchableOpacity
                key={value}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: active ? lightBrown : colors.card,
                    borderColor: active ? lightBrown : colors.border,
                  },
                ]}
                onPress={() => {
                  haptics.light();
                  setTab(value);
                  if (isSearching) {
                    // keep query; re-run for new tab
                    setIsSearching(true);
                  }
                }}>
                <Text style={[styles.tabChipText, { color: active ? '#FFF' : colors.text }]}>
                  {value === 'posts' ? 'Posts' : 'Sellers'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'sellers' ? (
          <View style={styles.cityRow}>
            <TouchableOpacity
              style={[styles.cityChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setLocationPickerVisible(true)}>
              <IconSymbol name="location.fill" size={14} color={lightBrown} />
              <Text style={[styles.cityChipText, { color: cityFilter ? colors.text : colors.textSecondary }]} numberOfLines={1}>
                {cityFilter ? `${cityFilter.city}, ${cityFilter.state}` : 'Filter by city'}
              </Text>
            </TouchableOpacity>
            {cityFilter ? (
              <TouchableOpacity
                onPress={() => {
                  setCityFilter(null);
                  if (searchQuery.trim()) setIsSearching(true);
                }}
                hitSlop={10}>
                <IconSymbol name="xmark.circle.fill" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.applyCityBtn, { backgroundColor: lightBrown }]}
              onPress={() => {
                if (!searchQuery.trim() && !cityFilter) return;
                haptics.light();
                setIsSearching(true);
              }}>
              <Text style={styles.applyCityBtnText}>Search</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {isSearching ? renderSearchResults() : renderBrowse()}

      <Modal
        visible={locationPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationPickerVisible(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>City</Text>
              <TouchableOpacity onPress={() => setLocationPickerVisible(false)}>
                <IconSymbol name="xmark" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={locationSearch}
              onChangeText={setLocationSearch}
              placeholder="Search state or city…"
              placeholderTextColor={colors.textSecondary}
              style={[styles.locationInput, { color: colors.text, borderColor: colors.border }]}
            />
            <FlatList
              data={locationSuggestions}
              keyExtractor={(item) => item.label}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.locationRow}
                  onPress={() => {
                    setCityFilter({ city: item.city, state: item.state });
                    setLocationPickerVisible(false);
                    setLocationSearch('');
                    setIsSearching(true);
                    haptics.light();
                  }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBarContainer: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 16 },
  tabRow: { flexDirection: 'row', gap: 8 },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  tabChipText: { fontSize: 13, fontWeight: '800' },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  cityChipText: { flex: 1, fontSize: 13, fontWeight: '600' },
  applyCityBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  applyCityBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  section: { marginBottom: 32 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  clearText: { fontSize: 14, fontWeight: '600' },
  hashtagContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hashtagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  hashtagText: { fontSize: 14, fontWeight: '600' },
  hashtagCount: { fontSize: 12 },
  recentSearchesContainer: { gap: 8 },
  recentSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  recentSearchText: { flex: 1, fontSize: 14 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptySubtext: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  errorText: { fontSize: 16, fontWeight: '600', marginTop: 16 },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sellerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerName: { fontSize: 15, fontWeight: '700' },
  sellerMeta: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  locationInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  locationRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#0001' },
});
