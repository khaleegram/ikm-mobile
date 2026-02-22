import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { collection, endAt, limit, onSnapshot, orderBy, query, startAt } from 'firebase/firestore';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { marketPostsApi } from '@/lib/api/market-posts';
import { useUser } from '@/lib/firebase/auth/use-user';
import { NIGERIA_LOCATION_OPTIONS, type NigeriaLocationOption } from '@/lib/constants/nigeria-locations';
import { firestore } from '@/lib/firebase/config';
import { useTheme } from '@/lib/theme/theme-context';
import { canPostToMarketStreet } from '@/lib/utils/auth-helpers';
import { getLoginRoute } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import KeyboardScreen from '@/components/layout/KeyboardScreen';

const MAX_IMAGES = 20;
const MIN_IMAGES = 1;
const MAX_HASHTAGS = 10;
const lightBrown = '#A67C52';
const HASHTAG_REGEX = /(^|\s)#([a-zA-Z0-9_]+)/g;
const MENTION_REGEX = /(^|\s)@([a-zA-Z0-9._]+)/g;

interface TrendingHashtag {
  id: string;
  tag: string;
  count: number;
}

interface ActiveHashtagContext {
  query: string;
  start: number;
  end: number;
}

function normalizeCreatePostError(error: unknown): string {
  const raw = (error as any)?.message || 'Unable to publish post. Please try again.';
  const lower = String(raw).toLowerCase();

  if (lower.includes('daily') || lower.includes('20 post') || lower.includes('post limit')) {
    return 'Posting is temporarily unavailable. Please try again shortly.';
  }
  if (lower.includes('at least one image')) {
    return 'Please add at least one photo.';
  }
  if (lower.includes('maximum') && lower.includes('image')) {
    return 'You reached the photo limit for one post.';
  }
  return String(raw);
}

function extractTokens(text: string, regex: RegExp, limitCount: number): string[] {
  const found: string[] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(text)) !== null) {
    const token = (match[2] || '').toLowerCase().trim();
    if (token && !found.includes(token)) {
      found.push(token);
      if (found.length >= limitCount) {
        break;
      }
    }
  }

  return found;
}

