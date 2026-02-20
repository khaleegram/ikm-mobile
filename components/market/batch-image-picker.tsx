import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { AnimatedPressable } from '@/components/animated-pressable';
import { haptics } from '@/lib/utils/haptics';

const { width } = Dimensions.get('window');
const IMAGE_SIZE = (width - 60) / 3; // 3 columns with padding
const MAX_IMAGES = 20;
const MIN_IMAGES = 1;

interface BatchImagePickerProps {
  images: string[];
  onImagesChange: (images: string[]) => void;
  maxImages?: number;
  minImages?: number;
}

export function BatchImagePicker({
  images,
  onImagesChange,
  maxImages = MAX_IMAGES,
  minImages = MIN_IMAGES,
}: BatchImagePickerProps) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);

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

    const remainingSlots = maxImages - images.length;
    if (remainingSlots <= 0) {
      Alert.alert('Maximum Reached', `You can only select up to ${maxImages} images.`);
      return;
    }

    setLoading(true);
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
        const updatedImages = [...images, ...newImages].slice(0, maxImages);
        onImagesChange(updatedImages);
        haptics.success();
      }
    } catch (error: any) {
      console.error('Error picking images:', error);
      Alert.alert('Error', 'Failed to pick images. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (index: number) => {
    haptics.light();
    const updatedImages = images.filter((_, i) => i !== index);
    onImagesChange(updatedImages);
  };

  const canAddMore = images.length < maxImages;
  const isValid = images.length >= minImages;

  return (
    <View style={styles.container}>
      {/* Header with count */}
      <View style={styles.header}>
        <Text style={[styles.countText, { color: colors.text }]}>
          {images.length}/{maxImages} images
        </Text>
        {!isValid && (
          <Text style={[styles.errorText, { color: colors.error }]}>
            Minimum {minImages} image{minImages > 1 ? 's' : ''} required
          </Text>
        )}
      </View>

      {/* Image Grid */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.gridContainer}>
        {/* Add Button */}
        {canAddMore && (
          <TouchableOpacity
            style={[
              styles.addButton,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: colors.border,
              },
            ]}
            onPress={pickImages}
            disabled={loading}>
            {loading ? (
              <Text style={[styles.addButtonText, { color: colors.textSecondary }]}>
                Loading...
              </Text>
            ) : (
              <>
                <IconSymbol name="plus.circle.fill" size={32} color={colors.primary} />
                <Text style={[styles.addButtonText, { color: colors.textSecondary }]}>
                  Add
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Image Previews */}
        {images.map((uri, index) => (
          <View key={index} style={styles.imageContainer}>
            <Image source={{ uri }} style={styles.image} />
            <AnimatedPressable
              style={styles.removeButton}
              onPress={() => removeImage(index)}
              scaleValue={0.9}>
              <IconSymbol name="xmark.circle.fill" size={24} color="#FF3040" />
            </AnimatedPressable>
            {index === 0 && (
              <View style={styles.primaryBadge}>
                <Text style={styles.primaryBadgeText}>Primary</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  countText: {
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '500',
  },
  gridContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingRight: 20,
  },
  addButton: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  imageContainer: {
    position: 'relative',
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
  },
  image: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  primaryBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: '#A67C52',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
