// Admin panel layout
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { hasAppAccess } from '@/lib/utils/auth-helpers';
import { getAppVariant } from '@/lib/utils/app-variant';
import { useConfirmedMissingMarketPhone } from '@/lib/hooks/use-phone-gate-settled';
import { isMarketPhoneGateSatisfied } from '@/lib/utils/market-phone-gate';

const lightBrown = '#A67C52';

export default function AdminTabLayout() {
  const { colors } = useTheme();
  const { user, loading } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const insets = useSafeAreaInsets();
  const phoneReady = isMarketPhoneGateSatisfied(profile);

  // Admin lives inside the Seller app only.
  if (getAppVariant() !== 'seller') {
    return <Redirect href="/" />;
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/seller-login" />;
  }

  if (profileLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!phoneReady && !missingPhoneConfirmed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!phoneReady && missingPhoneConfirmed) {
    return <Redirect href="/complete-phone" />;
  }

  if (!hasAppAccess(user)) {
    return <Redirect href="/(auth)/seller-login" />;
  }

  if (!user.isAdmin) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Platform.OS === 'ios' ? lightBrown : colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.cardBorder,
          height: 60 + (Platform.OS === 'android' ? insets.bottom : 0),
          paddingBottom: Platform.OS === 'android' ? insets.bottom + 8 : 8,
          paddingTop: 8,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "chart.bar.fill" : "chart.bar"} 
              color={focused ? (Platform.OS === 'ios' ? lightBrown : colors.primary) : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: 'Users',
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "person.2.fill" : "person.2"} 
              color={focused ? (Platform.OS === 'ios' ? lightBrown : colors.primary) : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "bag.fill" : "bag"} 
              color={focused ? (Platform.OS === 'ios' ? lightBrown : colors.primary) : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Products',
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "cube.box.fill" : "cube.box"} 
              color={focused ? (Platform.OS === 'ios' ? lightBrown : colors.primary) : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "gearshape.fill" : "gearshape"} 
              color={focused ? (Platform.OS === 'ios' ? lightBrown : colors.primary) : colors.textSecondary} 
            />
          ),
        }}
      />
      {/* Hidden screens - accessible via dashboard or settings */}
      <Tabs.Screen name="reports" options={{ href: null }} />
      <Tabs.Screen name="security" options={{ href: null }} />
      <Tabs.Screen name="users/[id]" options={{ href: null }} />
    </Tabs>
  );
}

