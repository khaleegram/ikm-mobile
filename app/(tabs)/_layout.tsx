import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { CustomTabBar } from '@/components/custom-tab-bar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { hasAppAccess } from '@/lib/utils/auth-helpers';
import { useConfirmedMissingMarketPhone } from '@/lib/hooks/use-phone-gate-settled';
import { isMarketPhoneGateSatisfied } from '@/lib/utils/market-phone-gate';
import { useTheme } from '@/lib/theme/theme-context';
import { getAppVariant } from '@/lib/utils/app-variant';

export default function TabLayout() {
  const { colors } = useTheme();
  const { user, loading } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const phoneReady = isMarketPhoneGateSatisfied(profile);
  const missingPhoneConfirmed = useConfirmedMissingMarketPhone(phoneReady);

  // Seller app only.
  if (getAppVariant() !== 'seller') {
    return <Redirect href="/" />;
  }

  // Prevent tab navigator from mounting before auth state is ready.
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

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "house.fill" : "house"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "cube.box.fill" : "cube.box"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          href: null, // Hide from tab bar but still accessible
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "chart.bar.fill" : "chart.bar"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "gearshape.fill" : "gearshape"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      {/* Hidden screens - accessible via dashboard or settings */}
      <Tabs.Screen
        name="customers"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="marketing"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="shipping"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="payouts"
        options={{
          href: null, // Hide from tab bar
        }}
      />
    </Tabs>
  );
}
