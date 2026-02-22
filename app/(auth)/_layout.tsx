// Auth layout
import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useUser } from '@/lib/firebase/auth/use-user';
import { getAppVariant } from '@/lib/utils/app-variant';

export default function AuthLayout() {
  const { user, loading } = useUser();

  // In the seller/admin app, never keep the auth stack mounted once a valid user is signed in.
  // This is the documented Expo Router pattern: redirect from a layout based on auth state.
  if (getAppVariant() === 'seller') {
    if (loading) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    // Don't gate this redirect on role resolution; let `app/index.tsx` decide where to go.
    // Otherwise, users can get "stuck" on the login screen if Firestore/claims are slow.
    if (user) {
      // Centralize routing in `app/index.tsx`.
      return <Redirect href="/" />;
    }
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="market-login" />
      <Stack.Screen name="market-signup" />
      <Stack.Screen name="seller-login" />
      <Stack.Screen name="seller-signup" />
    </Stack>
  );
}

