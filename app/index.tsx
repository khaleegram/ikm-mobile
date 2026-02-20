import { Redirect } from 'expo-router';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useEffect, useRef } from 'react';

import { useUser } from '@/lib/firebase/auth/use-user';
import { hasAppAccess } from '@/lib/utils/auth-helpers';
import { getAppVariant } from '@/lib/utils/app-variant';

export default function Index() {
  const { user, loading, signOut } = useUser();

  const hasShownSellerOnlyAlert = useRef(false);
  const hasForcedSignOut = useRef(false);

  const variant = getAppVariant();
  const isMarketApp = variant === 'market';

  const userHasAccess = user ? hasAppAccess(user) : false;
  const isAdmin = user?.isAdmin === true;

  // If a logged-in user opens the seller/admin app but isn't allowed, alert once and sign out once.
  useEffect(() => {
    if (isMarketApp) return;
    if (loading) return;
    if (!user) return;
    if (userHasAccess) return;

    if (!hasShownSellerOnlyAlert.current) {
      hasShownSellerOnlyAlert.current = true;
      Alert.alert(
        'Seller App Only',
        'This app is for sellers and admins only. Please sign in with a seller/admin account.'
      );
    }

    if (!hasForcedSignOut.current) {
      hasForcedSignOut.current = true;
      signOut().catch(() => {});
    }
  }, [isMarketApp, loading, user, userHasAccess, signOut]);

  // Market app allows guests; don't block on auth cold start.
  // Seller/Admin app should wait for auth to settle.
  if (!isMarketApp && loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // ================
  // Market variant
  // ================
  if (isMarketApp) {
    return <Redirect href="/(market)" />;
  }

  // ======================
  // Seller/Admin variant
  // ======================
  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!userHasAccess) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href={isAdmin ? '/(admin)' : '/(tabs)'} />;
}
