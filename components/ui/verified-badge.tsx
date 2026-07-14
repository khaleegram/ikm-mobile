import React from 'react';
import { StyleProp, TextStyle } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';

const DEFAULT_COLOR = '#1D9BF0';

type VerifiedBadgeProps = {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
};

/** Compact social-style verified check shown beside display / store names. */
export function VerifiedBadge({
  size = 14,
  color = DEFAULT_COLOR,
  style,
}: VerifiedBadgeProps) {
  return <IconSymbol name="checkmark.seal.fill" size={size} color={color} style={style} />;
}
