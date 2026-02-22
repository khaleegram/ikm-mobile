import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useMarketPost } from '@/lib/firebase/firestore/market-posts';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';

const lightBrown = '#A67C52';
const MAX_HASHTAGS = 10;
const HASHTAG_REGEX = /(^|\s)#([a-zA-Z0-9_]+)/g;

function extractHashtags(text: string): string[] {
  const found: string[] = [];
  HASHTAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = HASHTAG_REGEX.exec(text)) !== null) {
    const tag = (match[2] || '').toLowerCase().trim();
    if (tag && !found.includes(tag)) {
      found.push(tag);
      if (found.length >= MAX_HASHTAGS) break;
    }
  }

  return found;
}

export default function EditMarketPostScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const postId = Array.isArray(id) ? id[0] : id;
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { post, loading } = useMarketPost(postId ?? null);

  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [saving, setSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const isOwner = Boolean(user?.uid && post?.posterId && user.uid === post.posterId);

  useEffect(() => {
    if (!post || isInitialized) return;
    setDescription(post.description || '');
    setPrice(post.price ? String(post.price) : '');
    setCity(post.location?.city || '');
    setState(post.location?.state || '');
    setIsInitialized(true);
  }, [isInitialized, post]);

  const hasChanges = useMemo(() => {
    if (!post) return false;
    const initialDescription = post.description || '';
    const initialPrice = post.price ? String(post.price) : '';
    const initialCity = post.location?.city || '';
    const initialState = post.location?.state || '';

    return (
      description.trim() !== initialDescription.trim() ||
      price.trim() !== initialPrice.trim() ||
      city.trim() !== initialCity.trim() ||
      state.trim() !== initialState.trim()
    );
  }, [city, description, post, price, state]);

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

      const cleanedDescription = description.trim();
      const cleanedCity = city.trim();
      const cleanedState = state.trim();
      const hashtags = extractHashtags(cleanedDescription);

      const payload: Record<string, any> = {
        updatedAt: serverTimestamp(),
        description: cleanedDescription || deleteField(),
        hashtags: hashtags.length > 0 ? hashtags : deleteField(),
        price: Number.isFinite(parsedPrice) ? parsedPrice : deleteField(),
      };

      if (cleanedCity || cleanedState) {
        payload.location = {
          city: cleanedCity || undefined,
          state: cleanedState || undefined,
        };
      } else {
        payload.location = deleteField();
      }

      await updateDoc(doc(firestore, 'marketPosts', post.id), payload);
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
            Update caption, price, and location. Photo edits are not available here.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.inputLabel, { color: colors.text }]}>Caption</Text>
          <TextInput
            style={[
              styles.textArea,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            placeholder="Describe your post..."
            placeholderTextColor={colors.textSecondary}
            multiline
            value={description}
            onChangeText={setDescription}
            maxLength={500}
          />

          <Text style={[styles.inputLabel, styles.spacingTop, { color: colors.text }]}>Price (NGN)</Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            placeholder="Optional"
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
  textArea: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 14,
    fontWeight: '600',
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
