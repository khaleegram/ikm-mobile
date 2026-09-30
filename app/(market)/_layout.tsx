import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Tabs } from 'expo-router';
import React, { useCallback, useMemo } from 'react';

import { CustomTabBar } from '@/components/custom-tab-bar';
import { UploadProgressBanner } from '@/components/market/upload-progress-banner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUser } from '@/lib/firebase/auth/use-user';
import { UploadProgressProvider } from '@/lib/context/upload-progress';
import {
  useMarketChatMessageNotifications,
  useMarketChatNotificationTapNavigation,
} from '@/lib/hooks/use-market-chat-notifications';
import { useFcmTokenRegistration } from '@/lib/hooks/use-fcm-token';
import { useTheme } from '@/lib/theme/theme-context';

function MarketChatNotificationsBridge() {
  const { user } = useUser();
  useMarketChatMessageNotifications(user?.uid ?? null);
  useMarketChatNotificationTapNavigation();
  return null;
}

function FcmTokenBridge() {
  const { user } = useUser();
  useFcmTokenRegistration(user?.uid ?? null);
  return null;
}

export default function MarketTabLayout() {
  const { colors } = useTheme();
  const { user } = useUser();
  const renderTabBar = useCallback((props: any) => <CustomTabBar {...props} />, []);

  const screenOptions = useMemo(() => {
    return {
      headerShown: false as const,
      sceneStyle: { backgroundColor: colors.background },
      tabBarStyle: {
        position: 'absolute' as const,
        backgroundColor: 'transparent',
        borderTopWidth: 0,
        elevation: 0,
        shadowOpacity: 0,
      },
    };
  }, [colors.background]);

  return (
    <UploadProgressProvider>
      <MarketChatNotificationsBridge />
      <FcmTokenBridge />
      <UploadProgressBanner />
      {/*
        Every non-tab screen (settings, orders, cart, seller, …) is declared below with
        `href: null`, which makes it a *tab* that is simply hidden. Tab navigators default to
        `backBehavior="firstRoute"`, meaning back from any tab jumps to the first tab — the feed.
        That is why back landed on the feed from anywhere in the app.
        With "history", back returns to the screen you actually came from.
      */}
      <Tabs tabBar={renderTabBar} screenOptions={screenOptions} backBehavior="history">
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
        name="saved"
        options={{
          tabBarIcon: ({ focused }) => (
            <IconSymbol
              size={24}
              name={focused ? 'bookmark.fill' : 'bookmark'}
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
        options={({ route }) => {
          const nested = getFocusedRouteNameFromRoute(route) ?? 'index';
          const hideTabBar = nested !== 'index';
          return {
            // height: 0 prevents a residual bottom gap when the custom bar returns null
            tabBarStyle: hideTabBar
              ? {
                  display: 'none' as const,
                  height: 0,
                  overflow: 'hidden' as const,
                  opacity: 0,
                  position: 'absolute' as const,
                }
              : {
                  position: 'absolute' as const,
                  backgroundColor: 'transparent',
                  borderTopWidth: 0,
                  elevation: 0,
                  shadowOpacity: 0,
                },
            tabBarIcon: ({ focused }) => (
              <IconSymbol
                size={24}
                name={focused ? 'message.fill' : 'message'}
                color={focused ? colors.primary : colors.textSecondary}
              />
            ),
          };
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
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="post/[id]" options={{ href: null }} />
      <Tabs.Screen name="post-edit/[id]" options={{ href: null }} />
      <Tabs.Screen name="buy/[postId]" options={{ href: null }} />
      <Tabs.Screen name="cart" options={{ href: null }} />
      <Tabs.Screen name="orders/index" options={{ href: null }} />
      <Tabs.Screen name="orders/[id]" options={{ href: null }} />
      <Tabs.Screen name="payouts" options={{ href: null }} />
      <Tabs.Screen name="delivery-settings" options={{ href: null }} />
      <Tabs.Screen name="following" options={{ href: null }} />
      <Tabs.Screen name="followers" options={{ href: null }} />
      <Tabs.Screen name="following-people" options={{ href: null }} />
      <Tabs.Screen name="social-people" options={{ href: null }} />
      <Tabs.Screen name="liked" options={{ href: null }} />
      <Tabs.Screen name="seller/[sellerId]" options={{ href: null }} />
      <Tabs.Screen name="post-view/[id]" options={{ href: null }} />
    </Tabs>
    </UploadProgressProvider>
  );
}
