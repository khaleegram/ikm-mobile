import React, { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { getVideoThumbnailUri } from '@/lib/utils/video-cover';

interface VideoCoverImageProps {
  coverUri?: string | null;
  videoUri?: string | null;
  style?: StyleProp<ViewStyle>;
  fallbackColor?: string;
  children?: React.ReactNode;
}

export function VideoCoverImage({
  coverUri,
  videoUri,
  style,
  fallbackColor,
  children,
}: VideoCoverImageProps) {
  const staticUri = String(coverUri || '').trim();
  const [generatedUri, setGeneratedUri] = useState<string | null>(null);
  const displayUri = staticUri || generatedUri;

  useEffect(() => {
    if (staticUri || !videoUri) return;

    let cancelled = false;
    getVideoThumbnailUri(String(videoUri).trim())
      .then((uri) => {
        if (!cancelled && uri) setGeneratedUri(uri);
      })
      .catch(() => {
        // Thumbnail generation is best-effort — fall back to no cover image.
      });

    return () => {
      cancelled = true;
    };
  }, [staticUri, videoUri]);

  return (
    <View style={[style, !displayUri && fallbackColor ? { backgroundColor: fallbackColor } : null]}>
      {displayUri ? (
        <Image
          source={{ uri: displayUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      ) : null}
      {children}
    </View>
  );
}
