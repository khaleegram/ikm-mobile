// Safe image component with error handling
import { useState } from 'react';
import { Image, View, ImageProps, StyleSheet } from 'react-native';
import { IconSymbol } from './ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';

interface SafeImageProps extends Omit<ImageProps, 'source'> {
  uri?: string | null;
  placeholderIcon?: string;
  placeholderSize?: number;
}

export function SafeImage({ 
  uri, 
  placeholderIcon = 'photo.fill',
  placeholderSize = 32,
  style,
  ...props 
}: SafeImageProps) {
  const { colors } = useTheme();
  const [hasError, setHasError] = useState(false);

  // Check if URI is valid
  const isValidUri = uri && 
    (uri.startsWith('http://') || 
     uri.startsWith('https://') || 
     uri.startsWith('file://'));

  if (!isValidUri || hasError) {
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.backgroundSecondary }, style]}>
        <IconSymbol name={placeholderIcon as any} size={placeholderSize} color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      onError={() => setHasError(true)}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

