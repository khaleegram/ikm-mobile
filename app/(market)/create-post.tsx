import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useTheme } from '@/lib/theme/theme-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AnimatedPressable } from '@/components/animated-pressable';
import { marketPostsApi } from '@/lib/api/market-posts';
import { showToast } from '@/components/toast';
import { haptics } from '@/lib/utils/haptics';
import { canPostToMarketStreet } from '@/lib/utils/auth-helpers';
import { HashtagInput } from '@/components/market/hashtag-input';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');
const lightBrown = '#A67C52';
const MAX_IMAGES = 20;
const MIN_IMAGES = 1;

export default function CreatePostScreen() {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Form state
  const [images, setImages] = useState<string[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState({ state: '', city: '' });
  const [contactMethod, setContactMethod] = useState<'in-app' | 'whatsapp'>('in-app');

  // Redirect if not logged in
  React.useEffect(() => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to create posts', [
        { text: 'Cancel', onPress: () => router.back() },
        { text: 'Login', onPress: () => router.push('/(auth)/login') },
      ]);
    }
  }, [user]);

  React.useEffect(() => {
    if (images.length > 0 && !showDetails) {
      // Auto-show details after selecting images
      setTimeout(() => {
        setShowDetails(true);
        Animated.spring(slideAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 50,
          friction: 8,
        }).start();
      }, 300);
    }
  }, [images.length]);

  const requestPermissions = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'We need access to your photos to select images.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  const pickImages = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      Alert.alert('Maximum Reached', `You can only select up to ${MAX_IMAGES} images.`);
      return;
    }

    haptics.light();

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        allowsEditing: false,
        quality: 0.8,
        selectionLimit: remainingSlots,
      });

      if (!result.canceled && result.assets.length > 0) {
        const newImages = result.assets.map((asset) => asset.uri);
        const updatedImages = [...images, ...newImages].slice(0, MAX_IMAGES);
        setImages(updatedImages);
        haptics.success();
      }
    } catch (error: any) {
      console.error('Error picking images:', error);
      Alert.alert('Error', 'Failed to pick images. Please try again.');
    }
  };

  const removeImage = (index: number) => {
    haptics.light();
    const updatedImages = images.filter((_, i) => i !== index);
    setImages(updatedImages);
    if (updatedImages.length === 0) {
      setShowDetails(false);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  };

  const handleImageScroll = (event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / width);
    setCurrentImageIndex(index);
  };

  const handleSubmit = async () => {
    if (images.length < MIN_IMAGES) {
      haptics.error();
      showToast('Please select at least 1 image', 'error');
      return;
    }

    setLoading(true);
    haptics.medium();

    try {
      const priceNumber = price ? parseFloat(price.replace(/[^0-9.]/g, '')) : undefined;

      await marketPostsApi.create({
        images,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        price: priceNumber,
        description: description.trim() || undefined,
        location: location.state || location.city ? location : undefined,
        contactMethod,
      });

      haptics.success();
      showToast('Post created successfully!', 'success');
      router.replace('/(market)/index');
    } catch (error: any) {
      console.error('Error creating post:', error);
      haptics.error();
      showToast(error.message || 'Failed to create post. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!user || !canPostToMarketStreet(user)) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.text, { color: colors.text }]}>Please log in to create posts</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: lightBrown }]}
          onPress={() => router.push('/(auth)/login')}>
          <Text style={styles.buttonText}>Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const detailsSheetTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      {/* Header - TikTok Style */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: 'rgba(0,0,0,0.5)',
          },
        ]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <IconSymbol name="xmark" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={loading || images.length < MIN_IMAGES}
          style={[
            styles.headerButton,
            { opacity: loading || images.length < MIN_IMAGES ? 0.5 : 1 },
          ]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={[styles.postButton, { opacity: images.length < MIN_IMAGES ? 0.5 : 1 }]}>
              Post
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Full Screen Image Preview - TikTok Style */}
      {images.length > 0 ? (
        <View style={styles.imagePreviewContainer}>
          <ScrollView
            ref={scrollViewRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleImageScroll}
            style={styles.imageScrollView}>
            {images.map((uri, index) => (
              <View key={index} style={styles.imageWrapper}>
                <Image
                  source={{ uri }}
                  style={styles.previewImage}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory"
                />
                {/* Remove button overlay */}
                <TouchableOpacity
                  style={styles.removeImageButton}
                  onPress={() => removeImage(index)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <View style={styles.removeButtonCircle}>
                    <IconSymbol name="xmark" size={16} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          {/* Image Pagination Dots */}
          {images.length > 1 && (
            <View style={styles.paginationContainer}>
              {images.map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.paginationDot,
                    {
                      backgroundColor:
                        index === currentImageIndex
                          ? '#FFFFFF'
                          : 'rgba(255, 255, 255, 0.4)',
                    },
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      ) : (
        /* Empty State - TikTok Style */
        <View style={styles.emptyState}>
          <View style={styles.emptyStateContent}>
            <View style={[styles.emptyIconCircle, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <IconSymbol name="photo.fill" size={64} color="#FFFFFF" />
            </View>
            <Text style={styles.emptyTitle}>Select Photos</Text>
            <Text style={styles.emptySubtitle}>Choose 1-20 photos to share</Text>
            <AnimatedPressable
              style={[styles.selectButton, { backgroundColor: lightBrown }]}
              onPress={pickImages}
              scaleValue={0.95}>
              <IconSymbol name="photo.on.rectangle" size={24} color="#FFFFFF" />
              <Text style={styles.selectButtonText}>Select from Library</Text>
            </AnimatedPressable>
          </View>
        </View>
      )}

      {/* Bottom Details Sheet - TikTok Style */}
      <Animated.View
        style={[
          styles.detailsSheet,
          {
            backgroundColor: colors.background,
            paddingBottom: insets.bottom + 20,
            transform: [{ translateY: detailsSheetTranslateY }],
          },
        ]}>
        <View style={styles.detailsSheetHandle}>
          <View style={[styles.handleBar, { backgroundColor: colors.textSecondary }]} />
        </View>

        <ScrollView
          style={styles.detailsScrollView}
          contentContainerStyle={styles.detailsContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {/* Caption */}
          <View style={styles.detailsSection}>
            <Text style={[styles.detailsLabel, { color: colors.text }]}>Caption</Text>
            <TextInput
              style={[
                styles.captionInput,
                {
                  backgroundColor: colors.backgroundSecondary,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              placeholder="What are you selling?"
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
            />
            <Text style={[styles.charCount, { color: colors.textSecondary }]}>
              {description.length}/500
            </Text>
          </View>

          {/* Price */}
          <View style={styles.detailsSection}>
            <Text style={[styles.detailsLabel, { color: colors.text }]}>Price</Text>
            <View
              style={[
                styles.priceRow,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: colors.border,
                },
              ]}>
              <Text style={[styles.currencySymbol, { color: colors.textSecondary }]}>₦</Text>
              <TextInput
                style={[styles.priceInput, { color: colors.text }]}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
              />
            </View>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Leave empty to show "Ask for Price"
            </Text>
          </View>

          {/* Hashtags */}
          <View style={styles.detailsSection}>
            <HashtagInput hashtags={hashtags} onHashtagsChange={setHashtags} />
          </View>

          {/* Location */}
          <View style={styles.detailsSection}>
            <Text style={[styles.detailsLabel, { color: colors.text }]}>Location (Optional)</Text>
            <View style={styles.locationRow}>
              <TextInput
                style={[
                  styles.locationInput,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="State"
                placeholderTextColor={colors.textSecondary}
                value={location.state}
                onChangeText={(text) => setLocation({ ...location, state: text })}
              />
              <TextInput
                style={[
                  styles.locationInput,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="City"
                placeholderTextColor={colors.textSecondary}
                value={location.city}
                onChangeText={(text) => setLocation({ ...location, city: text })}
              />
            </View>
          </View>
        </ScrollView>
      </Animated.View>

      {/* Add More Images Button - Floating */}
      {images.length > 0 && images.length < MAX_IMAGES && (
        <TouchableOpacity
          style={[styles.addMoreButton, { backgroundColor: lightBrown }]}
          onPress={pickImages}>
          <IconSymbol name="plus" size={20} color="#FFFFFF" />
          <Text style={styles.addMoreText}>Add Photos</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  postButton: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  imagePreviewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageScrollView: {
    flex: 1,
  },
  imageWrapper: {
    width,
    height: '100%',
    position: 'relative',
  },
  previewImage: {
    width,
    height: '100%',
  },
  removeImageButton: {
    position: 'absolute',
    top: 60,
    right: 16,
    zIndex: 10,
  },
  removeButtonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paginationContainer: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    zIndex: 10,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  emptyStateContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 32,
    textAlign: 'center',
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
  },
  selectButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  detailsSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: height * 0.6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 20,
  },
  detailsSheetHandle: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.3,
  },
  detailsScrollView: {
    flex: 1,
  },
  detailsContent: {
    padding: 20,
    gap: 20,
  },
  detailsSection: {
    gap: 8,
  },
  detailsLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  captionInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    textAlign: 'right',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '600',
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: 12,
  },
  hint: {
    fontSize: 12,
  },
  locationRow: {
    flexDirection: 'row',
    gap: 12,
  },
  locationInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  addMoreButton: {
    position: 'absolute',
    bottom: 200,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  addMoreText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  text: {
    fontSize: 18,
  },
  button: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
