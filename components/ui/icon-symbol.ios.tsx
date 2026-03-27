import { SymbolView, SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { StyleProp, ViewStyle } from 'react-native';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hslToRgbString(input: string): string {
  const match = input
    .trim()
    .match(/^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*(?:,\s*(\d+(?:\.\d+)?)\s*)?\)$/i);
  if (!match) return input;

  const hue = ((Number(match[1]) % 360) + 360) % 360;
  const sat = clamp(Number(match[2]) / 100, 0, 1);
  const light = clamp(Number(match[3]) / 100, 0, 1);
  const alphaRaw = match[4];
  const alpha = alphaRaw == null ? null : clamp(Number(alphaRaw), 0, 1);

  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const huePrime = hue / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const matchLight = light - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = secondary;
  } else if (huePrime < 2) {
    red = secondary;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = secondary;
  } else if (huePrime < 4) {
    green = secondary;
    blue = chroma;
  } else if (huePrime < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const r = Math.round((red + matchLight) * 255);
  const g = Math.round((green + matchLight) * 255);
  const b = Math.round((blue + matchLight) * 255);

  if (alpha == null) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function normalizeSymbolColor(color: string): string {
  if (/^hsla?\(/i.test(color.trim())) {
    return hslToRgbString(color);
  }
  return color;
}

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: SymbolViewProps['name'];
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}) {
  return (
    <SymbolView
      weight={weight}
      tintColor={normalizeSymbolColor(color)}
      resizeMode="scaleAspectFit"
      name={name}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );
}
