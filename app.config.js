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

  const name = isMarket ? "IKM Market Street" : "IKM Seller";
  // Keep a single Expo project (same `extra.eas.projectId`) for both variants.
  // Store listings are separated by bundle identifier / applicationId, not by slug.
  const slug = config.slug || "ikm";
  const scheme = isMarket ? "ikm-market" : "ikm-seller";

  // Separate store listings require unique identifiers.
  const androidPackage = isMarket
    ? "com.khaleefah.ikm.market"
    : "com.khaleefah.ikm.seller";
  const iosBundleIdentifier = isMarket
    ? "com.khaleefah.ikm.market"
    : "com.khaleefah.ikm.seller";

  const extra = {
    ...(config.extra || {}),
    appVariant: variant,
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
      "expo-video",
      "expo-av",
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
          "IKM uses your location to help prefill delivery settings. You can change it any time.",
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
