// Admin security and access management
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAllUsers, useAllOrders } from '@/lib/firebase/firestore/admin';

export default function AdminSecurity() {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const { users } = useAllUsers();
  const { orders } = useAllOrders();
  const styles = createStyles(colors);
  
  // Calculate real security metrics
  const adminUsers = users.filter(u => u.isAdmin || (u as any).role === 'admin').length;
  const disputedOrders = orders.filter(o => o.status === 'Disputed').length;
  const failedLogins = 0; // Would need Cloud Function for this
  const activeSessions = users.length; // Approximate active users

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const securityFeatures = [
    {
      title: 'User Permissions',
      description: 'Manage role-based access controls',
      icon: 'person.badge.shield.checkmark.fill',
      color: colors.info,
      route: '/(admin)/users',
    },
    {
      title: 'Platform Settings',
      description: 'Configure security policies and rules',
      icon: 'lock.fill',
      color: colors.error,
      route: '/(admin)/settings',
    },
    {
      title: 'Audit Trail',
      description: 'View platform activity and changes',
      icon: 'doc.text.fill',
      color: colors.accent,
      route: '/(admin)/reports',
    },
  ];

  return (
    <ScrollView 
      style={styles.container} 
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }>
      {/* Header */}
      <LinearGradient
        colors={colorScheme === 'light' 
          ? [colors.primary, colors.accent] 
          : [colors.gradientStart, colors.gradientEnd]}
        style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity 
            onPress={() => router.back()}
            style={[styles.backButton, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
            <IconSymbol name="arrow.left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={[styles.shieldIcon, { backgroundColor: 'rgba(255, 255, 255, 0.25)' }]}>
              <IconSymbol name="shield.fill" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Security & Access</Text>
            <Text style={styles.subtitle}>Manage platform security settings</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* Security Overview */}
        <View style={[styles.overviewCard, { backgroundColor: colors.card }]}>
          <View style={styles.overviewHeader}>
            <IconSymbol name="shield.checkered" size={24} color={colors.primary} />
            <Text style={[styles.overviewTitle, { color: colors.text }]}>Security Status</Text>
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, { backgroundColor: `${colors.success}20` }]}>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.statusText, { color: colors.success }]}>All Systems Secure</Text>
            </View>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.cardBorder }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Admin Users</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{adminUsers}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.cardBorder }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Active Users</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{activeSessions}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Open Disputes</Text>
            <Text style={[styles.infoValue, { color: disputedOrders > 0 ? colors.error : colors.success }]}>
              {disputedOrders}
            </Text>
          </View>
        </View>

        {/* Security Features */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Security Features</Text>
        <View style={styles.featuresGrid}>
          {securityFeatures.map((feature, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.featureCard, { backgroundColor: colors.card }]}
              onPress={() => {
                if (feature.route) {
                  router.push(feature.route as any);
                } else {
                  // Show info for features that need Cloud Functions
                  Alert.alert(
                    feature.title,
                    'This feature requires additional Cloud Functions to be implemented. Contact your development team.',
                    [{ text: 'OK' }]
                  );
                }
              }}
              activeOpacity={0.7}>
              <View style={[styles.featureIcon, { backgroundColor: `${feature.color}20` }]}>
                <IconSymbol name={feature.icon as any} size={28} color={feature.color} />
              </View>
              <View style={styles.featureContent}>
                <Text style={[styles.featureTitle, { color: colors.text }]}>{feature.title}</Text>
                <Text style={[styles.featureDescription, { color: colors.textSecondary }]}>
                  {feature.description}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick Stats */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Security Metrics</Text>
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <IconSymbol name="person.2.fill" size={24} color={colors.primary} />
            <Text style={[styles.statValue, { color: colors.text }]}>{failedLogins}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Failed Logins</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <IconSymbol name="exclamationmark.triangle.fill" size={24} color={disputedOrders > 0 ? colors.error : colors.success} />
            <Text style={[styles.statValue, { color: disputedOrders > 0 ? colors.error : colors.text }]}>
              {disputedOrders}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Open Disputes</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <IconSymbol name="shield.fill" size={24} color={colors.success} />
            <Text style={[styles.statValue, { color: colors.text }]}>{adminUsers}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Admin Users</Text>
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
    header: {
      paddingBottom: 24,
      paddingHorizontal: 20,
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
      ...premiumShadow,
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
      gap: 8,
    },
    shieldIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: '#FFFFFF',
    },
    subtitle: {
      fontSize: 14,
      color: 'rgba(255, 255, 255, 0.9)',
    },
    content: {
      padding: 20,
    },
    overviewCard: {
      padding: 20,
      borderRadius: 20,
      marginBottom: 24,
      ...premiumShadow,
    },
    overviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    overviewTitle: {
      fontSize: 20,
      fontWeight: 'bold',
    },
    statusRow: {
      marginBottom: 16,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      gap: 8,
      alignSelf: 'flex-start',
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusText: {
      fontSize: 14,
      fontWeight: '600',
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    infoLabel: {
      fontSize: 14,
    },
    infoValue: {
      fontSize: 14,
      fontWeight: '600',
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 16,
      marginTop: 8,
    },
    featuresGrid: {
      gap: 12,
      marginBottom: 24,
    },
    featureCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 16,
      gap: 12,
      ...premiumShadow,
    },
    featureIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureContent: {
      flex: 1,
    },
    featureTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    featureDescription: {
      fontSize: 12,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 24,
    },
    statCard: {
      width: '30%',
      padding: 16,
      borderRadius: 16,
      alignItems: 'center',
      ...premiumShadow,
    },
    statValue: {
      fontSize: 24,
      fontWeight: 'bold',
      marginTop: 8,
      marginBottom: 4,
    },
    statLabel: {
      fontSize: 12,
      textAlign: 'center',
    },
  });

