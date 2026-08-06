import { Stack } from 'expo-router';

import { AppErrorBoundary } from '@/components/app-error-boundary';

export default function MessagesStackLayout() {
  return (
    <AppErrorBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </AppErrorBoundary>
  );
}
