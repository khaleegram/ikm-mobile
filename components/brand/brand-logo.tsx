import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  BRAND_BROWN,
  BRAND_MARK_PATHS,
  BRAND_STROKE_WIDTH,
  BRAND_VIEWBOX,
} from '@/lib/brand/mark-path';

/**
 * The ChatCart shopping bag — the same mark the website shows.
 *
 * This is the geometry behind the app icon, the adaptive layers, the splash
 * screen and the favicons; see scripts/generate-brand-assets.mjs. Rendering the
 * real mark in-app rather than an SF Symbol means iOS, Android and web all show
 * the identical logo — a symbol previously fell back to a different Material
 * icon on Android, so the "logo" on the sign-in screen was two different
 * graphics depending on the phone.
 *
 * The bag is line art, so it is stroked with no fill. Stroke widths are in the
 * 24x24 viewBox's units, so they scale with `size` exactly as they do in the
 * generated PNGs.
 */

type BrandMarkProps = {
  /** Width and height of the square the mark is drawn into. */
  size?: number;
  color?: string;
};

export function BrandMark({ size = 24, color = '#FFFFFF' }: BrandMarkProps) {
  return (
    <Svg width={size} height={size} viewBox={BRAND_VIEWBOX} fill="none">
      {BRAND_MARK_PATHS.map((d) => (
        <Path
          key={d}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={BRAND_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

type BrandLogoBadgeProps = {
  /** Diameter of the circular badge. */
  size?: number;
  backgroundColor?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The circular badge the sign-in and sign-up screens use.
 *
 * It stays on the brand brown rather than the website header's ink tile: the
 * badge sits on `colors.background`, which is near-black in dark mode, so an ink
 * circle would disappear. Brown is the app's own accent and reads on both.
 */
export function BrandLogoBadge({
  size = 60,
  backgroundColor = BRAND_BROWN,
  color = '#FFFFFF',
  style,
}: BrandLogoBadgeProps) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <BrandMark size={size * 0.52} color={color} />
    </View>
  );
}
