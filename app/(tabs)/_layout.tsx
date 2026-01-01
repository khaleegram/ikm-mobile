import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';

export default function TabLayout() {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
        tabBarShowLabel: false, // Remove tab labels
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.cardBorder,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={28} 
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
              size={28} 
              name={focused ? "cube.box.fill" : "cube.box"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={28} 
              name={focused ? "bag.fill" : "bag"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={28} 
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
              size={28} 
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
