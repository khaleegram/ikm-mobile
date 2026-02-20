import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import 'react-native-reanimated';

import { ThemeProvider, useTheme } from '@/lib/theme/theme-context';

const ROOT_STACK_OPTIONS = { headerShown: false as const };

function AppShell() {
  const { colorScheme } = useTheme();

  useEffect(() => {
    if (Platform.OS === 'android') {
      SystemUI.setBackgroundColorAsync('transparent');
    }
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
