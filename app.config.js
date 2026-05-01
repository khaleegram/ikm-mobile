// Dynamic Expo config to support two separate app store listings from one codebase.
// Variant is controlled via EXPO_PUBLIC_APP_VARIANT:
// - "market": Market Street app (public/guest-friendly)
// - "seller": Seller/Admin app (no Market Street)
//
// Example:
//   EXPO_PUBLIC_APP_VARIANT=market  eas build --profile market-production
//   EXPO_PUBLIC_APP_VARIANT=seller  eas build --profile seller-production

/** @type {(ctx: import('expo/config').ConfigContext) => import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const rawVariant = process.env.EXPO_PUBLIC_APP_VARIANT;
  const variant = rawVariant === "seller" ? "seller" : "market";
  const isMarket = variant === "market";

  const name = isMarket ? "ChatCart" : "ChatCart Seller";
  // Keep a single Expo project (same `extra.eas.projectId`) for both variants.
  // Store listings are separated by bundle identifier / applicationId, not by slug.
  const slug = config.slug || "chatcart";
  const scheme = isMarket ? "chatcart" : "chatcart-seller";

  // Register the same IDs in Firebase (Android + iOS app entries) and in App Store / Play Console.
  const androidPackage = isMarket
    ? "com.argalengz.chatcart"
    : "com.argalengz.chatcart.seller";
  const iosBundleIdentifier = isMarket
    ? "com.argalengz.chatcart"
    : "com.argalengz.chatcart.seller";

  const marketBranding = isMarket
    ? {
        headerLine: 'CHATCART',
        proseName: 'ChatCart',
        genericItemLower: 'ChatCart item',
        genericItemTitle: 'ChatCart Item',
        signupJoinSubtitle: 'Join ChatCart',
        deletePostMessage: 'This will permanently remove this post from ChatCart.',
        phoneGateLine: 'Add a phone number so buyers and sellers can reach you. Use your country code (e.g. +234).',
        shareFromLine: 'Shared from ChatCart',
        ordersNavLabel: 'Orders',
      }
    : {
        headerLine: 'CHATCART SELLER',
        proseName: 'ChatCart Seller',
        genericItemLower: 'item',
        genericItemTitle: 'Item',
        signupJoinSubtitle: 'Join and start selling',
        deletePostMessage: 'This will permanently remove this post.',
        phoneGateLine: 'Add a phone number for your store. Buyers may use it to reach you. Include your country code (e.g. +234).',
        shareFromLine: 'Shared from ChatCart Seller',
        ordersNavLabel: 'Orders',
      };

  const extra = {
    ...(config.extra || {}),
    appVariant: variant,
    marketBranding,
  };

  // Optional: allow overriding EAS project IDs per variant (recommended for EAS Update separation).
  // If you don’t use EAS Update yet, you can ignore these env vars for now.
  const easProjectId =
    (isMarket
      ? process.env.EAS_PROJECT_ID_MARKET
      : process.env.EAS_PROJECT_ID_SELLER) || extra?.eas?.projectId;

  if (easProjectId) {
    extra.eas = {
      ...(extra.eas || {}),
      projectId: easProjectId,
    };
  }

  const androidPermissions = Array.from(
    new Set([
      ...((config.android && Array.isArray(config.android.permissions)
        ? config.android.permissions
        : []) || []),
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
    ]),
  );

  const plugins = Array.from(
    new Set([
      ...((Array.isArray(config.plugins) ? config.plugins : []) || []),
      "expo-av",
      "expo-localization",
      "expo-video",
    ]),
  );

  return {
    ...config,
    name,
    slug,
    scheme,
    ios: {
      ...(config.ios || {}),
      bundleIdentifier: iosBundleIdentifier,
      infoPlist: {
        ...((config.ios && config.ios.infoPlist) || {}),
        NSLocationWhenInUseUsageDescription:
          "ChatCart uses your location to help prefill delivery settings. You can change it any time.",
      },
    },
    android: {
      ...(config.android || {}),
      package: androidPackage,
      softwareKeyboardLayoutMode: "resize",
      permissions: androidPermissions,
    },
    plugins,
    extra,
  };
};
