// Storefront customization screen
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState, useEffect } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useStore } from '@/lib/firebase/firestore/stores';
import { userApi } from '@/lib/api/user';
import { router } from 'expo-router';

export default function StorefrontScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const { store, loading: storeLoading } = useStore(user?.uid || null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    primaryColor: '',
    secondaryColor: '',
    fontFamily: '',
    storeLayout: 'grid' as 'grid' | 'list' | 'masonry',
  });
  const styles = createStyles(colors);

  useEffect(() => {
    if (store) {
      setFormData({
        primaryColor: store.primaryColor || '#000000',
        secondaryColor: store.secondaryColor || '#666666',
        fontFamily: store.fontFamily || 'Inter',
        storeLayout: store.storeLayout || 'grid',
      });
    }
  }, [store]);

  const handleSave = async () => {
    if (!user) return;

    // Validate hex colors
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (formData.primaryColor && !hexColorRegex.test(formData.primaryColor)) {
      Alert.alert('Error', 'Primary color must be a valid hex color (e.g., #FF5733)');
      return;
    }
    if (formData.secondaryColor && !hexColorRegex.test(formData.secondaryColor)) {
      Alert.alert('Error', 'Secondary color must be a valid hex color (e.g., #666666)');
      return;
    }

    setSaving(true);
    try {
      await userApi.updateStoreSettings(user.uid, {
        primaryColor: formData.primaryColor || undefined,
        secondaryColor: formData.secondaryColor || undefined,
        fontFamily: formData.fontFamily || undefined,
        storeLayout: formData.storeLayout,
      });
      Alert.alert('Success', 'Storefront settings saved successfully');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save storefront settings');
    } finally {
      setSaving(false);
    }
  };

  const fontOptions = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Playfair Display', 'Merriweather'];

  const layoutOptions: Array<{ value: 'grid' | 'list' | 'masonry'; label: string; icon: string }> = [
    { value: 'grid', label: 'Grid', icon: 'square.grid.2x2.fill' },
    { value: 'list', label: 'List', icon: 'list.bullet.fill' },
    { value: 'masonry', label: 'Masonry', icon: 'rectangle.split.3x1.fill' },
  ];

  if (storeLoading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Storefront Customization</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.saveButton, { color: colors.primary }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Color Customization */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Colors</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Customize your store's color scheme
          </Text>

          <View style={styles.colorRow}>
            <Text style={[styles.label, { color: colors.text }]}>Primary Color</Text>
            <View style={styles.colorInputRow}>
              <View style={[styles.colorPreview, { backgroundColor: formData.primaryColor || '#000000' }]} />
              <TextInput
                style={[styles.colorInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                value={formData.primaryColor}
                onChangeText={(text) => setFormData({ ...formData, primaryColor: text })}
                placeholder="#000000"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.colorRow}>
            <Text style={[styles.label, { color: colors.text }]}>Secondary Color</Text>
            <View style={styles.colorInputRow}>
              <View style={[styles.colorPreview, { backgroundColor: formData.secondaryColor || '#666666' }]} />
              <TextInput
                style={[styles.colorInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.cardBorder }]}
                value={formData.secondaryColor}
                onChangeText={(text) => setFormData({ ...formData, secondaryColor: text })}
                placeholder="#666666"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.colorPresets}>
            <Text style={[styles.presetLabel, { color: colors.textSecondary }]}>Quick Presets:</Text>
            <View style={styles.presetRow}>
              {[
                { primary: '#FF5733', secondary: '#C70039' },
                { primary: '#3498DB', secondary: '#2980B9' },
                { primary: '#27AE60', secondary: '#229954' },
                { primary: '#9B59B6', secondary: '#8E44AD' },
                { primary: '#E67E22', secondary: '#D35400' },
                { primary: '#1ABC9C', secondary: '#16A085' },
              ].map((preset, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.presetButton}
                  onPress={() => setFormData({ ...formData, primaryColor: preset.primary, secondaryColor: preset.secondary })}>
                  <View style={[styles.presetPrimary, { backgroundColor: preset.primary }]} />
                  <View style={[styles.presetSecondary, { backgroundColor: preset.secondary }]} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Font Selection */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Font Family</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Choose a font for your store
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fontScroll}>
            {fontOptions.map((font) => (
              <TouchableOpacity
                key={font}
                style={[
                  styles.fontOption,
                  {
                    backgroundColor: formData.fontFamily === font ? colors.primary : colors.backgroundSecondary,
                    borderColor: formData.fontFamily === font ? colors.primary : colors.cardBorder,
                  }
                ]}
                onPress={() => setFormData({ ...formData, fontFamily: font })}>
                <Text style={[
                  styles.fontOptionText,
                  {
                    color: formData.fontFamily === font ? '#fff' : colors.text,
                    fontFamily: font,
                  }
                ]}>
                  {font}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Layout Selection */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Store Layout</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Choose how products are displayed
          </Text>
          <View style={styles.layoutGrid}>
            {layoutOptions.map((layout) => (
              <TouchableOpacity
                key={layout.value}
                style={[
                  styles.layoutOption,
                  {
                    backgroundColor: formData.storeLayout === layout.value ? colors.primary + '20' : colors.backgroundSecondary,
                    borderColor: formData.storeLayout === layout.value ? colors.primary : colors.cardBorder,
                  }
                ]}
                onPress={() => setFormData({ ...formData, storeLayout: layout.value })}>
                <IconSymbol
                  name={layout.icon as any}
                  size={32}
                  color={formData.storeLayout === layout.value ? colors.primary : colors.textSecondary}
                />
                <Text style={[
                  styles.layoutLabel,
                  { color: formData.storeLayout === layout.value ? colors.primary : colors.text }
                ]}>
                  {layout.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Preview Section */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Preview</Text>
          <View style={[styles.previewBox, { borderColor: colors.cardBorder }]}>
            <View style={[styles.previewHeader, { backgroundColor: formData.primaryColor || '#000000' }]}>
              <Text style={[styles.previewTitle, { color: '#fff', fontFamily: formData.fontFamily || 'Inter' }]}>
                Store Preview
              </Text>
            </View>
            <View style={styles.previewContent}>
              <View style={[styles.previewProduct, { borderColor: colors.cardBorder }]}>
                <View style={[styles.previewProductImage, { backgroundColor: formData.secondaryColor || '#666666' }]} />
                <Text style={[styles.previewProductName, { color: colors.text, fontFamily: formData.fontFamily || 'Inter' }]}>
                  Sample Product
                </Text>
                <Text style={[styles.previewProductPrice, { color: formData.primaryColor || '#000000' }]}>
                  ₦5,000
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
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
    saveButton: {
      fontSize: 16,
      fontWeight: '600',
    },
    content: {
      padding: 20,
    },
    section: {
      padding: 20,
      borderRadius: 16,
      marginBottom: 20,
      ...premiumShadow,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    sectionDescription: {
      fontSize: 14,
      marginBottom: 20,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    colorRow: {
      marginBottom: 20,
    },
    colorInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    colorPreview: {
      width: 50,
      height: 50,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: colors.cardBorder,
    },
    colorInput: {
      flex: 1,
      padding: 12,
      borderRadius: 8,
      fontSize: 16,
      borderWidth: 1,
    },
    colorPresets: {
      marginTop: 12,
    },
    presetLabel: {
      fontSize: 12,
      marginBottom: 8,
    },
    presetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    presetButton: {
      width: 50,
      height: 50,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colors.cardBorder,
    },
    presetPrimary: {
      height: '60%',
    },
    presetSecondary: {
      height: '40%',
    },
    fontScroll: {
      marginTop: 12,
    },
    fontOption: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 8,
      marginRight: 12,
      borderWidth: 1,
    },
    fontOptionText: {
      fontSize: 16,
      fontWeight: '600',
    },
    layoutGrid: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
    },
    layoutOption: {
      flex: 1,
      padding: 20,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 2,
    },
    layoutLabel: {
      marginTop: 8,
      fontSize: 14,
      fontWeight: '600',
    },
    previewBox: {
      borderRadius: 12,
      borderWidth: 1,
      overflow: 'hidden',
      marginTop: 12,
    },
    previewHeader: {
      padding: 16,
      alignItems: 'center',
    },
    previewTitle: {
      fontSize: 18,
      fontWeight: 'bold',
    },
    previewContent: {
      padding: 16,
    },
    previewProduct: {
      borderRadius: 8,
      borderWidth: 1,
      padding: 12,
    },
    previewProductImage: {
      width: '100%',
      height: 120,
      borderRadius: 8,
      marginBottom: 12,
    },
    previewProductName: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    previewProductPrice: {
      fontSize: 18,
      fontWeight: 'bold',
    },
  });

