// Domain management screen
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useStore } from '@/lib/firebase/firestore/stores';
import { router } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { Linking, Alert } from 'react-native';

export default function DomainScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const { store, loading } = useStore(user?.uid || null);
  const styles = createStyles(colors);

  const baseDomain = 'ikm.com'; // This should come from environment variable
  const subdomain = store?.subdomain || '';
  const storeUrl = subdomain ? `https://${subdomain}.${baseDomain}` : '';

  const handleOpenStore = async () => {
    if (storeUrl) {
      const supported = await Linking.canOpenURL(storeUrl);
      if (supported) {
        await Linking.openURL(storeUrl);
      } else {
        Alert.alert('Error', 'Cannot open store URL');
      }
    }
  };

  if (loading) {
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
        <Text style={[styles.title, { color: colors.text }]}>Domain Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.iconContainer}>
            <IconSymbol name="globe" size={48} color={colors.primary} />
          </View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Store URL</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            Your store is accessible at the following address
          </Text>

          {subdomain ? (
            <>
              <View style={[styles.urlBox, { backgroundColor: colors.backgroundSecondary, borderColor: colors.cardBorder }]}>
                <Text style={[styles.urlText, { color: colors.text }]}>{storeUrl}</Text>
              </View>

              <TouchableOpacity
                style={[styles.openButton, { backgroundColor: colors.primary }]}
                onPress={handleOpenStore}>
                <IconSymbol name="globe" size={20} color="#fff" />
                <Text style={styles.openButtonText}>Open Store</Text>
              </TouchableOpacity>

              <View style={styles.infoBox}>
                <IconSymbol name="info.circle.fill" size={20} color={colors.info} />
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                  Your subdomain is automatically generated and cannot be changed. Customers can access your store using this URL.
                </Text>
              </View>
            </>
          ) : (
            <View style={[styles.emptyBox, { backgroundColor: colors.backgroundSecondary }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={32} color={colors.warning} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Your store subdomain will be generated once you complete your store setup.
              </Text>
              <TouchableOpacity
                style={[styles.setupButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/store-settings' as any)}>
                <Text style={styles.setupButtonText}>Complete Store Setup</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Subdomain Information</Text>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Subdomain</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>
              {subdomain || 'Not yet assigned'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Domain</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{baseDomain}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Full URL</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>
              {storeUrl || 'Not available'}
            </Text>
          </View>
        </View>

        {store?.customDomain && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Custom Domain</Text>
            <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
              Custom domain feature coming soon
            </Text>
          </View>
        )}
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
    content: {
      padding: 20,
    },
    section: {
      padding: 20,
      borderRadius: 16,
      marginBottom: 20,
      ...premiumShadow,
    },
    iconContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 8,
      textAlign: 'center',
    },
    sectionDescription: {
      fontSize: 14,
      textAlign: 'center',
      marginBottom: 24,
    },
    urlBox: {
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 16,
    },
    urlText: {
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    openButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      borderRadius: 12,
      marginBottom: 16,
      gap: 8,
    },
    openButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    infoBox: {
      flexDirection: 'row',
      padding: 12,
      borderRadius: 8,
      backgroundColor: colors.info + '10',
      gap: 8,
    },
    infoText: {
      flex: 1,
      fontSize: 12,
    },
    emptyBox: {
      padding: 32,
      borderRadius: 12,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      textAlign: 'center',
      marginTop: 16,
      marginBottom: 24,
    },
    setupButton: {
      padding: 16,
      borderRadius: 12,
      paddingHorizontal: 24,
    },
    setupButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    infoLabel: {
      fontSize: 14,
    },
    infoValue: {
      fontSize: 14,
      fontWeight: '600',
    },
  });

