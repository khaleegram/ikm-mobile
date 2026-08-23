import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import KeyboardScreen from '@/components/layout/KeyboardScreen';
import { HashtagInput } from '@/components/market/hashtag-input';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { marketPostsApi } from '@/lib/api/market-posts';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useInvalidateMarketPost, useMarketPost } from '@/lib/hooks/use-market-post';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { Alert } from '@/components/app-alert';

const lightBrown = '#A67C52';

export default function EditMarketPostScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const postId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { post, loading } = useMarketPost(postId ?? null);
  const { setPost, invalidatePost } = useInvalidateMarketPost();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [saving, setSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const isOwner = Boolean(user?.uid && post?.posterId && user.uid === post.posterId);

  useEffect(() => {
    if (!post || isInitialized) return;
    setTitle(post.title || '');
    setDescription(post.description || '');
    setHashtags(
      Array.isArray(post.hashtags)
        ? post.hashtags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : []
    );
    setPrice(post.price ? String(post.price) : '');
    setCity(post.location?.city || '');
    setState(post.location?.state || '');
    setIsInitialized(true);
  }, [isInitialized, post]);

  const hasChanges = useMemo(() => {
    if (!post) return false;
    const initialTitle = post.title || '';
    const initialDescription = post.description || '';
    const initialPrice = post.price ? String(post.price) : '';
    const initialCity = post.location?.city || '';
    const initialState = post.location?.state || '';
    const initialHashtags = Array.isArray(post.hashtags)
      ? post.hashtags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const tagsChanged =
      hashtags.length !== initialHashtags.length ||
      hashtags.some((tag, index) => tag !== initialHashtags[index]);

    return (
      title.trim() !== initialTitle.trim() ||
      description.trim() !== initialDescription.trim() ||
      tagsChanged ||
      price.trim() !== initialPrice.trim() ||
      city.trim() !== initialCity.trim() ||
      state.trim() !== initialState.trim()
    );
  }, [city, description, hashtags, post, price, state, title]);

  const handleSave = async () => {
    if (!post || !post.id || !isOwner || saving) return;

    const parsedPrice = price.trim() ? Number(price.trim()) : NaN;
    if (price.trim() && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      showToast('Enter a valid price or leave it empty.', 'error');
      return;
    }

    try {
      setSaving(true);
      haptics.medium();

      const cleanedTitle = title.trim().slice(0, 80);
      const cleanedDescription = description.trim().slice(0, 500);
      const cleanedCity = city.trim();
      const cleanedState = state.trim();
      const hasListedPrice = Number.isFinite(parsedPrice);

      if (!cleanedTitle) {
        showToast('Add a product title.', 'error');
        return;
      }

      const payload: Record<string, unknown> = {
        title: cleanedTitle,
        description: cleanedDescription || null,
        hashtags,
        price: hasListedPrice ? parsedPrice : null,
        isNegotiable: hasListedPrice,
        location:
          cleanedCity || cleanedState
            ? {
                city: cleanedCity || undefined,
                state: cleanedState || undefined,
              }
            : null,
      };

      const updated = await marketPostsApi.update(post.id, payload);
      setPost(updated);
      invalidatePost(post.id, post.posterId);
      haptics.success();
      showToast('Post updated successfully.', 'success');
      router.back();
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to update this post.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete here?',
      'Use the manage menu to delete this post. This screen is only for editing details.',
      [{ text: 'OK' }]
    );
  };

  if (loading || !isInitialized) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Post not found</Text>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: lightBrown }]} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isOwner) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Only the post owner can edit this post.</Text>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: lightBrown }]} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIconButton}>
          <IconSymbol name="arrow.left" size={21} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Post</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.saveChip, { backgroundColor: hasChanges ? lightBrown : colors.backgroundSecondary }]}
          disabled={!hasChanges || saving}>
          {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.saveText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardScreen
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={28}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 70 }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Preview</Text>
          <Image source={{ uri: post.images[0] }} style={styles.previewImage} contentFit="cover" />
          <Text style={[styles.cardHint, { color: colors.textSecondary }]}>
            Update title, description, hashtags, price, and location. Photo edits are not available here.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.inputLabel, { color: colors.text }]}>Title</Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            placeholder="Product name"
            placeholderTextColor={colors.textSecondary}
            value={title}
            onChangeText={(value) => setTitle(value.slice(0, 80))}
            maxLength={80}
          />

          <Text style={[styles.inputLabel, styles.spacingTop, { color: colors.text }]}>Description</Text>
          <TextInput
            style={[
              styles.input,
              styles.descriptionInput,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            placeholder="Optional details — size, condition, what’s included"
            placeholderTextColor={colors.textSecondary}
            value={description}
            onChangeText={(value) => setDescription(value.slice(0, 500))}
            multiline
            maxLength={500}
            textAlignVertical="top"
          />

          <View style={styles.spacingTop}>
            <Text style={[styles.cardHint, { color: colors.textSecondary, marginBottom: 8 }]}>
              Hashtags help discovery. They won’t appear on the feed.
            </Text>
            <HashtagInput hashtags={hashtags} onHashtagsChange={setHashtags} />
          </View>

          <Text style={[styles.inputLabel, styles.spacingTop, { color: colors.text }]}>
            Starting price (NGN)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            placeholder="Optional — buyers can still message to negotiate"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            value={price}
            onChangeText={setPrice}
          />

          <Text style={[styles.inputLabel, styles.spacingTop, { color: colors.text }]}>Location</Text>
          <View style={styles.locationRow}>
            <TextInput
              style={[
                styles.input,
                styles.locationInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
              placeholder="City"
              placeholderTextColor={colors.textSecondary}
              value={city}
              onChangeText={setCity}
            />
            <TextInput
              style={[
                styles.input,
                styles.locationInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
              placeholder="State"
              placeholderTextColor={colors.textSecondary}
              value={state}
              onChangeText={setState}
            />
          </View>

          <TouchableOpacity style={styles.deleteHintButton} onPress={handleDelete}>
            <Text style={[styles.deleteHintText, { color: colors.textSecondary }]}>
              Need to delete? Use the post manage menu.
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  emptyTitle: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  backButton: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '800',
  },
  saveChip: {
    minWidth: 74,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  saveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  contentContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  cardHint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  previewImage: {
    width: '100%',
    height: 240,
    borderRadius: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  spacingTop: {
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 14,
    fontWeight: '600',
  },
  descriptionInput: {
    height: undefined,
    minHeight: 96,
    paddingVertical: 10,
    fontWeight: '500',
  },
  locationRow: {
    flexDirection: 'row',
    gap: 10,
  },
  locationInput: {
    flex: 1,
  },
  deleteHintButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  deleteHintText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
