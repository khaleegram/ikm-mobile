import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AnimatedPressable } from '@/components/animated-pressable';
import { haptics } from '@/lib/utils/haptics';
import { useMarketPostsSearch } from '@/lib/firebase/firestore/market-posts';
import { FeedCard } from '@/components/market/feed-card';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import KeyboardScreen from '@/components/layout/KeyboardScreen';
import KeyboardFlatList from '@/components/layout/KeyboardFlatList';

const lightBrown = '#A67C52';
const RECENT_SEARCHES_KEY = '@market_street_recent_searches';
const MAX_RECENT_SEARCHES = 10;

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

  const { posts, loading, error } = useMarketPostsSearch(
    isSearching ? (selectedHashtag || searchQuery) : null
  );

  // Load recent searches
  useEffect(() => {
    const loadRecentSearches = async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
        if (stored) {
          setRecentSearches(JSON.parse(stored));
        }
      } catch (error) {
        console.error('Error loading recent searches:', error);
      }
    };
    loadRecentSearches();
  }, []);

  // Load trending hashtags
  useEffect(() => {
    const q = query(
      collection(firestore, 'trendingHashtags'),
      orderBy('count', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const trending: TrendingHashtag[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          trending.push({
            id: doc.id,
            tag: data.tag || '',
            count: data.count || 0,
          });
        });
        setTrendingHashtags(trending);
      },
      (error) => {
        console.error('Error fetching trending hashtags:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const saveRecentSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;

      try {
        const updated = [
          query.trim(),
          ...recentSearches.filter((s) => s.toLowerCase() !== query.trim().toLowerCase()),
        ].slice(0, MAX_RECENT_SEARCHES);

        await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
        setRecentSearches(updated);
      } catch (error) {
        console.error('Error saving recent search:', error);
      }
    },
    [recentSearches]
  );

  const handleSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) {
      setIsSearching(false);
      setSelectedHashtag(null);
      return;
    }

    haptics.light();
    setIsSearching(true);
    setSelectedHashtag(null);
    saveRecentSearch(query);
  }, [saveRecentSearch, searchQuery]);

  const handleHashtagPress = useCallback((hashtag: string) => {
    haptics.light();
    setSelectedHashtag(hashtag);
    setIsSearching(true);
    setSearchQuery(`#${hashtag}`);
    saveRecentSearch(`#${hashtag}`);
  }, [saveRecentSearch]);

  const handleRecentSearchPress = useCallback((query: string) => {
    haptics.light();
    setSearchQuery(query);
    if (query.startsWith('#')) {
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
    } catch (error) {
      console.error('Error clearing recent searches:', error);
    }
  };

  const handleComment = (postId: string) => {
    router.push(`/(market)/post/${postId}` as any);
  };

  const renderSearchResults = () => {
    if (loading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>
            Error loading results
          </Text>
        </View>
      );
    }

    if (posts.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <IconSymbol name="magnifyingglass" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No posts found
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
            Try a different search term or hashtag
          </Text>
        </View>
      );
    }

    return (
      <KeyboardFlatList
        data={posts}
        renderItem={({ item }) => (
          <FeedCard
            post={item}
            onComment={() => {
              if (item.id) {
                handleComment(item.id);
              }
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

  const renderSearchContent = () => {
    if (isSearching) {
      return renderSearchResults();
    }

    return (
      <KeyboardScreen
        style={styles.scrollView}
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={32}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}>
        {/* Trending Hashtags */}
        {trendingHashtags.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Trending Hashtags</Text>
            <View style={styles.hashtagContainer}>
              {trendingHashtags.map((item) => (
                <AnimatedPressable
                  key={item.id}
                  style={[styles.hashtagChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handleHashtagPress(item.tag)}
                  scaleValue={0.95}>
                  <Text style={[styles.hashtagText, { color: colors.text }]}>#{item.tag}</Text>
                  <Text style={[styles.hashtagCount, { color: colors.textSecondary }]}>
                    {item.count}
                  </Text>
                </AnimatedPressable>
              ))}
            </View>
          </View>
        )}

        {/* Recent Searches */}
        {recentSearches.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Searches</Text>
              <TouchableOpacity onPress={clearRecentSearches}>
                <Text style={[styles.clearText, { color: lightBrown }]}>Clear</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.recentSearchesContainer}>
              {recentSearches.map((search, index) => (
                <AnimatedPressable
                  key={index}
                  style={[styles.recentSearchItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handleRecentSearchPress(search)}
                  scaleValue={0.98}>
                  <IconSymbol name="clock.fill" size={16} color={colors.textSecondary} />
                  <Text style={[styles.recentSearchText, { color: colors.text }]}>{search}</Text>
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      haptics.light();
                      const updated = recentSearches.filter((_, i) => i !== index);
                      setRecentSearches(updated);
                      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
                    }}>
                    <IconSymbol name="xmark.circle.fill" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </AnimatedPressable>
              ))}
            </View>
          </View>
        )}

        {/* Empty State */}
        {trendingHashtags.length === 0 && recentSearches.length === 0 && (
          <View style={styles.centerContainer}>
            <IconSymbol name="magnifyingglass" size={64} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.text }]}>Start Searching</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Search for posts, hashtags, or locations
            </Text>
          </View>
        )}
      </KeyboardScreen>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search Bar */}
      <View style={[styles.searchBarContainer, { paddingTop: insets.top + 10 }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search posts, hashtags..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={clearSearch}>
              <IconSymbol name="xmark.circle.fill" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      {renderSearchContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
  },
  hashtagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hashtagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  hashtagText: {
    fontSize: 14,
    fontWeight: '600',
  },
  hashtagCount: {
    fontSize: 12,
  },
  recentSearchesContainer: {
    gap: 8,
  },
  recentSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  recentSearchText: {
    flex: 1,
    fontSize: 14,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
});
