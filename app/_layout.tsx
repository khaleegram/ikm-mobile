import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SystemUI from 'expo-system-ui';
import 'react-native-reanimated';

import { useUser } from '@/lib/firebase/auth/use-user';
import { hasAppAccess } from '@/lib/utils/auth-helpers';
import { useNotifications } from '@/lib/hooks/use-notifications';
import { useOfflineSync } from '@/lib/hooks/use-offline-sync';
import { OfflineIndicator } from '@/components/offline-indicator';
import { ThemeProvider, useTheme } from '@/lib/theme/theme-context';
import { Toast } from '@/components/toast';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AppContent() {
  const { user, loading } = useUser();
  const segments = useSegments();
  const router = useRouter();
  const { colorScheme, colors } = useTheme();
  const insets = useSafeAreaInsets();
  
  // Initialize notifications and offline sync
  useNotifications();
  useOfflineSync();

  // Set edge-to-edge with transparent bars
  useEffect(() => {
    if (Platform.OS === 'android') {
      SystemUI.setBackgroundColorAsync('transparent');
    }
  }, []);

  useEffect(() => {
    // Wait for initial auth check to complete
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inTabsGroup = segments[0] === '(tabs)';
    const inAdminGroup = segments[0] === '(admin)';
    const isStandaloneRoute = segments[0] === 'store-settings' || segments[0] === 'products' || segments[0] === 'orders' || segments[0] === 'modal';

    // No user - redirect to login (unless already on auth screen)
    if (!user) {
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // User exists - check access
    const userHasAccess = hasAppAccess(user);
    const isAdmin = user.isAdmin;

    // User doesn't have access - redirect to login
    if (!userHasAccess) {
      if (!inAuthGroup && !isStandaloneRoute) {
        if (segments[0] !== '(auth)') {
          Alert.alert(
            'Access Denied',
            'This app is only available for sellers and administrators. Please ensure your account has the seller role.',
            [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
          );
        } else {
          router.replace('/(auth)/login');
        }
      }
      return;
    }

    // User has access - handle routing
    // Allow standalone routes for users with access
    if (isStandaloneRoute) {
      return;
    }

    // Prevent non-admins from accessing admin routes
    if (!isAdmin && inAdminGroup) {
      router.replace('/(tabs)');
      return;
    }

    // Redirect authenticated users from auth screen to appropriate dashboard
    if (inAuthGroup) {
      if (isAdmin) {
        router.replace('/(admin)');
      } else {
        router.replace('/(tabs)');
      }
      return;
    }

    // Allow admins to access seller tabs (no auto-redirect)
    // Allow sellers to access seller tabs (no action needed)
  }, [user, loading, segments]);

  // Custom theme with brown app bar for light mode
  const customLightTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colorScheme === 'light' ? colors.primary : colors.card,
      text: colorScheme === 'light' ? '#FFFFFF' : colors.text,
      border: colors.border,
    },
  };

  return (
    <NavThemeProvider value={colorScheme === 'dark' ? DarkTheme : customLightTheme}>
      <OfflineIndicator />
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
        <Stack.Screen name="store-settings" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="storefront" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="domain" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="products/new" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="products/[id]" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="orders/[id]" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="notifications" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="(admin)/users/[id]" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="(admin)/security" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="(admin)/reports" options={{ headerShown: false, presentation: 'card' }} />
      </Stack>
      <StatusBar 
        style={colorScheme === 'dark' ? 'light' : 'light'} 
        translucent={true}
        backgroundColor="transparent"
      />
      <Toast />
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
