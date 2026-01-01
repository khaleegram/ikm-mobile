// Store settings screen with organized categories
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useStore } from '@/lib/firebase/firestore/stores';
import { userApi } from '@/lib/api/user';
import { pickImage, uploadImage } from '@/lib/utils/image-upload';
import { Image } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';

type Category = 'personal' | 'store' | 'location' | 'policies' | 'social' | 'hours' | 'contact' | 'payout';

export default function SettingsScreen() {
  const { user, signOut } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const { store, loading: storeLoading } = useStore(user?.uid || null);
  const { colors } = useTheme();
  const [saving, setSaving] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<Category | null>('personal');
  const [formData, setFormData] = useState({
    // Personal Info
    displayName: '',
    firstName: '',
    lastName: '',
    phone: '',
    whatsappNumber: '',
    // Store Basic Info
    storeName: '',
    storeDescription: '',
    storeLogoUrl: '',
    storeBannerUrl: '',
    businessType: '',
    // Location
    state: '',
    lga: '',
    city: '',
    address: '',
    // Policies
    returnPolicy: '',
    shippingPolicy: '',
    refundPolicy: '',
    privacyPolicy: '',
    // Social Media
    facebookUrl: '',
    instagramUrl: '',
    twitterUrl: '',
    tiktokUrl: '',
    // Store Hours
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: '',
    saturday: '',
    sunday: '',
    // Contact
    email: '',
    website: '',
    pickupAddress: '',
    // Payout Details
    bankName: '',
    bankCode: '',
    accountNumber: '',
    accountName: '',
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  useEffect(() => {
    if (profile || store) {
      setFormData({
        displayName: profile?.displayName || '',
        firstName: profile?.firstName || '',
        lastName: profile?.lastName || '',
        phone: store?.phone || profile?.phone || '',
        whatsappNumber: profile?.whatsappNumber || '',
        storeName: store?.storeName || profile?.storeName || '',
        storeDescription: store?.storeDescription || profile?.storeDescription || '',
        storeLogoUrl: store?.storeLogoUrl || profile?.storeLogoUrl || '',
        storeBannerUrl: store?.storeBannerUrl || profile?.storeBannerUrl || '',
        businessType: store?.businessType || profile?.businessType || '',
        state: store?.storeLocation?.state || profile?.storeLocation?.state || '',
        lga: store?.storeLocation?.lga || profile?.storeLocation?.lga || '',
        city: store?.storeLocation?.city || profile?.storeLocation?.city || '',
        address: store?.storeLocation?.address || profile?.storeLocation?.address || '',
        returnPolicy: store?.storePolicies?.returns || profile?.storePolicies?.returns || '',
        shippingPolicy: store?.storePolicies?.shipping || profile?.storePolicies?.shipping || '',
        refundPolicy: store?.storePolicies?.refunds || profile?.storePolicies?.refunds || '',
        privacyPolicy: store?.storePolicies?.privacy || profile?.storePolicies?.privacy || '',
        facebookUrl: store?.facebookUrl || '',
        instagramUrl: store?.instagramUrl || '',
        twitterUrl: store?.twitterUrl || '',
        tiktokUrl: store?.tiktokUrl || '',
        monday: store?.storeHours?.monday || '',
        tuesday: store?.storeHours?.tuesday || '',
        wednesday: store?.storeHours?.wednesday || '',
        thursday: store?.storeHours?.thursday || '',
        friday: store?.storeHours?.friday || '',
        saturday: store?.storeHours?.saturday || '',
        sunday: store?.storeHours?.sunday || '',
        email: store?.email || '',
        website: store?.website || '',
        pickupAddress: store?.pickupAddress || '',
        bankName: profile?.payoutDetails?.bankName || '',
        bankCode: profile?.payoutDetails?.bankCode || '',
        accountNumber: profile?.payoutDetails?.accountNumber || '',
        accountName: profile?.payoutDetails?.accountName || '',
      });
    }
  }, [profile, store]);

  const handleUploadLogo = async () => {
    if (!user) return;
    try {
      setUploadingLogo(true);
      const result = await pickImage();
      if (result && result.assets && result.assets.length > 0) {
        const uploadedUrl = await uploadImage(result.assets[0].uri, 'store_images', user.uid);
        setFormData((prev) => ({ ...prev, storeLogoUrl: uploadedUrl }));
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleUploadBanner = async () => {
    if (!user) return;
    try {
      setUploadingBanner(true);
      const result = await pickImage();
      if (result && result.assets && result.assets.length > 0) {
        const uploadedUrl = await uploadImage(result.assets[0].uri, 'store_images', user.uid);
        setFormData((prev) => ({ ...prev, storeBannerUrl: uploadedUrl }));
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to upload banner');
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await userApi.updateProfile(user.uid, {
        displayName: formData.displayName,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        whatsappNumber: formData.whatsappNumber,
        payoutDetails: formData.bankName && formData.accountNumber ? {
          bankName: formData.bankName,
          bankCode: formData.bankCode,
          accountNumber: formData.accountNumber,
          accountName: formData.accountName,
        } : undefined,
      });

      await userApi.updateStoreSettings(user.uid, {
        storeName: formData.storeName,
        storeDescription: formData.storeDescription,
        storeLogoUrl: formData.storeLogoUrl,
        storeBannerUrl: formData.storeBannerUrl,
        storeLocation: {
          state: formData.state,
          lga: formData.lga,
          city: formData.city,
          address: formData.address,
        },
        businessType: formData.businessType,
        storePolicies: {
          returns: formData.returnPolicy,
          shipping: formData.shippingPolicy,
          refunds: formData.refundPolicy,
          privacy: formData.privacyPolicy,
        },
        facebookUrl: formData.facebookUrl,
        instagramUrl: formData.instagramUrl,
        twitterUrl: formData.twitterUrl,
        tiktokUrl: formData.tiktokUrl,
        storeHours: {
          monday: formData.monday,
          tuesday: formData.tuesday,
          wednesday: formData.wednesday,
          thursday: formData.thursday,
          friday: formData.friday,
          saturday: formData.saturday,
          sunday: formData.sunday,
        },
        email: formData.email,
        phone: formData.phone,
        website: formData.website,
        pickupAddress: formData.pickupAddress,
      });
      Alert.alert('Success', 'Settings updated successfully');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              router.replace('/(auth)/login');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  const toggleCategory = (category: Category) => {
    setExpandedCategory(expandedCategory === category ? null : category);
  };

  const categories: Array<{ id: Category; title: string; icon: string }> = [
    { id: 'personal', title: 'Personal Information', icon: 'person.fill' },
    { id: 'store', title: 'Store Information', icon: 'storefront.fill' },
    { id: 'location', title: 'Location', icon: 'location.fill' },
    { id: 'policies', title: 'Store Policies', icon: 'doc.text.fill' },
    { id: 'social', title: 'Social Media', icon: 'link' },
    { id: 'hours', title: 'Store Hours', icon: 'clock.fill' },
    { id: 'contact', title: 'Contact Information', icon: 'phone.fill' },
    { id: 'payout', title: 'Payout Details', icon: 'dollarsign.circle.fill' },
  ];

  const loading = profileLoading || storeLoading;
  const styles = createStyles(colors);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Store Settings</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.saveButton, { color: colors.primary }]}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {categories.map((category) => (
          <View key={category.id} style={[styles.categoryCard, { backgroundColor: colors.card }]}>
            <TouchableOpacity
              style={styles.categoryHeader}
              onPress={() => toggleCategory(category.id)}
              activeOpacity={0.7}>
              <View style={styles.categoryHeaderLeft}>
                <View style={[styles.categoryIcon, { backgroundColor: `${colors.primary}20` }]}>
                  <IconSymbol name={category.icon as any} size={20} color={colors.primary} />
                </View>
                <Text style={[styles.categoryTitle, { color: colors.text }]}>{category.title}</Text>
              </View>
              <IconSymbol
                name={expandedCategory === category.id ? 'chevron.up' : 'chevron.down'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {expandedCategory === category.id && (
              <View style={styles.categoryContent}>
                {category.id === 'personal' && (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>Display Name</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.displayName}
                      onChangeText={(text) => setFormData({ ...formData, displayName: text })}
                      placeholder="Your display name"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>First Name</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.firstName}
                      onChangeText={(text) => setFormData({ ...formData, firstName: text })}
                      placeholder="First name"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Last Name</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.lastName}
                      onChangeText={(text) => setFormData({ ...formData, lastName: text })}
                      placeholder="Last name"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Phone Number</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.phone}
                      onChangeText={(text) => setFormData({ ...formData, phone: text })}
                      placeholder="Phone number"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="phone-pad"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>WhatsApp Number</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.whatsappNumber}
                      onChangeText={(text) => setFormData({ ...formData, whatsappNumber: text })}
                      placeholder="+234..."
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="phone-pad"
                    />
                  </>
                )}

                {category.id === 'store' && (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>Store Name *</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.storeName}
                      onChangeText={(text) => setFormData({ ...formData, storeName: text })}
                      placeholder="Your store name"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Store Description</Text>
                    <TextInput
                      style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.storeDescription}
                      onChangeText={(text) => setFormData({ ...formData, storeDescription: text })}
                      placeholder="Describe your store"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      numberOfLines={3}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Business Type</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.businessType}
                      onChangeText={(text) => setFormData({ ...formData, businessType: text })}
                      placeholder="e.g., Fashion, Electronics, Food"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Store Logo</Text>
                    {formData.storeLogoUrl ? (
                      <View style={styles.imageContainer}>
                        <Image source={{ uri: formData.storeLogoUrl }} style={styles.logoImage} />
                        <TouchableOpacity
                          style={[styles.changeImageButton, { backgroundColor: colors.primary }]}
                          onPress={handleUploadLogo}
                          disabled={uploadingLogo}>
                          {uploadingLogo ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.changeImageText}>Change Logo</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.uploadImageButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.cardBorder }]}
                        onPress={handleUploadLogo}
                        disabled={uploadingLogo}>
                        {uploadingLogo ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Text style={[styles.uploadImageText, { color: colors.text }]}>+ Upload Logo</Text>
                        )}
                      </TouchableOpacity>
                    )}
                    <Text style={[styles.label, { color: colors.text }]}>Store Banner</Text>
                    {formData.storeBannerUrl ? (
                      <View style={styles.imageContainer}>
                        <Image source={{ uri: formData.storeBannerUrl }} style={styles.bannerImage} />
                        <TouchableOpacity
                          style={[styles.changeImageButton, { backgroundColor: colors.primary }]}
                          onPress={handleUploadBanner}
                          disabled={uploadingBanner}>
                          {uploadingBanner ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.changeImageText}>Change Banner</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.uploadImageButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.cardBorder }]}
                        onPress={handleUploadBanner}
                        disabled={uploadingBanner}>
                        {uploadingBanner ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Text style={[styles.uploadImageText, { color: colors.text }]}>+ Upload Banner</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {category.id === 'location' && (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>State</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.state}
                      onChangeText={(text) => setFormData({ ...formData, state: text })}
                      placeholder="State"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>LGA</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.lga}
                      onChangeText={(text) => setFormData({ ...formData, lga: text })}
                      placeholder="Local Government Area"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>City</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.city}
                      onChangeText={(text) => setFormData({ ...formData, city: text })}
                      placeholder="City"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Full Address</Text>
                    <TextInput
                      style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.address}
                      onChangeText={(text) => setFormData({ ...formData, address: text })}
                      placeholder="Full address"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      numberOfLines={2}
                    />
                  </>
                )}

                {category.id === 'policies' && (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>Return Policy</Text>
                    <TextInput
                      style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.returnPolicy}
                      onChangeText={(text) => setFormData({ ...formData, returnPolicy: text })}
                      placeholder="Return policy details"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      numberOfLines={4}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Shipping Policy</Text>
                    <TextInput
                      style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.shippingPolicy}
                      onChangeText={(text) => setFormData({ ...formData, shippingPolicy: text })}
                      placeholder="Shipping policy details"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      numberOfLines={4}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Refund Policy</Text>
                    <TextInput
                      style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.refundPolicy}
                      onChangeText={(text) => setFormData({ ...formData, refundPolicy: text })}
                      placeholder="Refund policy details"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      numberOfLines={4}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Privacy Policy</Text>
                    <TextInput
                      style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.privacyPolicy}
                      onChangeText={(text) => setFormData({ ...formData, privacyPolicy: text })}
                      placeholder="Privacy policy details"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      numberOfLines={4}
                    />
                  </>
                )}

                {category.id === 'social' && (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>Facebook URL</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.facebookUrl}
                      onChangeText={(text) => setFormData({ ...formData, facebookUrl: text })}
                      placeholder="https://facebook.com/yourpage"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="url"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Instagram URL</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.instagramUrl}
                      onChangeText={(text) => setFormData({ ...formData, instagramUrl: text })}
                      placeholder="https://instagram.com/yourpage"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="url"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Twitter URL</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.twitterUrl}
                      onChangeText={(text) => setFormData({ ...formData, twitterUrl: text })}
                      placeholder="https://twitter.com/yourpage"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="url"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>TikTok URL</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.tiktokUrl}
                      onChangeText={(text) => setFormData({ ...formData, tiktokUrl: text })}
                      placeholder="https://tiktok.com/@yourpage"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="url"
                      autoCapitalize="none"
                    />
                  </>
                )}

                {category.id === 'hours' && (
                  <>
                    <Text style={[styles.hint, { color: colors.textSecondary }]}>
                      Enter hours for each day (e.g., "9:00 AM - 6:00 PM" or "Closed")
                    </Text>
                    {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => (
                      <View key={day}>
                        <Text style={[styles.label, { color: colors.text }]}>
                          {day.charAt(0).toUpperCase() + day.slice(1)}
                        </Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                          value={formData[day as keyof typeof formData] as string}
                          onChangeText={(text) => setFormData({ ...formData, [day]: text })}
                          placeholder={`${day.charAt(0).toUpperCase() + day.slice(1)} hours`}
                          placeholderTextColor={colors.textSecondary}
                        />
                      </View>
                    ))}
                  </>
                )}

                {category.id === 'contact' && (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>Email</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.email}
                      onChangeText={(text) => setFormData({ ...formData, email: text })}
                      placeholder="store@example.com"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Website</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.website}
                      onChangeText={(text) => setFormData({ ...formData, website: text })}
                      placeholder="https://yourwebsite.com"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="url"
                      autoCapitalize="none"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Pickup Address</Text>
                    <TextInput
                      style={[styles.input, styles.textArea, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.pickupAddress}
                      onChangeText={(text) => setFormData({ ...formData, pickupAddress: text })}
                      placeholder="Default pickup address for customers"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      numberOfLines={2}
                    />
                  </>
                )}

                {category.id === 'payout' && (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>Bank Name</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.bankName}
                      onChangeText={(text) => setFormData({ ...formData, bankName: text })}
                      placeholder="Bank name"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Bank Code</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.bankCode}
                      onChangeText={(text) => setFormData({ ...formData, bankCode: text })}
                      placeholder="Bank code"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Account Number</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.accountNumber}
                      onChangeText={(text) => setFormData({ ...formData, accountNumber: text })}
                      placeholder="Account number"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                    />
                    <Text style={[styles.label, { color: colors.text }]}>Account Name</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                      value={formData.accountName}
                      onChangeText={(text) => setFormData({ ...formData, accountName: text })}
                      placeholder="Account holder name"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </>
                )}
              </View>
            )}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: colors.error }]}
          onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      paddingTop: 60,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
      ...premiumShadow,
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      flex: 1,
      textAlign: 'center',
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    saveButton: {
      fontSize: 16,
      fontWeight: '600',
    },
    content: {
      padding: 20,
    },
    categoryCard: {
      borderRadius: 16,
      marginBottom: 16,
      overflow: 'hidden',
      ...premiumShadow,
    },
    categoryHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
    },
    categoryHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
    },
    categoryIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    categoryTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    categoryContent: {
      padding: 16,
      paddingTop: 0,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
      marginTop: 12,
    },
    input: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      fontSize: 16,
      marginBottom: 4,
    },
    textArea: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    hint: {
      fontSize: 12,
      marginBottom: 12,
    },
    imageContainer: {
      marginBottom: 12,
    },
    logoImage: {
      width: 100,
      height: 100,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: colors.backgroundSecondary,
    },
    bannerImage: {
      width: '100%',
      height: 150,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: colors.backgroundSecondary,
    },
    uploadImageButton: {
      borderWidth: 2,
      borderStyle: 'dashed',
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
      marginBottom: 12,
    },
    uploadImageText: {
      fontSize: 14,
      fontWeight: '600',
    },
    changeImageButton: {
      borderRadius: 8,
      padding: 10,
      alignItems: 'center',
    },
    changeImageText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    logoutButton: {
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 32,
      ...premiumShadow,
    },
    logoutButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });
