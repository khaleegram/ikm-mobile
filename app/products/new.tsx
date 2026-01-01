// Professional multi-step product creation screen
import { AnimatedPressable } from '@/components/animated-pressable';
import { CategoryFields } from '@/components/products/category-fields/CategoryFields';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { productApi } from '@/lib/api/product-category-api';
import { useUser } from '@/lib/firebase/auth/use-user';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { pickAudio, pickMultipleImages, pickVideo } from '@/lib/utils/image-upload';
import { ProductCategory } from '@/types';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
type Step = 1 | 2 | 3;

export default function NewProductScreen() {
  const { user } = useUser();
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const lightBrown = '#A67C52';
  
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    compareAtPrice: '',
    stock: '',
    sku: '',
    status: 'draft' as 'active' | 'draft' | 'inactive',
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
  const [selectedImageUris, setSelectedImageUris] = useState<string[]>([]);
  const [selectedVideoUri, setSelectedVideoUri] = useState<string | null>(null);
  const [selectedAudioUri, setSelectedAudioUri] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  
  const styles = createStyles(colors, insets, lightBrown);

  const categories: { value: ProductCategory; label: string }[] = [
    { value: 'fragrance', label: 'Fragrance & Perfumes' },
    { value: 'fashion', label: 'Fashion & Abayas' },
    { value: 'snacks', label: 'Snacks & Food' },
    { value: 'materials', label: 'Materials & Fabrics' },
    { value: 'skincare', label: 'Skincare & Cosmetics' },
    { value: 'haircare', label: 'Hair Care Products' },
    { value: 'islamic', label: 'Islamic Products' },
    { value: 'electronics', label: 'Electronics' },
  ];

  const steps = [
    { number: 1, title: 'Basics' },
    { number: 2, title: 'Pricing' },
    { number: 3, title: 'Delivery' },
  ];

  const handlePickImages = async () => {
    try {
      const imageUris = await pickMultipleImages(10);
      if (imageUris.length > 0) {
        setSelectedImageUris([...selectedImageUris, ...imageUris].slice(0, 10));
      }
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to pick images', 'error');
    }
  };

  const handleRemoveImage = (index: number) => {
    setSelectedImageUris(selectedImageUris.filter((_, i) => i !== index));
  };

  const handlePickVideo = async () => {
    try {
      const videoUri = await pickVideo();
      if (videoUri) setSelectedVideoUri(videoUri);
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to pick video', 'error');
    }
  };

  const handleRemoveVideo = () => {
    setSelectedVideoUri(null);
  };

  const handlePickAudio = async () => {
    try {
      const audioUri = await pickAudio();
      if (audioUri) setSelectedAudioUri(audioUri);
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to pick audio', 'error');
    }
  };

  const handleRemoveAudio = () => {
    setSelectedAudioUri(null);
  };

  const validateCategoryFields = (): boolean => {
    if (!category) return false;
    
    const errors: Record<string, string> = {};

    switch (category) {
      case 'fragrance':
        if (!formData.volume?.trim()) errors.volume = 'Volume is required';
        if (!formData.fragranceType?.trim()) errors.fragranceType = 'Fragrance type is required';
        if (!formData.container?.trim()) errors.container = 'Container is required';
        break;
      case 'fashion':
        if (!formData.sizeType) errors.sizeType = 'Size type is required';
        if (formData.sizeType === 'standard' && !formData.standardSize?.trim()) {
          errors.standardSize = 'Standard size is required';
        }
        if (formData.sizeType === 'abaya-length' && !formData.abayaLength?.trim()) {
          errors.abayaLength = 'Abaya length is required';
        }
        if (!formData.setIncludes?.trim()) errors.setIncludes = 'Set includes is required';
        if (!formData.material?.trim()) errors.material = 'Material is required';
        break;
      case 'snacks':
        if (!formData.packaging?.trim()) errors.packaging = 'Packaging is required';
        if (!formData.quantity || parseInt(formData.quantity, 10) <= 0) {
          errors.quantity = 'Quantity must be greater than 0';
        }
        if (!formData.taste?.trim()) errors.taste = 'Taste is required';
        break;
      case 'materials':
        if (!formData.materialType?.trim()) errors.materialType = 'Material type is required';
        if (formData.materialType === 'custom' && !formData.customMaterialType?.trim()) {
          errors.customMaterialType = 'Custom material type is required';
        }
        if (!formData.fabricLength?.trim()) errors.fabricLength = 'Fabric length is required';
        if (!formData.quality?.trim()) errors.quality = 'Quality is required';
        break;
      case 'skincare':
        if (!formData.skincareBrand?.trim()) errors.skincareBrand = 'Brand is required';
        if (!formData.skincareType?.trim()) errors.skincareType = 'Product type is required';
        if (!formData.skincareSize?.trim()) errors.skincareSize = 'Size is required';
        break;
      case 'haircare':
        if (!formData.haircareType?.trim()) errors.haircareType = 'Type is required';
        if (!formData.haircareBrand?.trim()) errors.haircareBrand = 'Brand is required';
        if (!formData.haircareSize?.trim()) errors.haircareSize = 'Size is required';
        if (formData.haircareType === 'package-deal' && (!formData.haircarePackageItems || formData.haircarePackageItems.length === 0)) {
          errors.haircarePackageItems = 'At least one package item is required';
        }
        break;
      case 'islamic':
        if (!formData.islamicType?.trim()) errors.islamicType = 'Product type is required';
        if (!formData.islamicSize?.trim()) errors.islamicSize = 'Size is required';
        if (!formData.islamicMaterial?.trim()) errors.islamicMaterial = 'Material is required';
        break;
      case 'electronics':
        if (!formData.brand?.trim()) errors.brand = 'Brand is required';
        if (!formData.model?.trim()) errors.model = 'Model is required';
        break;
    }

    setCategoryErrors(errors);
    if (Object.keys(errors).length > 0) {
      haptics.warning();
      showToast(Object.values(errors)[0], 'warning');
      return false;
    }
    return true;
  };

  const validateStep = (step: Step): boolean => {
    if (step === 1) {
      if (!formData.name.trim()) {
        haptics.warning();
        showToast('Product name is required', 'warning');
        return false;
      }
      if (!category) {
        haptics.warning();
        showToast('Please select a category', 'warning');
        return false;
      }
      return validateCategoryFields();
    }
    if (step === 2) {
      if (!formData.price.trim() || !formData.stock.trim()) {
        haptics.warning();
        showToast('Price and stock are required', 'warning');
        return false;
      }
      if (isNaN(parseFloat(formData.price)) || parseFloat(formData.price) <= 0) {
        haptics.warning();
        showToast('Price must be a valid number greater than 0', 'warning');
        return false;
      }
      if (isNaN(parseInt(formData.stock, 10)) || parseInt(formData.stock, 10) < 0) {
        haptics.warning();
        showToast('Stock must be a valid number', 'warning');
        return false;
      }
      return true;
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    haptics.selection();
    if (currentStep < 3) setCurrentStep((currentStep + 1) as Step);
    else handleCreate();
  };

  const handleBack = () => {
    haptics.light();
    if (currentStep > 1) setCurrentStep((currentStep - 1) as Step);
    else router.back();
  };

  const handleCreate = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in');
      return;
    }

    if (!validateStep(1) || !validateStep(2)) {
      return;
    }

    setSaving(true);
    setUploadingMedia(true);
    try {
      if (!category) {
        haptics.warning();
        showToast('Please select a category', 'warning');
        setSaving(false);
        setUploadingMedia(false);
        return;
      }

      // Convert first image to base64 and send to cloud function
      // Note: Cloud function only supports single imageBase64 (legacy)
      // TODO: Backend needs to support imageBase64Array for multiple images
      // Video and audio cannot be sent as base64 - backend needs to support this
      let imageBase64: string | undefined;

      if (selectedImageUris.length > 0) {
        try {
          imageBase64 = await convertImageToBase64(selectedImageUris[0]);
        } catch (error: any) {
          console.error('Error converting image to base64:', error);
          showToast('Failed to process image', 'error');
        }
      }

      // Note: Video and audio are skipped for now because:
      // 1. Cloud function expects URLs, not base64
      // 2. Mobile app cannot upload directly due to storage rules
      // TODO: Backend needs to support videoBase64 and audioBase64

      const productData: any = {
        name: formData.name,
        description: formData.description || undefined,
        price: parseFloat(formData.price),
        compareAtPrice: formData.compareAtPrice ? parseFloat(formData.compareAtPrice) : undefined,
        stock: parseInt(formData.stock, 10),
        status: 'active',
        sku: formData.sku || undefined,
        category: category,
        imageBase64, // Send first image as base64 (cloud function will upload to storage)
        // Note: imageUrls will be set by cloud function after upload
        videoUrl: undefined, // Not supported - needs backend update for base64
        audioDescription: undefined, // Not supported - needs backend update for base64
        deliveryFeePaidBy: formData.deliveryFeePaidBy,
        deliveryMethods: formData.deliveryMethods,
      };

      // Add category-specific fields
      if (category === 'fragrance') {
        productData.volume = formData.volume || undefined;
        productData.fragranceType = formData.fragranceType || undefined;
        productData.container = formData.container || undefined;
      } else if (category === 'fashion') {
        productData.sizeType = formData.sizeType || undefined;
        productData.abayaLength = formData.abayaLength || undefined;
        productData.standardSize = formData.standardSize || undefined;
        productData.setIncludes = formData.setIncludes || undefined;
        productData.material = formData.material || undefined;
      } else if (category === 'snacks') {
        productData.packaging = formData.packaging || undefined;
        productData.quantity = formData.quantity ? parseInt(formData.quantity, 10) : undefined;
        productData.taste = formData.taste || undefined;
      } else if (category === 'materials') {
        productData.materialType = formData.materialType || undefined;
        productData.customMaterialType = formData.customMaterialType || undefined;
        productData.fabricLength = formData.fabricLength || undefined;
        productData.quality = formData.quality || undefined;
      } else if (category === 'skincare') {
        productData.skincareBrand = formData.skincareBrand || undefined;
        productData.skincareType = formData.skincareType || undefined;
        productData.skincareSize = formData.skincareSize || undefined;
      } else if (category === 'haircare') {
        productData.haircareType = formData.haircareType || undefined;
        productData.haircareBrand = formData.haircareBrand || undefined;
        productData.haircareSize = formData.haircareSize || undefined;
        productData.haircarePackageItems = formData.haircarePackageItems.length > 0 ? formData.haircarePackageItems : undefined;
      } else if (category === 'islamic') {
        productData.islamicType = formData.islamicType || undefined;
        productData.islamicSize = formData.islamicSize || undefined;
        productData.islamicMaterial = formData.islamicMaterial || undefined;
      } else if (category === 'electronics') {
        productData.brand = formData.brand || undefined;
        productData.model = formData.model || undefined;
      }

      const product = await productApi.create(productData);
      
      haptics.success();
      showToast('Product created successfully', 'success');
      setTimeout(() => {
        router.replace(`../products/${product.id}` as any);
      }, 500);
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to create product', 'error');
    } finally {
      setSaving(false);
      setUploadingMedia(false);
    }
  };

  const handleCategoryFieldChange = (field: string, value: any) => {
    setFormData((prevFormData) => ({ ...prevFormData, [field]: value }));
    // Clear error for this field when user starts typing
    setCategoryErrors((prevErrors) => {
      if (prevErrors[field]) {
        const updated = { ...prevErrors };
        delete updated[field];
        return updated;
      }
      return prevErrors;
    });
  };

  const clearCategoryFields = () => {
    setFormData((prev) => ({
      ...prev,
      volume: '',
      fragranceType: '',
      container: '',
      sizeType: '' as any,
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
      haircarePackageItems: [],
      islamicType: '',
      islamicSize: '',
      islamicMaterial: '',
      brand: '',
      model: '',
    }));
    setCategoryErrors({});
  };

  const renderStepIndicator = () => (
    <View style={styles.indicatorWrapper}>
      {steps.map((step, idx) => (
        <View key={step.number} style={styles.stepItem}>
          <View style={[styles.stepDot, { backgroundColor: currentStep >= step.number ? lightBrown : colors.border }]} />
          <Text style={[styles.stepLabel, { color: currentStep >= step.number ? colors.text : colors.textSecondary }]}>
            {step.title}
          </Text>
          {idx < 2 && <View style={[styles.stepLine, { backgroundColor: colors.border }]} />}
        </View>
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* 1. FLOATING ISLAND HEADER */}
      <View style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={styles.iconIsland} onPress={handleBack}>
          <IconSymbol name="chevron.left" size={20} color={colors.text} />
        </TouchableOpacity>
        
        <View style={styles.nameIsland}>
          <Text style={styles.islandLabel}>STEP {currentStep} OF 3</Text>
          <Text style={styles.islandTitle}>New Product</Text>
        </View>

        <TouchableOpacity style={styles.iconIsland} onPress={() => setShowCategoryPicker(true)}>
          <IconSymbol name="list.bullet" size={20} color={lightBrown} />
        </TouchableOpacity>
      </View>

      {renderStepIndicator()}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {currentStep === 1 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Basic Information</Text>
              
              <TouchableOpacity 
                style={styles.inputIsland} 
                onPress={() => setShowCategoryPicker(true)}>
                <Text style={[styles.pickerText, { color: category ? colors.text : colors.textSecondary }]}>
                  {category ? categories.find(c => c.value === category)?.label : 'Select Category'}
                </Text>
                <IconSymbol name="chevron.down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>

              <View style={styles.inputIsland}>
                <TextInput
                  placeholder="Product Name"
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.input, { color: colors.text }]}
                  value={formData.name}
                  onChangeText={(t) => setFormData({...formData, name: t})}
                />
              </View>

              <View style={[styles.inputIsland, { height: 120, alignItems: 'flex-start', paddingTop: 15 }]}>
                <TextInput
                  placeholder="Description..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  style={[styles.input, { color: colors.text }]}
                  value={formData.description}
                  onChangeText={(t) => setFormData({...formData, description: t})}
                />
              </View>

              {category && (
                <View style={{ marginTop: 10 }}>
                  <CategoryFields
                    category={category}
                    formData={formData}
                    onChange={handleCategoryFieldChange}
                    errors={categoryErrors}
                  />
                </View>
              )}

              <Text style={styles.sectionTitle}>Media Gallery</Text>
              <View style={styles.mediaGrid}>
                {selectedImageUris.map((uri, i) => (
                  <View key={i} style={styles.mediaCard}>
                    <Image source={{ uri }} style={styles.cardImage} />
                    <TouchableOpacity style={styles.removeBadge} onPress={() => handleRemoveImage(i)}>
                      <IconSymbol name="xmark" size={10} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                {selectedImageUris.length < 10 && (
                  <TouchableOpacity style={[styles.mediaCard, styles.addMediaCard]} onPress={handlePickImages}>
                    <IconSymbol name="plus.circle.fill" size={32} color={lightBrown} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Product Video */}
              <Text style={styles.sectionTitle}>Product Video (Optional)</Text>
              {selectedVideoUri ? (
                <View style={[styles.mediaPreview, { backgroundColor: colors.card, marginBottom: 12 }]}>
                  <View style={styles.videoPlaceholder}>
                    <IconSymbol name="play.circle.fill" size={48} color={lightBrown} />
                    <Text style={[styles.mediaLabel, { color: colors.text }]}>Video Selected</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.removeMediaButton, { backgroundColor: '#FF4444' }]}
                    onPress={handleRemoveVideo}>
                    <IconSymbol name="xmark" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity
                style={[styles.mediaPickerButton, { borderColor: lightBrown, backgroundColor: colors.card }]}
                onPress={handlePickVideo}>
                <IconSymbol name="video.fill" size={24} color={lightBrown} />
                <Text style={[styles.mediaPickerText, { color: lightBrown }]}>
                  {selectedVideoUri ? 'Change Video' : 'Add Video'}
                </Text>
              </TouchableOpacity>

              {/* Audio Description */}
              <Text style={styles.sectionTitle}>Audio Description (Optional)</Text>
              {selectedAudioUri ? (
                <View style={[styles.mediaPreview, { backgroundColor: colors.card, marginBottom: 12 }]}>
                  <View style={styles.audioPlaceholder}>
                    <IconSymbol name="waveform" size={48} color={lightBrown} />
                    <Text style={[styles.mediaLabel, { color: colors.text }]}>Audio Selected</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.removeMediaButton, { backgroundColor: '#FF4444' }]}
                    onPress={handleRemoveAudio}>
                    <IconSymbol name="xmark" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity
                style={[styles.mediaPickerButton, { borderColor: lightBrown, backgroundColor: colors.card }]}
                onPress={handlePickAudio}>
                <IconSymbol name="music.note" size={24} color={lightBrown} />
                <Text style={[styles.mediaPickerText, { color: lightBrown }]}>
                  {selectedAudioUri ? 'Change Audio' : 'Add Audio Description'}
                </Text>
              </TouchableOpacity>

              {uploadingMedia && (
                <View style={styles.uploadingContainer}>
                  <ActivityIndicator size="small" color={lightBrown} />
                  <Text style={[styles.uploadingText, { color: colors.textSecondary }]}>Uploading media...</Text>
                </View>
              )}
            </View>
          )}

          {currentStep === 2 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Pricing & Stock</Text>
              
              <View style={styles.priceRow}>
                <View style={[styles.inputIsland, { flex: 1 }]}>
                  <Text style={styles.currency}>₦</Text>
                  <TextInput
                    placeholder="Price"
                    keyboardType="decimal-pad"
                    style={[styles.input, { color: colors.text }]}
                    value={formData.price}
                    onChangeText={(t) => setFormData({...formData, price: t.replace(/[^0-9.]/g, '')})}
                  />
                </View>
                <View style={[styles.inputIsland, { flex: 1 }]}>
                  <TextInput
                    placeholder="Stock"
                    keyboardType="numeric"
                    style={[styles.input, { color: colors.text }]}
                    value={formData.stock}
                    onChangeText={(t) => setFormData({...formData, stock: t.replace(/[^0-9]/g, '')})}
                  />
                </View>
              </View>

              <View style={styles.inputIsland}>
                <Text style={styles.currency}>₦</Text>
                <TextInput
                  placeholder="Compare At Price (Optional)"
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: colors.text }]}
                  value={formData.compareAtPrice}
                  onChangeText={(t) => setFormData({...formData, compareAtPrice: t.replace(/[^0-9.]/g, '')})}
                />
              </View>

              <View style={styles.inputIsland}>
                <TextInput
                  placeholder="SKU (Optional)"
                  style={[styles.input, { color: colors.text }]}
                  value={formData.sku}
                  onChangeText={(t) => setFormData({...formData, sku: t})}
                />
              </View>
            </View>
          )}

          {currentStep === 3 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Delivery Settings</Text>
              <Text style={styles.sectionTitle}>Delivery Settings</Text>
              
              {/* Delivery Fee Payment */}
              <View style={styles.islandCard}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Delivery Fee Paid By</Text>
                <View style={styles.radioGroup}>
                  <TouchableOpacity
                    style={styles.radioOption}
                    onPress={() => setFormData({ ...formData, deliveryFeePaidBy: 'buyer' })}>
                    <View style={[styles.radioCircle, { borderColor: lightBrown }]}>
                      {formData.deliveryFeePaidBy === 'buyer' && (
                        <View style={[styles.radioInner, { backgroundColor: lightBrown }]} />
                      )}
                    </View>
                    <Text style={[styles.radioLabel, { color: colors.text }]}>Buyer Pays</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.radioOption}
                    onPress={() => setFormData({ ...formData, deliveryFeePaidBy: 'seller' })}>
                    <View style={[styles.radioCircle, { borderColor: lightBrown }]}>
                      {formData.deliveryFeePaidBy === 'seller' && (
                        <View style={[styles.radioInner, { backgroundColor: lightBrown }]} />
                      )}
                    </View>
                    <Text style={[styles.radioLabel, { color: colors.text }]}>Seller Pays</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Delivery Methods */}
              <View style={styles.islandCard}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Available Delivery Methods</Text>
                
                {/* Local Dispatch */}
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() =>
                    setFormData({
                      ...formData,
                      deliveryMethods: {
                        ...formData.deliveryMethods,
                        localDispatch: { enabled: !formData.deliveryMethods.localDispatch.enabled },
                      },
                    })
                  }>
                  <View style={[styles.checkbox, { borderColor: lightBrown }]}>
                    {formData.deliveryMethods.localDispatch.enabled && (
                      <IconSymbol name="checkmark" size={16} color={lightBrown} />
                    )}
                  </View>
                  <View style={styles.checkboxContent}>
                    <Text style={[styles.checkboxLabel, { color: colors.text }]}>Within City (Local Dispatch)</Text>
                    <Text style={[styles.checkboxHint, { color: colors.textSecondary }]}>
                      Seller handles delivery directly within the city
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Waybill */}
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() =>
                    setFormData({
                      ...formData,
                      deliveryMethods: {
                        ...formData.deliveryMethods,
                        waybill: { enabled: !formData.deliveryMethods.waybill.enabled },
                      },
                    })
                  }>
                  <View style={[styles.checkbox, { borderColor: lightBrown }]}>
                    {formData.deliveryMethods.waybill.enabled && (
                      <IconSymbol name="checkmark" size={16} color={lightBrown} />
                    )}
                  </View>
                  <View style={styles.checkboxContent}>
                    <Text style={[styles.checkboxLabel, { color: colors.text }]}>Waybill (Inter-state)</Text>
                    <Text style={[styles.checkboxHint, { color: colors.textSecondary }]}>
                      Uses shipping zones for inter-state deliveries
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Pickup */}
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() =>
                    setFormData({
                      ...formData,
                      deliveryMethods: {
                        ...formData.deliveryMethods,
                        pickup: {
                          enabled: !formData.deliveryMethods.pickup.enabled,
                          landmark: formData.deliveryMethods.pickup.enabled ? '' : formData.deliveryMethods.pickup.landmark || '',
                        },
                      },
                    })
                  }>
                  <View style={[styles.checkbox, { borderColor: lightBrown }]}>
                    {formData.deliveryMethods.pickup.enabled && (
                      <IconSymbol name="checkmark" size={16} color={lightBrown} />
                    )}
                  </View>
                  <View style={styles.checkboxContent}>
                    <Text style={[styles.checkboxLabel, { color: colors.text }]}>Customer Pickup</Text>
                    <Text style={[styles.checkboxHint, { color: colors.textSecondary }]}>
                      Customer picks up from your location
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Pickup Landmark Input */}
                {formData.deliveryMethods.pickup.enabled && (
                  <View style={[styles.inputIsland, { marginTop: 12 }]}>
                    <TextInput
                      placeholder="Pickup Landmark (e.g., Near Central Mosque)"
                      placeholderTextColor={colors.textSecondary}
                      style={[styles.input, { color: colors.text }]}
                      value={formData.deliveryMethods.pickup.landmark || ''}
                      onChangeText={(text) =>
                        setFormData({
                          ...formData,
                          deliveryMethods: {
                            ...formData.deliveryMethods,
                            pickup: { ...formData.deliveryMethods.pickup, landmark: text },
                          },
                        })
                      }
                    />
                  </View>
                )}
              </View>
            </View>
          )}
          
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 2. FLOATING ACTION FOOTER */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
         <AnimatedPressable 
            style={[styles.nextButton, { backgroundColor: lightBrown, opacity: saving ? 0.6 : 1 }]} 
            onPress={handleNext}
            disabled={saving}
            scaleValue={0.95}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.nextButtonText}>{currentStep === 3 ? 'Create Product' : 'Continue'}</Text>
                <IconSymbol name="arrow.right" size={18} color="#fff" />
              </>
            )}
         </AnimatedPressable>
      </View>

      {/* CATEGORY MODAL */}
      <Modal visible={showCategoryPicker} transparent animationType="slide" onRequestClose={() => setShowCategoryPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowCategoryPicker(false)}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.card, paddingBottom: insets.bottom + 25 }]} onPress={(e) => e.stopPropagation()}>
             {categories.map(cat => (
               <TouchableOpacity 
                 key={cat.value} 
                 style={styles.modalItem} 
                 onPress={() => {
                   haptics.selection();
                   setCategory(cat.value);
                   clearCategoryFields();
                   setShowCategoryPicker(false);
                 }}>
                 <Text style={{ color: colors.text, fontWeight: '600' }}>{cat.label}</Text>
               </TouchableOpacity>
             ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const createStyles = (colors: any, insets: any, themeBrown: string) => StyleSheet.create({
  container: { flex: 1 },
  floatingHeaderContainer: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameIsland: { flex: 1, backgroundColor: themeBrown, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 22, ...premiumShadow },
  iconIsland: { backgroundColor: colors.card, width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  islandLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800' },
  islandTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  indicatorWrapper: { flexDirection: 'row', paddingHorizontal: 30, marginTop: 20, justifyContent: 'space-between', alignItems: 'center' },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepLabel: { fontSize: 12, fontWeight: '700' },
  stepLine: { height: 1, width: 20, marginLeft: 10 },
  scrollContent: { padding: 20, paddingBottom: 120 },
  formSection: { gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 5, marginTop: 10 },
  inputIsland: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 16, height: 56, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  input: { flex: 1, fontSize: 15, fontWeight: '600' },
  pickerText: { flex: 1, fontSize: 15, fontWeight: '600' },
  currency: { marginRight: 8, fontSize: 16, fontWeight: '800', color: themeBrown },
  priceRow: { flexDirection: 'row', gap: 12 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  mediaCard: { width: (width - 64) / 3, aspectRatio: 1, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  addMediaCard: { borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  cardImage: { width: '100%', height: '100%' },
  removeBadge: { position: 'absolute', top: 5, right: 5, backgroundColor: '#FF4444', width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  mediaPickerButton: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
  },
  mediaPickerText: {
    fontSize: 15,
    fontWeight: '700',
  },
  mediaPreview: {
    width: '100%',
    height: 120,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 12,
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  audioPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  mediaLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  removeMediaButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  uploadingText: {
    fontSize: 14,
  },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 },
  nextButton: { height: 60, borderRadius: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...premiumShadow },
  nextButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { padding: 25, paddingTop: 25, borderTopLeftRadius: 30, borderTopRightRadius: 30, maxHeight: '80%' },
  modalItem: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  islandCard: { backgroundColor: colors.card, borderRadius: 25, padding: 20, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  radioGroup: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  radioLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxContent: {
    flex: 1,
  },
  checkboxLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  checkboxHint: {
    fontSize: 13,
  },
});
