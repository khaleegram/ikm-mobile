import React from 'react';
import type { FlatListProps } from 'react-native';

import { FlashListCompat, type FlashListCompatProps } from '@/components/layout/flash-list-compat';

type KeyboardFlatListProps<ItemT> = FlashListCompatProps<ItemT> & {
  /** @deprecated Unused — kept for call-site compatibility with KeyboardScreen. */
  extraScrollHeight?: number;
};

/**
 * Virtualized list defaults for screens with a search field / composer.
 * Uses FlashList when available (falls back to FlatList via FlashListCompat).
 * Keyboard avoidance for form screens should use `KeyboardScreen` /
 * `KeyboardAwareScrollView` from `react-native-keyboard-controller`.
 */
export default function KeyboardFlatList<ItemT>({
  keyboardShouldPersistTaps = 'handled',
  keyboardDismissMode = 'on-drag',
  estimatedItemSize = 120,
  extraScrollHeight: _extraScrollHeight,
  ...rest
}: KeyboardFlatListProps<ItemT>) {
  return (
    <FlashListCompat
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode}
      estimatedItemSize={estimatedItemSize}
      {...(rest as FlatListProps<ItemT>)}
    />
  );
}
