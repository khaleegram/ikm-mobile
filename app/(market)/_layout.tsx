import { Tabs } from 'expo-router';
import React from 'react';

import { CustomTabBar } from '@/components/custom-tab-bar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { useRouter } from 'expo-router';
import { useUser } from '@/lib/firebase/auth/use-user';
import { canPostToMarketStreet } from '@/lib/utils/auth-helpers';

export default function MarketTabLayout() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useUser();

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
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
        name="search"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name="magnifyingglass" 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="create-post"
        options={{
          href: null, // Hide from tab bar (handled by center button)
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          href: null, // Hide messages folder from tab bar
        }}
      />
      <Tabs.Screen
        name="messages/index"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "message.fill" : "message"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol 
              size={24} 
              name={focused ? "person.fill" : "person"} 
              color={focused ? colors.primary : colors.textSecondary} 
            />
          ),
        }}
      />
      {/* Hidden screens */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="post" options={{ href: null }} />
    </Tabs>
  );
}
