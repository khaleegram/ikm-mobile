// Admin platform settings
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { adminApi } from '@/lib/api/admin';
import { useUser } from '@/lib/firebase/auth/use-user';
import { usePlatformSettings } from '@/lib/firebase/firestore/platform-settings';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AdminSettings() {
  const { colors, colorScheme, toggleTheme } = useTheme();
  const { settings, loading: settingsLoading } = usePlatformSettings();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const lightBrown = '#A67C52';
  const styles = createStyles(colors, insets, lightBrown);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    commissionRate: '5',
    minPayout: '10000',
    autoReleaseDays: '7',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      setFormData({
        commissionRate: (settings.commissionRate || 5).toString(),
        minPayout: (settings.minPayoutAmount || 10000).toString(),
        autoReleaseDays: (settings.autoReleaseDays || 7).toString(),
      });
    }
  }, [settings]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    const commissionRateNum = parseFloat(formData.commissionRate);
    if (isNaN(commissionRateNum) || commissionRateNum < 0 || commissionRateNum > 100) {
      newErrors.commissionRate = 'Commission rate must be between 0 and 100';
    }

    const minPayoutNum = parseFloat(formData.minPayout);
    if (isNaN(minPayoutNum) || minPayoutNum < 0) {
      newErrors.minPayout = 'Minimum payout must be a positive number';
    }

    const autoReleaseDaysNum = parseFloat(formData.autoReleaseDays);
    if (isNaN(autoReleaseDaysNum) || autoReleaseDaysNum < 1 || autoReleaseDaysNum > 365) {
      newErrors.autoReleaseDays = 'Auto release days must be between 1 and 365';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      haptics.error();
      Alert.alert('Validation Error', 'Please fix the errors before saving');
      return;
    }

    haptics.medium();
    Alert.alert(
      'Confirm Changes',
      'Are you sure you want to update these platform settings? This will affect all sellers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            const commissionRateNum = parseFloat(formData.commissionRate);
            const minPayoutNum = parseFloat(formData.minPayout);
            const autoReleaseDaysNum = parseFloat(formData.autoReleaseDays);

            setSaving(true);
            try {
              await adminApi.updatePlatformSettings({
                commissionRate: commissionRateNum / 100, // Convert percentage to decimal (5% = 0.05)
                minPayoutAmount: minPayoutNum,
                autoReleaseDays: autoReleaseDaysNum,
              });
              setErrors({});
              haptics.success();
              Alert.alert('Success', 'Platform settings updated successfully');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to update settings');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const settingsConfig = [
    {
      title: 'Platform Commission',
      description: 'Default commission rate for all sellers (%)',
      value: formData.commissionRate,
      onChange: (value: string) => setFormData({ ...formData, commissionRate: value }),
      icon: 'percent',
      suffix: '%',
    },
    {
      title: 'Minimum Payout',
      description: 'Minimum amount before sellers can request payout (₦)',
      value: formData.minPayout,
      onChange: (value: string) => setFormData({ ...formData, minPayout: value }),
      icon: 'dollarsign.circle',
      prefix: '₦',
    },
    {
      title: 'Auto Release Days',
      description: 'Days before funds are automatically released',
      value: formData.autoReleaseDays,
      onChange: (value: string) => setFormData({ ...formData, autoReleaseDays: value }),
      icon: 'calendar',
      suffix: ' days',
    },
  ];

  if (settingsLoading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Floating Island Header */}
      <View style={styles.floatingHeaderContainer}>
        <AnimatedPressable
          style={styles.iconIsland}
          onPress={() => { haptics.light(); router.back(); }}
          scaleValue={0.9}>
          <IconSymbol name="chevron.left" size={20} color={colors.text} />
        </AnimatedPressable>
        
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>PLATFORM SETTINGS</Text>
          <Text style={styles.islandTitle} numberOfLines={1}>
            Configuration
          </Text>
        </View>
        
        <AnimatedPressable
          style={styles.iconIsland}
          onPress={() => { haptics.medium(); toggleTheme(); }}
          scaleValue={0.9}>
          <IconSymbol 
            name={colorScheme === 'dark' ? "sun.max.fill" : "moon.fill"} 
            size={20} 
            color={lightBrown} 
          />
        </AnimatedPressable>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

      <View style={styles.content}>
        {settingsConfig.map((setting, index) => (
          <View
            key={index}
            style={[styles.settingCard, { backgroundColor: colors.card }]}>
            <View style={styles.settingHeader}>
              <View style={[styles.settingIcon, { backgroundColor: `${colors.primary}20` }]}>
                <IconSymbol name={setting.icon as any} size={24} color={colors.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingTitle, { color: colors.text }]}>{setting.title}</Text>
                <Text style={[styles.settingDescription, { color: colors.textSecondary }]}>
                  {setting.description}
                </Text>
              </View>
            </View>
            <View style={styles.inputContainer}>
              {setting.prefix && (
                <Text style={[styles.inputPrefix, { color: colors.textSecondary }]}>{setting.prefix}</Text>
              )}
              <TextInput
                style={[
                  styles.settingInput, 
                  { 
                    color: colors.text, 
                    borderColor: errors[setting.icon] ? colors.error : colors.cardBorder 
                  }
                ]}
                value={setting.value}
                onChangeText={(value) => {
                  setting.onChange(value);
                  // Clear error when user starts typing
                  if (errors[setting.icon]) {
                    setErrors({ ...errors, [setting.icon]: '' });
                  }
                }}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
              />
              {setting.suffix && (
                <Text style={[styles.inputSuffix, { color: colors.textSecondary }]}>{setting.suffix}</Text>
              )}
            </View>
            {errors[setting.icon] && (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors[setting.icon]}</Text>
            )}
          </View>
        ))}

        <AnimatedPressable
          style={[styles.saveButton, { backgroundColor: lightBrown, opacity: saving ? 0.6 : 1 }]}
          onPress={handleSave}
          disabled={saving}
          scaleValue={0.95}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </AnimatedPressable>

        {settings?.updatedAt && (
          <Text style={[styles.lastUpdated, { color: colors.textSecondary }]}>
            Last updated: {new Date(settings.updatedAt).toLocaleString()}
          </Text>
        )}

        {/* Admin Actions */}
        {user?.isAdmin && (
          <View style={[styles.adminActionsCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.adminSectionTitle, { color: colors.text, marginBottom: 16 }]}>Admin Actions</Text>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.cardBorder }]}
              onPress={() => router.push('/(tabs)/settings' as any)}
              activeOpacity={0.7}>
              <View style={styles.actionButtonContent}>
                <View style={[styles.actionIcon, { backgroundColor: `${colors.primary}20` }]}>
                  <IconSymbol name="storefront.fill" size={20} color={colors.primary} />
                </View>
                <View style={styles.actionTextContainer}>
                  <Text style={[styles.actionTitle, { color: colors.text }]}>Switch to Seller Dashboard</Text>
                  <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>
                    Access seller features and manage your store
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.cardBorder, marginTop: 12 }]}
              onPress={() => router.push('/(admin)/security' as any)}
              activeOpacity={0.7}>
              <View style={styles.actionButtonContent}>
                <View style={[styles.actionIcon, { backgroundColor: `${colors.error}20` }]}>
                  <IconSymbol name="shield.fill" size={20} color={colors.error} />
                </View>
                <View style={styles.actionTextContainer}>
                  <Text style={[styles.actionTitle, { color: colors.text }]}>Security & Access</Text>
                  <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>
                    Manage security settings and access controls
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>, insets: any, lightBrown: string) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingTop: insets.top + 10 + 44 + 15 + 20,
      paddingBottom: 20,
    },
    floatingHeaderContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      paddingTop: insets.top + 10,
      paddingHorizontal: 20,
      paddingBottom: 15,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
      gap: 8,
      pointerEvents: 'box-none',
    },
    nameIsland: {
      flex: 1,
      backgroundColor: lightBrown,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 22,
      ...Platform.select({
        ios: { shadowColor: lightBrown, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 5 },
        android: { elevation: 3 }
      })
    },
    iconIsland: {
      backgroundColor: colors.card,
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      ...premiumShadow,
    },
    islandLabel: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    islandTitle: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '800',
    },
    content: {
      padding: 20,
    },
    adminSectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 16,
    },
    settingCard: {
      padding: 20,
      borderRadius: 20,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
      ...premiumShadow,
    },
    settingHeader: {
      flexDirection: 'row',
      marginBottom: 16,
    },
    settingIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    settingInfo: {
      flex: 1,
    },
    settingTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    settingDescription: {
      fontSize: 14,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    inputPrefix: {
      fontSize: 18,
      fontWeight: '600',
      marginRight: 8,
    },
    settingInput: {
      flex: 1,
      fontSize: 24,
      fontWeight: 'bold',
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      textAlign: 'center',
    },
    inputSuffix: {
      fontSize: 18,
      fontWeight: '600',
      marginLeft: 8,
    },
    lastUpdated: {
      fontSize: 12,
      textAlign: 'center',
      marginTop: 8,
      fontStyle: 'italic',
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    saveButton: {
      padding: 18,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 8,
      ...premiumShadow,
    },
    saveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    errorText: {
      fontSize: 12,
      marginTop: 4,
      marginLeft: 4,
    },
    adminActionsCard: {
      padding: 20,
      borderRadius: 20,
      marginTop: 24,
      borderWidth: 1,
      borderColor: colors.border,
      ...premiumShadow,
    },
    actionButton: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
    },
    actionButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    actionIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionTextContainer: {
      flex: 1,
    },
    actionTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    actionDescription: {
      fontSize: 12,
    },
  });

