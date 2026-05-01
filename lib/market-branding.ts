import Constants from 'expo-constants';

export type MarketBranding = {
  /** Small caps line above titles (e.g. MARKET STREET). */
  headerLine: string;
  /** Readable product name in sentences. */
  proseName: string;
  /** Lowercase fallback line item (e.g. "Market Street item"). */
  genericItemLower: string;
  /** Title-case fallback for order line items. */
  genericItemTitle: string;
  signupJoinSubtitle: string;
  deletePostMessage: string;
  phoneGateLine: string;
  shareFromLine: string;
  ordersNavLabel: string;
};

const FALLBACK: MarketBranding = {
  headerLine: 'MARKET STREET',
  proseName: 'Market Street',
  genericItemLower: 'Market Street item',
  genericItemTitle: 'Market Street Item',
  signupJoinSubtitle: 'Join Market Street',
  deletePostMessage: 'This will permanently remove this post from Market Street.',
  phoneGateLine: 'Add a phone number so buyers and sellers can reach you. Use your country code (e.g. +234).',
  shareFromLine: 'Shared from Market Street',
  ordersNavLabel: 'Market Orders',
};

type ExtraShape = {
  marketBranding?: Partial<MarketBranding>;
};

/**
 * Brand strings for the market (and seller) app variant, from `app.config.js` `extra.marketBranding`.
 * Update copy in one place instead of hardcoding across screens.
 */
export function getMarketBranding(): MarketBranding {
  const extra = Constants.expoConfig?.extra as ExtraShape | undefined;
  const fromConfig = extra?.marketBranding;
  if (!fromConfig || typeof fromConfig !== 'object') return FALLBACK;
  return { ...FALLBACK, ...fromConfig };
}
