import Constants from 'expo-constants';
import * as Application from 'expo-application';

export type AppVariant = 'market' | 'seller';

let cachedVariant: AppVariant | null = null;

function normalizeVariant(value: unknown): AppVariant {
  return value === 'seller' ? 'seller' : 'market';
}

function variantFromApplicationId(): AppVariant | null {
  const id = Application.applicationId;
  if (!id) return null;
  if (id.endsWith('.seller') || id.includes('.seller.')) return 'seller';
  if (id.endsWith('.market') || id.includes('.market.')) return 'market';
  return null;
}

/**
 * Determine which app variant is running.
 * Priority:
 * 1) Native application id (package/bundle id) — works reliably across dev-client and production builds.
 * 2) `expo.extra.appVariant` from the Expo manifest/config
 * 3) `process.env.EXPO_PUBLIC_APP_VARIANT` (Metro inlined env)
 */
export function getAppVariant(): AppVariant {
  if (cachedVariant) return cachedVariant;

  const fromExtra = (Constants.expoConfig?.extra as any)?.appVariant;
  const fromEnv = process.env.EXPO_PUBLIC_APP_VARIANT;
  const fromAppId = variantFromApplicationId();

  // Only cache when we have a real signal. Defaulting when everything is missing should not be cached.
  if (fromAppId) {
    cachedVariant = fromAppId;
    return cachedVariant;
  }
  if (fromExtra === 'market' || fromExtra === 'seller') {
    cachedVariant = fromExtra;
    return cachedVariant;
  }
  if (fromEnv === 'market' || fromEnv === 'seller') {
    cachedVariant = fromEnv;
    return cachedVariant;
  }

  return normalizeVariant(null);
}

export function isMarketApp(): boolean {
  return getAppVariant() === 'market';
}

export function isSellerApp(): boolean {
  return getAppVariant() === 'seller';
}
