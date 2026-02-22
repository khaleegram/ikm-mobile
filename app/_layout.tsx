import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { FlatList, Platform, ScrollView } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import 'react-native-reanimated';

import { ThemeProvider, useTheme } from '@/lib/theme/theme-context';

const ROOT_STACK_OPTIONS = { headerShown: false as const };

function AppShell() {
  const { colorScheme } = useTheme();

  useEffect(() => {
    const keyboardDismissMode = Platform.OS === 'ios' ? 'none' : 'none';

    const ScrollViewAny = ScrollView as any;
    const FlatListAny = FlatList as any;

    ScrollViewAny.defaultProps = {
      ...(ScrollViewAny.defaultProps || {}),
      keyboardShouldPersistTaps: 'always',
      keyboardDismissMode,
      automaticallyAdjustKeyboardInsets: true,
    };

    FlatListAny.defaultProps = {
      ...(FlatListAny.defaultProps || {}),
      keyboardShouldPersistTaps: 'always',
      keyboardDismissMode,
      automaticallyAdjustKeyboardInsets: true,
    };

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

  return (
    <>
      {/* Keep root navigation minimal to avoid route/theme feedback loops. */}
      <Stack screenOptions={ROOT_STACK_OPTIONS} />
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} translucent backgroundColor="transparent" />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