function getActiveHashtagContext(text: string, cursorIndex: number): ActiveHashtagContext | null {
  const safeCursorIndex = Math.max(0, Math.min(cursorIndex, text.length));

  let start = safeCursorIndex;
  while (start > 0 && !/\s/.test(text[start - 1])) {
    start -= 1;
  }

  let end = safeCursorIndex;
  while (end < text.length && !/\s/.test(text[end])) {
    end += 1;
  }

  const token = text.slice(start, end);
  if (!/^#[a-zA-Z0-9_]*$/.test(token)) return null;

  return {
    query: token.slice(1).toLowerCase(),
    start,
    end,
  };
}

export default function CreatePostScreen() {
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [images, setImages] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isNegotiable, setIsNegotiable] = useState(false);
  const [location, setLocation] = useState({ state: '', city: '' });
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [captionSelection, setCaptionSelection] = useState({ start: 0, end: 0 });
  const [captionInputHeight, setCaptionInputHeight] = useState(96);
  const [trendingHashtags, setTrendingHashtags] = useState<TrendingHashtag[]>([]);
  const [liveHashtagSuggestions, setLiveHashtagSuggestions] = useState<TrendingHashtag[]>([]);
  const hashtags = useMemo(() => extractTokens(description, HASHTAG_REGEX, MAX_HASHTAGS), [description]);
  const mentions = useMemo(() => extractTokens(description, MENTION_REGEX, 20), [description]);
  const activeHashtagContext = useMemo(
    () => getActiveHashtagContext(description, captionSelection.start),
    [description, captionSelection.start]
  );
  const activeHashtagQuery = activeHashtagContext?.query ?? null;
  const hashtagSuggestions = useMemo(() => {
    if (activeHashtagQuery === null) return [];
    if (!activeHashtagQuery.trim()) return trendingHashtags.slice(0, 8);
    return liveHashtagSuggestions.length > 0
      ? liveHashtagSuggestions
      : trendingHashtags
          .filter((item) => item.tag.toLowerCase().startsWith(activeHashtagQuery))
          .slice(0, 8);
  }, [activeHashtagQuery, liveHashtagSuggestions, trendingHashtags]);
  const cursorLineIndex = useMemo(() => {
    const charsPerLineEstimate = 28;
    const beforeCursor = description.slice(0, captionSelection.start);
    const lines = beforeCursor.split('\n');
    const explicitLineCount = Math.max(0, lines.length - 1);
    const tailLine = lines[lines.length - 1] || '';
    const wrappedTailLines = Math.floor(tailLine.length / charsPerLineEstimate);
    return explicitLineCount + wrappedTailLines;
  }, [description, captionSelection.start]);
  const hashtagSuggestionsTop = useMemo(() => {
    const lineHeight = 20;
    const baseTop = 28;
    const desired = baseTop + (cursorLineIndex + 1) * lineHeight + 4;
    const maxTop = Math.max(baseTop, captionInputHeight - 132);
    return Math.min(desired, maxTop);
  }, [captionInputHeight, cursorLineIndex]);
  const locationSuggestions = useMemo(() => {
    const queryValue = locationSearch.trim().toLowerCase();
    const results = !queryValue
      ? NIGERIA_LOCATION_OPTIONS
      : NIGERIA_LOCATION_OPTIONS.filter((option) => {
          return (
            option.city.toLowerCase().includes(queryValue) ||
            option.state.toLowerCase().includes(queryValue) ||
            option.label.toLowerCase().includes(queryValue)
          );
        });
    return results.slice(0, 80);
  }, [locationSearch]);
  const selectedLocationLabel = useMemo(() => {
    if (!location.city && !location.state) return '';
    if (location.city && location.state) return `${location.city}, ${location.state}`;
    return location.city || location.state;
  }, [location.city, location.state]);

  const canPublish = useMemo(() => images.length >= MIN_IMAGES && !loading, [images.length, loading]);

  useEffect(() => {
    const trendingQuery = query(
      collection(firestore, 'trendingHashtags'),
      orderBy('count', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      trendingQuery,
      (snapshot) => {
        const items: TrendingHashtag[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (typeof data.tag === 'string' && data.tag.trim()) {
            items.push({
              id: doc.id,
              tag: data.tag.toLowerCase(),
              count: typeof data.count === 'number' ? data.count : 0,
            });
          }
        });
        setTrendingHashtags(items);
      },
      () => {
        // Keep compose flow usable even if suggestions fail.
        setTrendingHashtags([]);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (activeHashtagQuery === null) {
      setLiveHashtagSuggestions([]);
      return;
    }

    const trimmed = activeHashtagQuery.trim();
    if (!trimmed) {
      setLiveHashtagSuggestions(trendingHashtags.slice(0, 8));
      return;
    }

    const liveQuery = query(
      collection(firestore, 'trendingHashtags'),
      orderBy('tag'),
      startAt(trimmed),
      endAt(`${trimmed}\uf8ff`),
      limit(8)
    );

    const unsubscribe = onSnapshot(
      liveQuery,
      (snapshot) => {
        const items: TrendingHashtag[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (typeof data.tag === 'string' && data.tag.trim()) {
            items.push({
              id: doc.id,
              tag: data.tag.toLowerCase(),
              count: typeof data.count === 'number' ? data.count : 0,
            });
          }
        });
        setLiveHashtagSuggestions(items);
      },
      () => {
        setLiveHashtagSuggestions(
          trendingHashtags
            .filter((item) => item.tag.toLowerCase().startsWith(trimmed))
            .slice(0, 8)
        );
      }
    );

    return () => unsubscribe();
  }, [activeHashtagQuery, trendingHashtags]);

  const requestPermissions = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Allow photo access to create a post.');
      return false;
    }
    return true;
  };

  const pickImages = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      Alert.alert('Limit Reached', 'You reached the photo limit for one post.');
      return;
    }

    haptics.light();

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        allowsEditing: false,
        quality: 0.85,
        selectionLimit: remainingSlots,
      });

      if (!result.canceled && result.assets.length > 0) {
        const selected = result.assets.map((asset) => asset.uri);
        setImages((prev) => [...prev, ...selected].slice(0, MAX_IMAGES));
      }
    } catch {
      showToast('Could not pick images. Please try again.', 'error');
    }
  };

  const removeImage = (index: number) => {
    haptics.light();
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const appendToken = (token: '#' | '@') => {
    haptics.light();
    setDescription((prev) => {
      const trimmedRight = prev.replace(/\s+$/, '');
      if (!trimmedRight) {
        return token;
      }
      return `${trimmedRight} ${token}`;
    });
  };

  const applyHashtagSuggestion = (tag: string) => {
    haptics.light();
    setDescription((prev) => {
      const normalizedTag = tag.toLowerCase().replace(/^#/, '');
      if (!normalizedTag) return prev;

      const context = getActiveHashtagContext(prev, captionSelection.start);
      if (context) {
        const before = prev.slice(0, context.start);
        const after = prev.slice(context.end).replace(/^\s+/, '');
        const spacer = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
        return `${before}${spacer}#${normalizedTag} ${after}`.trimEnd();
      }

      const trimmedRight = prev.replace(/\s+$/, '');
      return `${trimmedRight}${trimmedRight ? ' ' : ''}#${normalizedTag} `;
    });
  };

  const handleLocationPick = (option: NigeriaLocationOption) => {
    haptics.light();
    setLocation({ state: option.state, city: option.city });
    setLocationPickerVisible(false);
    setLocationSearch('');
  };

  const clearLocation = () => {
    haptics.light();
    setLocation({ state: '', city: '' });
  };

  const resetCreatePostForm = useCallback(() => {
    setImages([]);
    setDescription('');
    setPrice('');
    setIsNegotiable(false);
    setLocation({ state: '', city: '' });
    setLocationPickerVisible(false);
    setLocationSearch('');
    setCaptionSelection({ start: 0, end: 0 });
    setCaptionInputHeight(96);
    setLiveHashtagSuggestions([]);
  }, []);

  const handlePublish = async () => {
    if (!canPublish) return;

    setLoading(true);
    haptics.medium();

    try {
      const parsedPrice = price ? parseFloat(price.replace(/[^0-9.]/g, '')) : undefined;

      await marketPostsApi.create({
        images,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        description: description.trim() || undefined,
        price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
        isNegotiable: Number.isFinite(parsedPrice) ? isNegotiable : false,
        location: location.state || location.city ? location : undefined,
        contactMethod: 'in-app',
      });

      haptics.success();
      showToast('Post published.', 'success');
      resetCreatePostForm();
      router.replace('/(market)' as any);
    } catch (error) {
      haptics.error();
      showToast(normalizeCreatePostError(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!user || !canPostToMarketStreet(user)) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.loginTitle, { color: colors.text }]}>Sign in to create a post</Text>
        <TouchableOpacity
          style={[styles.loginButton, { backgroundColor: lightBrown }]}
          onPress={() => router.push(getLoginRoute() as any)}>
          <Text style={styles.loginButtonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIconButton}>
          <IconSymbol name="xmark" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Create Post</Text>
        <TouchableOpacity
          onPress={handlePublish}
          style={[styles.publishChip, { backgroundColor: canPublish ? lightBrown : colors.backgroundSecondary }]}
          disabled={!canPublish}>
          {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.publishText}>Publish</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardScreen
        style={styles.scroll}
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={32}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 72 }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Photos</Text>
            <Text style={[styles.cardHint, { color: colors.textSecondary }]}>Add clear photos of your item.</Text>

            {images.length === 0 ? (
              <TouchableOpacity
                style={[styles.emptyImagePicker, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
                onPress={pickImages}>
                <IconSymbol name="photo.fill" size={28} color={lightBrown} />
                <Text style={[styles.emptyImageText, { color: colors.text }]}>Add Photos</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Image source={{ uri: images[0] }} style={styles.mainPreview} contentFit="cover" />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.thumbRow}>
                  {images.map((uri, index) => (
                    <View key={`${uri}-${index}`} style={styles.thumbWrap}>
                      <Image source={{ uri }} style={styles.thumbImage} contentFit="cover" />
                      <TouchableOpacity style={styles.thumbRemove} onPress={() => removeImage(index)}>
                        <IconSymbol name="xmark" size={12} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <TouchableOpacity
                      style={[styles.addThumb, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
                      onPress={pickImages}>
                      <IconSymbol name="plus" size={20} color={lightBrown} />
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Caption</Text>
            <View style={styles.captionInputContainer}>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Describe your post... Use #hashtags and @tag someone"
                placeholderTextColor={colors.textSecondary}
                multiline
                maxLength={500}
                onSelectionChange={(event) => setCaptionSelection(event.nativeEvent.selection)}
                onContentSizeChange={(event) => {
                  const nextHeight = Math.max(96, event.nativeEvent.contentSize.height + 20);
                  setCaptionInputHeight(nextHeight);
                }}
                style={[
                  styles.captionInput,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.backgroundSecondary,
                    height: captionInputHeight,
                  },
                ]}
              />
              {activeHashtagQuery !== null && hashtagSuggestions.length > 0 && (
                <View
                  style={[
                    styles.cursorSuggestionsWrap,
                    {
                      top: hashtagSuggestionsTop,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    contentContainerStyle={styles.cursorSuggestionsList}>
                    {hashtagSuggestions.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.cursorSuggestionRow, { borderBottomColor: colors.border }]}
                        onPress={() => applyHashtagSuggestion(item.tag)}>
                        <Text style={[styles.cursorSuggestionTag, { color: colors.text }]}>#{item.tag}</Text>
                        <Text style={[styles.cursorSuggestionCount, { color: colors.textSecondary }]}>
                          {item.count} {item.count === 1 ? 'post' : 'posts'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
            <View style={styles.captionActions}>
              <TouchableOpacity
                style={[styles.captionActionChip, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                onPress={() => appendToken('#')}>
                <IconSymbol name="tag" size={13} color={lightBrown} />
                <Text style={[styles.captionActionText, { color: colors.text }]}>Hashtag</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.captionActionChip, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                onPress={() => appendToken('@')}>
                <IconSymbol name="person.fill" size={13} color={lightBrown} />
                <Text style={[styles.captionActionText, { color: colors.text }]}>Tag</Text>
              </TouchableOpacity>
            </View>
            {(hashtags.length > 0 || mentions.length > 0) && (
              <View style={styles.detectedWrap}>
                {hashtags.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.detectedChipsRow}>
                    {hashtags.map((tag) => (
                      <View key={tag} style={[styles.detectedChip, { backgroundColor: colors.backgroundSecondary }]}>
                        <Text style={[styles.detectedChipText, { color: colors.text }]}>#{tag}</Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
                {mentions.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.detectedChipsRow}>
                    {mentions.map((mention) => (
                      <View key={mention} style={[styles.detectedChip, { backgroundColor: colors.backgroundSecondary }]}>
                        <Text style={[styles.detectedChipText, { color: colors.text }]}>@{mention}</Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
            <Text style={[styles.counterText, { color: colors.textSecondary }]}>{description.length}/500</Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Price (Optional)</Text>
            <View style={[styles.priceInputWrap, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.pricePrefix, { color: colors.textSecondary }]}>NGN</Text>
              <TextInput
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                style={[styles.priceInput, { color: colors.text }]}
              />
            </View>
            <View style={styles.negotiableRow}>
              <View style={styles.negotiableTextWrap}>
                <Text style={[styles.negotiableTitle, { color: colors.text }]}>Price is negotiable</Text>
                <Text style={[styles.negotiableHint, { color: colors.textSecondary }]}>
                  Show a DM button next to Buy on your post.
                </Text>
              </View>
              <Switch
                value={isNegotiable}
                onValueChange={(value) => {
                  haptics.light();
                  setIsNegotiable(value);
                }}
                thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
                trackColor={{ false: '#9CA3AF', true: lightBrown }}
              />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Location (Optional)</Text>
            <TouchableOpacity
              style={[styles.locationPicker, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
              onPress={() => setLocationPickerVisible(true)}>
              <IconSymbol name="location.fill" size={16} color={lightBrown} />
              <Text
                style={[
                  styles.locationPickerText,
                  { color: selectedLocationLabel ? colors.text : colors.textSecondary },
                ]}
                numberOfLines={1}>
                {selectedLocationLabel || 'Search and select location'}
              </Text>
              <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
            {!!selectedLocationLabel && (
              <TouchableOpacity style={styles.clearLocationButton} onPress={clearLocation}>
                <Text style={[styles.clearLocationText, { color: lightBrown }]}>Clear location</Text>
              </TouchableOpacity>
            )}
          </View>
      </KeyboardScreen>

      <Modal
        visible={locationPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setLocationPickerVisible(false)}>
        <Pressable style={styles.locationModalBackdrop} onPress={() => setLocationPickerVisible(false)}>
          {/* Keep FlatList out of ScrollView wrappers to avoid nested VirtualizedList warnings. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={insets.top}
            style={styles.locationModalKeyboardWrap}>
            <Pressable
              style={[
                styles.locationModalSheet,
                {
                  backgroundColor: colors.card,
                  borderTopColor: colors.border,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
              onPress={(e) => e.stopPropagation()}>
              <View style={styles.locationModalHeader}>
                <Text style={[styles.locationModalTitle, { color: colors.text }]}>Pick Location</Text>
                <TouchableOpacity onPress={() => setLocationPickerVisible(false)} style={styles.locationModalCloseButton}>
                  <IconSymbol name="xmark" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
              <View style={[styles.locationSearchWrap, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
                <IconSymbol name="magnifyingglass" size={16} color={colors.textSecondary} />
                <TextInput
                  value={locationSearch}
                  onChangeText={setLocationSearch}
                  placeholder="Search city or state"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={[styles.locationSearchInput, { color: colors.text }]}
                />
              </View>
              <FlatList
                data={locationSuggestions}
                keyExtractor={(item) => `${item.state}-${item.city}`}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="none"
                contentContainerStyle={styles.locationListContent}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.locationRowItem, { borderBottomColor: colors.border }]}
                    onPress={() => handleLocationPick(item)}>
                    <Text style={[styles.locationRowMain, { color: colors.text }]}>{item.city}</Text>
                    <Text style={[styles.locationRowSub, { color: colors.textSecondary }]}>{item.state}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyLocationWrap}>
                    <Text style={[styles.emptyLocationText, { color: colors.textSecondary }]}>No location found</Text>
                  </View>
                }
              />
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loginTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  loginButton: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  publishChip: {
    minWidth: 84,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  publishText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 12,
    paddingTop: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  cardHint: {
    fontSize: 12,
    marginBottom: 8,
  },
  emptyImagePicker: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    minHeight: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyImageText: {
    fontSize: 14,
    fontWeight: '700',
  },
  mainPreview: {
    width: '100%',
    height: 240,
    borderRadius: 14,
    backgroundColor: '#101010',
  },
  thumbRow: {
    paddingTop: 10,
    gap: 10,
  },
  thumbWrap: {
    width: 74,
    height: 74,
    borderRadius: 10,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  addThumb: {
    width: 74,
    height: 74,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  captionInputContainer: {
    position: 'relative',
  },
  counterText: {
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
  },
  captionActions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  captionActionChip: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  captionActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detectedWrap: {
    marginTop: 10,
    gap: 8,
  },
  detectedChipsRow: {
    gap: 8,
  },
  detectedChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detectedChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cursorSuggestionsWrap: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 20,
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 170,
    overflow: 'hidden',
  },
  cursorSuggestionsList: {
    paddingVertical: 2,
  },
  cursorSuggestionRow: {
    minHeight: 38,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cursorSuggestionTag: {
    fontSize: 13,
    fontWeight: '700',
  },
  cursorSuggestionCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  priceInputWrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
  },
  pricePrefix: {
    fontSize: 13,
    fontWeight: '700',
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 8,
  },
  negotiableRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  negotiableTextWrap: {
    flex: 1,
  },
  negotiableTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  negotiableHint: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
  },
  locationPicker: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  locationPickerText: {
    flex: 1,
    fontSize: 14,
  },
  clearLocationButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  clearLocationText: {
    fontSize: 12,
    fontWeight: '700',
  },
  locationModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  locationModalKeyboardWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  locationModalSheet: {
    maxHeight: '75%',
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  locationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  locationModalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  locationModalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationSearchWrap: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  locationSearchInput: {
    flex: 1,
    fontSize: 14,
  },
  locationListContent: {
    paddingBottom: 6,
  },
  locationRowItem: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    gap: 2,
  },
  locationRowMain: {
    fontSize: 14,
    fontWeight: '700',
  },
  locationRowSub: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyLocationWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyLocationText: {
    fontSize: 13,
  },
});
