import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { enableFreeze } from 'react-native-screens';
import * as Linking from 'expo-linking';
import * as SystemUI from 'expo-system-ui';
import 'react-native-reanimated';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AppAlertHost } from '@/components/app-alert';
import { Toast } from '@/components/toast';
import { useOfflineSync } from '@/lib/hooks/use-offline-sync';
import { openDeepLink } from '@/lib/navigation/deep-links';
import { AppQueryProvider } from '@/lib/query/provider';
import { ThemeProvider, useTheme } from '@/lib/theme/theme-context';


// Pause inactive native screens (tabs/stack) to cut CPU/memory on feed + chat apps.
enableFreeze(true);

const ROOT_STACK_OPTIONS = { headerShown: false as const };

function OfflineSyncBridge() {
  useOfflineSync();
  return null;
}

function AppShell() {
  const { colorScheme } = useTheme();

  useEffect(() => {
    if (Platform.OS === 'android') {
      SystemUI.setBackgroundColorAsync('transparent');
    }
  }, []);

  useEffect(() => {
    const routerAny = router as any;
    if (routerAny.__ikmBackGuardApplied) return;

    const originalBack = router.back.bind(router);
    routerAny.__ikmBackGuardApplied = true;
    routerAny.__ikmOriginalBack = originalBack;
    routerAny.back = () => {
      if (typeof router.canGoBack === 'function' && !router.canGoBack()) {
        return;
      }
      originalBack();
    };
  }, []);

  useEffect(() => {
    let handledInitial = false;
    const handleUrl = (url: string | null | undefined) => {
      const raw = String(url || '').trim();
      if (!raw) return;
      // Paystack callback screen owns its own Linking.useURL flow when already mounted;
      // still route cold starts that land on the scheme root.
      openDeepLink(raw);
    };

    void Linking.getInitialURL().then((url) => {
      if (handledInitial) return;
      handledInitial = true;
      handleUrl(url);
    });

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  return (
    <>
      <OfflineSyncBridge />
      {/* Keep root navigation minimal to avoid route/theme feedback loops. */}
      <Stack screenOptions={ROOT_STACK_OPTIONS} />
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} translucent backgroundColor="transparent" />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppErrorBoundary>
        <KeyboardProvider>
          <AppQueryProvider>
            <ThemeProvider>
              <AppShell />
              <AppAlertHost />
              <Toast />
            </ThemeProvider>
          </AppQueryProvider>
        </KeyboardProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
