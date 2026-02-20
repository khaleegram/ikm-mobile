import { Tabs } from 'expo-router';
import React, { useCallback, useMemo } from 'react';

import { CustomTabBar } from '@/components/custom-tab-bar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';

export default function MarketTabLayout() {
  const { colors } = useTheme();

  const renderTabBar = useCallback((props: any) => <CustomTabBar {...props} />, []);

  const screenOptions = useMemo(() => {
    return { headerShown: false as const };
  }, []);

  return (
    <Tabs tabBar={renderTabBar} screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol
              size={24}
              name={focused ? 'house.fill' : 'house'}
              color={focused ? colors.primary : colors.textSecondary}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="following"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol
              size={24}
              name={focused ? 'person.2.fill' : 'person.2'}
              color={focused ? colors.primary : colors.textSecondary}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="create-post"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol
              size={22}
              name={focused ? 'plus.circle.fill' : 'plus.circle'}
              color={focused ? '#FFFFFF' : colors.textSecondary}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol
              size={24}
              name={focused ? 'message.fill' : 'message'}
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
              name={focused ? 'person.fill' : 'person'}
              color={focused ? colors.primary : colors.textSecondary}
            />
          ),
        }}
      />

      {/* Hidden screens */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="post/[id]" options={{ href: null }} />
      <Tabs.Screen name="messages/[chatId]" options={{ href: null }} />
    </Tabs>
  );
}
