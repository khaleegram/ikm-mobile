// Modern Product Detail/Edit Screen with Hero Design
import { AnimatedPressable } from '@/components/animated-pressable';
import { CategoryFields } from '@/components/products/category-fields/CategoryFields';
import { SafeImage } from '@/components/safe-image';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { productApi } from '@/lib/api/product-category-api';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useProduct } from '@/lib/firebase/firestore/products';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { pickAudio, pickMultipleImages, pickVideo } from '@/lib/utils/image-upload';
import { ProductCategory } from '@/types';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useUser();
  const { product, loading } = useProduct(id);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    compareAtPrice: '',
    stock: '',
    status: 'active' as 'active' | 'draft' | 'inactive',
    sku: '',
    isFeatured: false,
    volume: '',
    fragranceType: '',
    container: '',
    sizeType: '' as 'free-size' | 'abaya-length' | 'standard' | '',
    abayaLength: '',
    standardSize: '',
    setIncludes: '',
    material: '',
    packaging: '',
    quantity: '',
    taste: '',
    materialType: '',
    customMaterialType: '',
    fabricLength: '',
    quality: '',
    skincareBrand: '',
    skincareType: '',
    skincareSize: '',
    haircareType: '',
    haircareBrand: '',
    haircareSize: '',
    haircarePackageItems: [] as string[],
    islamicType: '',
    islamicSize: '',
    islamicMaterial: '',
    brand: '',
    model: '',
    deliveryFeePaidBy: 'buyer' as 'seller' | 'buyer',
    deliveryMethods: {
      localDispatch: { enabled: false },
      waybill: { enabled: false },
      pickup: { enabled: false, landmark: '' },
    },
  });
  const [categoryErrors, setCategoryErrors] = useState<Record<string, string>>({});
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [newImageUris, setNewImageUris] = useState<string[]>([]);
  const [productVideoUrl, setProductVideoUrl] = useState<string>('');
  const [newVideoUri, setNewVideoUri] = useState<string | null>(null);
  const [productAudioUrl, setProductAudioUrl] = useState<string>('');
  const [newAudioUri, setNewAudioUri] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  
  // Apply the updated styles
  const styles = createStyles(colors, insets);
  
  // Get all images for gallery (excluding first one as it's shown in hero)
  const galleryImages = productImageUrls.length > 1 ? productImageUrls.slice(1) : [];
  const allImages = productImageUrls.length > 0 ? productImageUrls : (product?.imageUrls || []);

  const productCategory = (product?.category as ProductCategory) || null;

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        description: product.description || '',
        price: product.price.toString(),
        compareAtPrice: product.compareAtPrice?.toString() || '',
        stock: product.stock.toString(),
        status: product.status || 'active',
        sku: product.sku || '',
        isFeatured: product.isFeatured || false,
        volume: product.volume || '',
        fragranceType: product.fragranceType || '',
        container: product.container || '',
        sizeType: product.sizeType || '',
        abayaLength: product.abayaLength || '',
        standardSize: product.standardSize || '',
        setIncludes: product.setIncludes || '',
        material: product.material || '',
        packaging: product.packaging || '',
        quantity: product.quantity?.toString() || '',
        taste: product.taste || '',
        materialType: product.materialType || '',
        customMaterialType: product.customMaterialType || '',
        fabricLength: product.fabricLength || '',
        quality: product.quality || '',
        skincareBrand: product.skincareBrand || '',
        skincareType: product.skincareType || '',
        skincareSize: product.skincareSize || '',
        haircareType: product.haircareType || '',
        haircareBrand: product.haircareBrand || '',
        haircareSize: product.haircareSize || '',
        haircarePackageItems: product.haircarePackageItems || [],
        islamicType: product.islamicType || '',
        islamicSize: product.islamicSize || '',
        islamicMaterial: product.islamicMaterial || '',
        brand: product.brand || '',
        model: product.model || '',
        deliveryFeePaidBy: product.deliveryFeePaidBy || 'buyer',
        deliveryMethods: product.deliveryMethods ? {
          localDispatch: product.deliveryMethods.localDispatch || { enabled: false },
          waybill: product.deliveryMethods.waybill || { enabled: false },
          pickup: product.deliveryMethods.pickup ? {
            enabled: product.deliveryMethods.pickup.enabled || false,
            landmark: product.deliveryMethods.pickup.landmark || ''
          } : { enabled: false, landmark: '' },
        } : {
          localDispatch: { enabled: false },
          waybill: { enabled: false },
          pickup: { enabled: false, landmark: '' },
        },
      });
      setProductImageUrls(product.imageUrls || (product.imageUrl ? [product.imageUrl] : []));
      setNewImageUris([]);
      setProductVideoUrl(product.videoUrl || '');
      setNewVideoUri(null);
      setProductAudioUrl(product.audioDescription || '');
      setNewAudioUri(null);
    }
  }, [product]);

  const handlePickImages = async () => {
    try {
      const imageUris = await pickMultipleImages(10);
      if (imageUris.length > 0) {
        setNewImageUris([...newImageUris, ...imageUris].slice(0, 10));
      }
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to pick images', 'error');
    }
  };

  const handleRemoveImage = (index: number, isNew: boolean) => {
    if (isNew) {
      setNewImageUris(newImageUris.filter((_, i) => i !== index));
    } else {
      setProductImageUrls(productImageUrls.filter((_, i) => i !== index));
    }
  };

  const handlePickVideo = async () => {
    try {
      const videoUri = await pickVideo();
      if (videoUri) {
        setNewVideoUri(videoUri);
      }
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to pick video', 'error');
    }
  };

  const handleRemoveVideo = () => {
    setProductVideoUrl('');
    setNewVideoUri(null);
  };

  const handlePickAudio = async () => {
    try {
      const audioUri = await pickAudio();
      if (audioUri) {
        setNewAudioUri(audioUri);
      }
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to pick audio', 'error');
    }
  };

  const handleRemoveAudio = () => {
    setProductAudioUrl('');
    setNewAudioUri(null);
  };

  const handleSave = async () => {
    if (!user || !product) return;

    if (!formData.name || !formData.price || !formData.stock) {
      haptics.warning();
      showToast('Please fill in all required fields', 'warning');
      return;
    }

    setSaving(true);
    setUploadingMedia(true);
    try {
      if (!productCategory) {
        haptics.warning();
        showToast('Product category is required', 'warning');
        setSaving(false);
        setUploadingMedia(false);
        return;
      }

      // Convert new images to base64 and send to cloud function
      // Note: Cloud function only supports single imageBase64 (legacy)
      // Existing images will be preserved via imageUrls
      let imageBase64: string | undefined;
      const existingImageUrls = [...productImageUrls];

      if (newImageUris.length > 0) {
        try {
          // Convert first new image to base64 (cloud function limitation)
          imageBase64 = await convertImageToBase64(newImageUris[0]);
        } catch (error: any) {
          console.error('Error converting image to base64:', error);
          showToast('Failed to process image', 'error');
        }
      }

      // Note: Video and audio are skipped for now because:
      // 1. Cloud function expects URLs, not base64
      // 2. Mobile app cannot upload directly due to storage rules
      // TODO: Backend needs to support videoBase64 and audioBase64

      await productApi.update(product.id!, {
        name: formData.name,
        description: formData.description || undefined,
        price: parseFloat(formData.price),
        compareAtPrice: formData.compareAtPrice ? parseFloat(formData.compareAtPrice) : undefined,
        stock: parseInt(formData.stock, 10),
        status: formData.status,
        imageBase64, // Send first new image as base64 (cloud function will upload and merge)
        imageUrls: existingImageUrls.length > 0 ? existingImageUrls : undefined, // Preserve existing images
        // Note: videoUrl and audioDescription will be preserved from existing product
        // New video/audio cannot be uploaded without backend support
        sku: formData.sku || undefined,
        category: productCategory,
        volume: formData.volume || undefined,
        fragranceType: formData.fragranceType || undefined,
        container: formData.container || undefined,
        sizeType: formData.sizeType || undefined,
        abayaLength: formData.abayaLength || undefined,
        standardSize: formData.standardSize || undefined,
        setIncludes: formData.setIncludes || undefined,
        material: formData.material || undefined,
        packaging: formData.packaging || undefined,
        quantity: formData.quantity ? parseInt(formData.quantity, 10) : undefined,
        taste: formData.taste || undefined,
        materialType: formData.materialType || undefined,
        customMaterialType: formData.customMaterialType || undefined,
        fabricLength: formData.fabricLength || undefined,
        quality: formData.quality || undefined,
        skincareBrand: formData.skincareBrand || undefined,
        skincareType: formData.skincareType || undefined,
        skincareSize: formData.skincareSize || undefined,
        haircareType: formData.haircareType || undefined,
        haircareBrand: formData.haircareBrand || undefined,
        haircareSize: formData.haircareSize || undefined,
        haircarePackageItems: formData.haircarePackageItems.length > 0 ? formData.haircarePackageItems : undefined,
        islamicType: formData.islamicType || undefined,
        islamicSize: formData.islamicSize || undefined,
        islamicMaterial: formData.islamicMaterial || undefined,
        brand: formData.brand || undefined,
        model: formData.model || undefined,
        deliveryFeePaidBy: formData.deliveryFeePaidBy,
        deliveryMethods: formData.deliveryMethods,
      });
      
      haptics.success();
      showToast('Product updated successfully', 'success');
      setEditing(false);
      setNewImageUris([]);
      setNewVideoUri(null);
      setNewAudioUri(null);
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to update product', 'error');
    } finally {
      setSaving(false);
      setUploadingMedia(false);
    }
  };

  const handleCategoryFieldChange = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value });
    if (categoryErrors[field]) {
      setCategoryErrors({ ...categoryErrors, [field]: '' });
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text, fontSize: 16 }}>Product not found</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}>
      
      {/* Fixed Header - Outside ScrollView */}
      <View style={[styles.floatingHeaderContainer, styles.fixedHeader, { paddingTop: insets.top + 10, paddingBottom: 15 }]}>
        <AnimatedPressable
          style={[styles.headerButtonIsland, { backgroundColor: 'rgba(255, 255, 255, 0.25)' }]}
          onPress={() => { haptics.light(); router.back(); }}
          scaleValue={0.9}>
          <IconSymbol name="chevron.left" size={20} color="#FFFFFF" />
        </AnimatedPressable>

        <View style={[styles.nameIsland, { backgroundColor: '#A67C52' }]}>
          <Text style={styles.islandLabel}>PRODUCT MANAGER</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>{product?.name || ''}</Text>
        </View>

        <AnimatedPressable
          style={[styles.headerButtonIsland, { backgroundColor: editing ? '#A67C52' : 'rgba(255, 255, 255, 0.25)' }]}
          onPress={() => {
            haptics.light();
            if (editing) { handleSave(); } else { setEditing(true); }
          }}
          disabled={saving}
          scaleValue={0.9}>
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <IconSymbol name={editing ? "checkmark.circle.fill" : "pencil.fill"} size={18} color="#FFFFFF" />
          )}
        </AnimatedPressable>
      </View>

      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        
        {/* Updated Hero Section */}
        <View style={styles.heroSection}>
          <TouchableOpacity 
            activeOpacity={0.9}
            onPress={() => {
              if (allImages.length > 0) {
                setSelectedImageIndex(0);
                setShowImageModal(true);
                haptics.light();
              }
            }}
            style={styles.heroImageTouchable}>
            <SafeImage
              uri={
                newImageUris[0] || 
                productImageUrls[0] || 
                product?.imageUrls?.[0] || 
                product?.imageUrl || 
                ''
              }
              style={styles.heroImage}
              placeholderIcon="photo"
              placeholderSize={64}
            />
          </TouchableOpacity>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.heroGradient} />
        </View>

        <View style={[styles.contentSection, { backgroundColor: colors.card }]}>
          {editing ? (
            <View style={styles.editForm}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>
                  Product Name <Text style={{ color: colors.error }}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                  value={formData.name}
                  onChangeText={(text) => setFormData({ ...formData, name: text })}
                  placeholder="Enter product name"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Description (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                  value={formData.description}
                  onChangeText={(text) => setFormData({ ...formData, description: text })}
                  placeholder="Describe your product..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={4}
                />
              </View>

              <View style={styles.row}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={[styles.label, { color: colors.text }]}>
                    Price (₦) <Text style={{ color: colors.error }}>*</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                    value={formData.price}
                    onChangeText={(text) => setFormData({ ...formData, price: text.replace(/[^0-9.]/g, '') })}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={[styles.label, { color: colors.text }]}>Stock <Text style={{ color: colors.error }}>*</Text></Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                    value={formData.stock}
                    onChangeText={(text) => setFormData({ ...formData, stock: text.replace(/[^0-9]/g, '') })}
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Compare At Price (₦)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                  value={formData.compareAtPrice}
                  onChangeText={(text) => setFormData({ ...formData, compareAtPrice: text.replace(/[^0-9.]/g, '') })}
                  placeholder="Original price (optional)"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>

              <View style={styles.row}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={[styles.label, { color: colors.text }]}>SKU</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                    value={formData.sku}
                    onChangeText={(text) => setFormData({ ...formData, sku: text })}
                    placeholder="Stock Keeping Unit"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              </View>

              {productCategory && (
                <View style={styles.inputGroup}>
                  <CategoryFields
                    category={productCategory}
                    formData={formData}
                    onChange={handleCategoryFieldChange}
                    errors={categoryErrors}
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Status</Text>
                <View style={styles.statusButtons}>
                  {(['draft', 'active', 'inactive'] as const).map((status) => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.statusButton,
                        {
                          backgroundColor: formData.status === status ? colors.primary : colors.backgroundSecondary,
                          borderColor: formData.status === status ? colors.primary : colors.cardBorder,
                        },
                      ]}
                      onPress={() => {
                        haptics.selection();
                        setFormData({ ...formData, status });
                      }}>
                      <Text
                        style={[
                          styles.statusButtonText,
                          { color: formData.status === status ? '#FFFFFF' : colors.text },
                        ]}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={[styles.switchRow, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={styles.switchContent}>
                  <Text style={[styles.switchLabel, { color: colors.text }]}>Featured Product</Text>
                  <Text style={[styles.switchHint, { color: colors.textSecondary }]}>
                    Show this product prominently
                  </Text>
                </View>
                <Switch
                  value={formData.isFeatured}
                  onValueChange={(value) => {
                    haptics.selection();
                    setFormData({ ...formData, isFeatured: value });
                  }}
                  trackColor={{ false: colors.cardBorder, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>
                  Product Images {(productImageUrls.length + newImageUris.length > 0) && `(${productImageUrls.length + newImageUris.length}/10)`}
                </Text>
                <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 13 }}>
                  Add up to 10 images of your product
                </Text>
                
                {(productImageUrls.length > 0 || newImageUris.length > 0) && (
                  <View style={styles.mediaGrid}>
                    {productImageUrls.map((url, index) => (
                      <View key={`existing-${index}`} style={[styles.mediaPreview, { backgroundColor: colors.backgroundSecondary }]}>
                        <SafeImage uri={url} style={styles.previewImage} placeholderIcon="photo" placeholderSize={32} />
                        <TouchableOpacity
                          style={[styles.removeMediaButton, { backgroundColor: colors.error }]}
                          onPress={() => handleRemoveImage(index, false)}>
                          <IconSymbol name="xmark" size={14} color="#FFFFFF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {newImageUris.map((uri, index) => (
                      <View key={`new-${index}`} style={[styles.mediaPreview, { backgroundColor: colors.backgroundSecondary }]}>
                        <SafeImage uri={uri} style={styles.previewImage} placeholderIcon="photo" placeholderSize={32} />
                        <TouchableOpacity
                          style={[styles.removeMediaButton, { backgroundColor: colors.error }]}
                          onPress={() => handleRemoveImage(index, true)}>
                          <IconSymbol name="xmark" size={14} color="#FFFFFF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {(productImageUrls.length + newImageUris.length) < 10 && (
                  <AnimatedPressable
                    style={[styles.mediaPickerButton, { borderColor: colors.primary, backgroundColor: colors.backgroundSecondary }]}
                    onPress={handlePickImages}
                    scaleValue={0.98}>
                    <IconSymbol name="photo.fill" size={24} color={colors.primary} />
                    <Text style={[styles.mediaPickerText, { color: colors.primary }]}>
                      {(productImageUrls.length + newImageUris.length) === 0 ? 'Add Images' : 'Add More Images'}
                    </Text>
                  </AnimatedPressable>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Product Video (Optional)</Text>
                <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 13 }}>
                  Add a video showcasing your product (max 5 minutes)
                </Text>
                
                {(productVideoUrl || newVideoUri) ? (
                  <View style={[styles.mediaPreview, { backgroundColor: colors.backgroundSecondary }]}>
                    <View style={styles.videoPlaceholder}>
                      <IconSymbol name="play.circle.fill" size={48} color={colors.primary} />
                      <Text style={[styles.mediaLabel, { color: colors.text }]}>
                        {newVideoUri ? 'New Video Selected' : 'Video Attached'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.removeMediaButton, { backgroundColor: colors.error }]}
                      onPress={handleRemoveVideo}>
                      <IconSymbol name="xmark" size={14} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <AnimatedPressable
                    style={[styles.mediaPickerButton, { borderColor: colors.primary, backgroundColor: colors.backgroundSecondary }]}
                    onPress={handlePickVideo}
                    scaleValue={0.98}>
                    <IconSymbol name="video.fill" size={24} color={colors.primary} />
                    <Text style={[styles.mediaPickerText, { color: colors.primary }]}>
                      {productVideoUrl ? 'Change Video' : 'Add Video'}
                    </Text>
                  </AnimatedPressable>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Audio Description (Optional)</Text>
                <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 13 }}>
                  Add an audio description of your product
                </Text>
                
                {(productAudioUrl || newAudioUri) ? (
                  <View style={[styles.mediaPreview, { backgroundColor: colors.backgroundSecondary }]}>
                    <View style={styles.audioPlaceholder}>
                      <IconSymbol name="waveform" size={48} color={colors.primary} />
                      <Text style={[styles.mediaLabel, { color: colors.text }]}>
                        {newAudioUri ? 'New Audio Selected' : 'Audio Attached'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.removeMediaButton, { backgroundColor: colors.error }]}
                      onPress={handleRemoveAudio}>
                      <IconSymbol name="xmark" size={14} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <AnimatedPressable
                    style={[styles.mediaPickerButton, { borderColor: colors.primary, backgroundColor: colors.backgroundSecondary }]}
                    onPress={handlePickAudio}
                    scaleValue={0.98}>
                    <IconSymbol name="music.note" size={24} color={colors.primary} />
                    <Text style={[styles.mediaPickerText, { color: colors.primary }]}>
                      {productAudioUrl ? 'Change Audio' : 'Add Audio'}
                    </Text>
                  </AnimatedPressable>
                )}
              </View>

              {uploadingMedia && (
                <View style={styles.uploadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Uploading media...</Text>
                </View>
              )}
            </View>
          ) : (
            /* View Mode - Display all product information */
            <View style={styles.detailsContainer}>
              {/* Simplified Title, Price, Description */}
              <View style={styles.viewSection}>
                <Text style={[styles.viewTitle, { color: colors.text }]}>{product.name}</Text>
                <View style={styles.priceRow}>
                  <Text style={[styles.viewPrice, { color: colors.primary }]}>₦{product.price.toLocaleString()}</Text>
                  {product.compareAtPrice && product.compareAtPrice > product.price && (
                    <Text style={[styles.comparePrice, { color: colors.textSecondary }]}>
                      ₦{product.compareAtPrice.toLocaleString()}
                    </Text>
                  )}
                </View>
                {product.description && (
                  <Text style={[styles.viewDesc, { color: colors.textSecondary }]}>{product.description}</Text>
                )}
              </View>

              {/* Compact Category, Status, Stock, SKU in one row */}
              <View style={styles.viewSection}>
                <View style={styles.infoRow}>
                  <View style={[styles.infoBadge, { backgroundColor: colors.backgroundSecondary }]}>
                    <IconSymbol name="tag.fill" size={14} color={colors.primary} />
                    <Text style={[styles.infoText, { color: colors.text }]}>
                      {product.category ? product.category.charAt(0).toUpperCase() + product.category.slice(1) : 'Uncategorized'}
                    </Text>
                  </View>
                  <View style={[styles.infoBadge, { 
                    backgroundColor: product.status === 'active' ? colors.success + '20' : 
                                     product.status === 'draft' ? colors.warning + '20' : 
                                     colors.error + '20' 
                  }]}>
                    <Text style={[styles.infoText, { 
                      color: product.status === 'active' ? colors.success : 
                             product.status === 'draft' ? colors.warning : 
                             colors.error 
                    }]}>
                      {product.status ? (product.status.charAt(0).toUpperCase() + product.status.slice(1)) : 'Draft'}
                    </Text>
                  </View>
                  <View style={[styles.infoBadge, { backgroundColor: colors.backgroundSecondary }]}>
                    <IconSymbol name="cube.box.fill" size={14} color={colors.primary} />
                    <Text style={[styles.infoText, { color: colors.text }]}>{product.stock || 0}</Text>
                  </View>
                  {product.sku && (
                    <View style={[styles.infoBadge, { backgroundColor: colors.backgroundSecondary }]}>
                      <IconSymbol name="tag.fill" size={14} color={colors.primary} />
                      <Text style={[styles.infoText, { color: colors.text }]}>{product.sku}</Text>
                    </View>
                  )}
                  {product.isFeatured && (
                    <View style={[styles.infoBadge, { backgroundColor: colors.primary + '20' }]}>
                      <IconSymbol name="star.fill" size={14} color={colors.primary} />
                      <Text style={[styles.infoText, { color: colors.primary }]}>Featured</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Category-Specific Fields */}
              {productCategory && (
                <View style={styles.viewSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Product Details</Text>
                  <View style={[styles.categoryFieldsContainer, { backgroundColor: colors.backgroundSecondary }]}>
                    <CategoryFields
                      category={productCategory}
                      formData={formData}
                      onChange={handleCategoryFieldChange}
                      errors={categoryErrors}
                      readOnly={true}
                    />
                  </View>
                </View>
              )}

              {/* All Images - Skip first one as it's in hero */}
              {galleryImages.length > 0 && (
                <View style={styles.viewSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>More Images</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
                    {galleryImages.map((url, index) => (
                      <TouchableOpacity
                        key={index}
                        activeOpacity={0.9}
                        onPress={() => {
                          setSelectedImageIndex(index + 1); // +1 because first image is index 0
                          setShowImageModal(true);
                          haptics.light();
                        }}
                        style={[styles.viewImageContainer, { backgroundColor: colors.backgroundSecondary }]}>
                        <SafeImage uri={url} style={styles.viewImage} placeholderIcon="photo" placeholderSize={32} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Video */}
              {productVideoUrl && (
                <View style={styles.viewSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Product Video</Text>
                  <View style={[styles.mediaPreview, { backgroundColor: colors.backgroundSecondary }]}>
                    <View style={styles.videoPlaceholder}>
                      <IconSymbol name="video.fill" size={48} color={colors.primary} />
                      <Text style={[styles.mediaLabel, { color: colors.text }]}>Video Available</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Audio */}
              {productAudioUrl && (
                <View style={styles.viewSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Audio Description</Text>
                  <View style={[styles.mediaPreview, { backgroundColor: colors.backgroundSecondary }]}>
                    <View style={styles.audioPlaceholder}>
                      <IconSymbol name="music.note" size={48} color={colors.primary} />
                      <Text style={[styles.mediaLabel, { color: colors.text }]}>Audio Available</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Delivery Settings */}
              {(product.deliveryFeePaidBy || product.deliveryMethods) && (
                <View style={styles.viewSection}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Delivery Settings</Text>
                  <View style={[styles.deliveryCard, { backgroundColor: colors.backgroundSecondary }]}>
                    {product.deliveryFeePaidBy && (
                      <View style={styles.deliveryRow}>
                        <Text style={[styles.deliveryLabel, { color: colors.textSecondary }]}>Delivery Fee Paid By:</Text>
                        <Text style={[styles.deliveryValue, { color: colors.text }]}>
                          {product.deliveryFeePaidBy === 'seller' ? 'Seller' : 'Buyer'}
                        </Text>
                      </View>
                    )}
                    {product.deliveryMethods && (
                      <View style={styles.deliveryRow}>
                        <Text style={[styles.deliveryLabel, { color: colors.textSecondary }]}>Available Methods:</Text>
                        <View style={styles.deliveryMethods}>
                          {product.deliveryMethods.localDispatch?.enabled && (
                            <View style={[styles.methodBadge, { backgroundColor: colors.primary + '20' }]}>
                              <Text style={[styles.methodText, { color: colors.primary }]}>Local Dispatch</Text>
                            </View>
                          )}
                          {product.deliveryMethods.waybill?.enabled && (
                            <View style={[styles.methodBadge, { backgroundColor: colors.primary + '20' }]}>
                              <Text style={[styles.methodText, { color: colors.primary }]}>Waybill</Text>
                            </View>
                          )}
                          {product.deliveryMethods.pickup?.enabled && (
                            <View style={[styles.methodBadge, { backgroundColor: colors.primary + '20' }]}>
                              <Text style={[styles.methodText, { color: colors.primary }]}>Pickup</Text>
                              {product.deliveryMethods.pickup.landmark && (
                                <Text style={[styles.landmarkText, { color: colors.textSecondary }]}>
                                  ({product.deliveryMethods.pickup.landmark})
                                </Text>
                              )}
                            </View>
                          )}
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Image Viewer Modal */}
      <Modal
        visible={showImageModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowImageModal(false)}>
        <Pressable 
          style={styles.imageModalOverlay}
          onPress={() => {
            haptics.light();
            setShowImageModal(false);
          }}>
          <View style={styles.imageModalContainer}>
            <SafeImage
              uri={allImages[selectedImageIndex] || ''}
              style={styles.expandedImage}
              placeholderIcon="photo"
              placeholderSize={64}
            />
            {allImages.length > 1 && (
              <View style={styles.imageModalIndicators}>
                {allImages.map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.imageIndicator,
                      { backgroundColor: index === selectedImageIndex ? colors.primary : 'rgba(255,255,255,0.3)' }
                    ]}
                  />
                ))}
              </View>
            )}
            <TouchableOpacity
              style={styles.imageModalClose}
              onPress={() => {
                haptics.light();
                setShowImageModal(false);
              }}>
              <IconSymbol name="xmark.circle.fill" size={32} color="#FFFFFF" />
            </TouchableOpacity>
            {allImages.length > 1 && (
              <>
                {selectedImageIndex > 0 && (
                  <TouchableOpacity
                    style={[styles.imageModalNav, styles.imageModalNavLeft]}
                    onPress={() => {
                      haptics.selection();
                      setSelectedImageIndex(selectedImageIndex - 1);
                    }}>
                    <IconSymbol name="chevron.left" size={28} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
                {selectedImageIndex < allImages.length - 1 && (
                  <TouchableOpacity
                    style={[styles.imageModalNav, styles.imageModalNavRight]}
                    onPress={() => {
                      haptics.selection();
                      setSelectedImageIndex(selectedImageIndex + 1);
                    }}>
                    <IconSymbol name="chevron.right" size={28} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: any, insets: any) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  
  // Hero Island Styles
  heroSection: { height: 380, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '100%', justifyContent: 'flex-start' },
  
  fixedHeader: { 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    right: 0, 
    zIndex: 1000 
  },
  floatingHeaderContainer: { 
    paddingHorizontal: 20, 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 10,
    pointerEvents: 'box-none'
  },
  heroImageTouchable: {
    width: '100%',
    height: '100%'
  },
  nameIsland: { 
    flex: 1, 
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    borderRadius: 22,
    ...premiumShadow
  },
  islandLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  islandTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  headerButtonIsland: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    justifyContent: 'center', 
    alignItems: 'center',
    ...premiumShadow
  },

  contentSection: { 
    flex: 1, 
    marginTop: -30, 
    borderTopLeftRadius: 32, 
    borderTopRightRadius: 32, 
    padding: 24 
  },
  editForm: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', marginLeft: 4 },
  input: { height: 52, borderRadius: 16, paddingHorizontal: 16, fontSize: 16, borderWidth: 1 },
  textArea: { height: 120, paddingTop: 16, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center' },
  statusButtons: { flexDirection: 'row', gap: 10 },
  statusButton: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  statusButtonText: { fontSize: 13, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 20 },
  switchContent: { flex: 1 },
  switchLabel: { fontSize: 15, fontWeight: '700' },
  switchHint: { fontSize: 12, marginTop: 2 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  mediaPreview: { width: 80, height: 80, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  previewImage: { width: '100%', height: '100%' },
  removeMediaButton: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  mediaPickerButton: { height: 56, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  mediaPickerText: { fontSize: 15, fontWeight: '700' },
  uploadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  detailsContainer: { gap: 24 },
  viewSection: { gap: 12 },
  viewTitle: { fontSize: 24, fontWeight: '900', marginBottom: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  viewPrice: { fontSize: 20, fontWeight: '800' },
  comparePrice: { fontSize: 16, textDecorationLine: 'line-through' },
  viewDesc: { fontSize: 16, lineHeight: 24 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  infoText: { fontSize: 13, fontWeight: '700' },
  infoGrid: { flexDirection: 'row', gap: 12 },
  infoCard: { flex: 1, padding: 16, borderRadius: 16, alignItems: 'center', gap: 8 },
  infoLabel: { fontSize: 12, fontWeight: '600' },
  infoValue: { fontSize: 18, fontWeight: '800' },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  categoryFieldsContainer: { padding: 16, borderRadius: 16 },
  imageScroll: { marginHorizontal: -24 },
  viewImageContainer: { width: 120, height: 120, borderRadius: 16, overflow: 'hidden', marginRight: 12 },
  viewImage: { width: '100%', height: '100%' },
  videoPlaceholder: { width: '100%', height: 120, justifyContent: 'center', alignItems: 'center', gap: 8 },
  audioPlaceholder: { width: '100%', height: 120, justifyContent: 'center', alignItems: 'center', gap: 8 },
  mediaLabel: { fontSize: 14, fontWeight: '600' },
  deliveryCard: { padding: 16, borderRadius: 16, gap: 12 },
  deliveryRow: { gap: 8 },
  deliveryLabel: { fontSize: 13, fontWeight: '700' },
  deliveryValue: { fontSize: 15, fontWeight: '600' },
  deliveryMethods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  methodText: { fontSize: 13, fontWeight: '700' },
  landmarkText: { fontSize: 11, marginTop: 2 },
  
  // Image Modal Styles
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  imageModalContainer: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative'
  },
  expandedImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    resizeMode: 'contain'
  },
  imageModalClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 101
  },
  imageModalNav: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -22 }],
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 101
  },
  imageModalNavLeft: {
    left: 20
  },
  imageModalNavRight: {
    right: 20
  },
  imageModalIndicators: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
    gap: 8,
    zIndex: 101
  },
  imageIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4
  }
});
