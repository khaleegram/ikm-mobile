// Premium styling utilities
import { StyleSheet, Platform } from 'react-native';
import { useTheme } from './theme-context';

export const createStyles = <T extends Record<string, any>>(
  styleFn: (colors: ReturnType<typeof import('./colors').getColors>) => T
) => {
  return () => {
    const { colors } = useTheme();
    return StyleSheet.create(styleFn(colors));
  };
};

// Premium shadow styles
export const premiumShadow = {
  shadowColor: '#000',
  shadowOffset: {
    width: 0,
    height: 4,
  },
  shadowOpacity: 0.15,
  shadowRadius: 12,
  elevation: 8,
};

export const premiumShadowLarge = {
  shadowColor: '#000',
  shadowOffset: {
    width: 0,
    height: 8,
  },
  shadowOpacity: 0.2,
  shadowRadius: 16,
  elevation: 12,
};

export const premiumShadowSmall = {
  shadowColor: '#000',
  shadowOffset: {
    width: 0,
    height: 2,
  },
  shadowOpacity: 0.1,
  shadowRadius: 4,
  elevation: 4,
};

// Premium card style
export const premiumCard = (colors: ReturnType<typeof import('./colors').getColors>) => ({
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: 20,
  ...premiumShadow,
  borderWidth: 1,
  borderColor: colors.cardBorder,
});

// Premium button style
export const premiumButton = (colors: ReturnType<typeof import('./colors').getColors>) => ({
  backgroundColor: colors.primary,
  borderRadius: 12,
  paddingVertical: 16,
  paddingHorizontal: 24,
  ...premiumShadow,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});

// Premium input style
export const premiumInput = (colors: ReturnType<typeof import('./colors').getColors>) => ({
  backgroundColor: colors.backgroundSecondary,
  borderWidth: 1,
  borderColor: colors.cardBorder,
  borderRadius: 12,
  padding: 16,
  fontSize: 16,
  color: colors.text,
  ...premiumShadowSmall,
});

// Gradient helper
export const getGradientColors = (colors: ReturnType<typeof import('./colors').getColors>) => [
  colors.gradientStart,
  colors.gradientEnd,
];

