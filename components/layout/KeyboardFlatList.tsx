import React from 'react';
import { FlatList, FlatListProps, Platform } from 'react-native';

type KeyboardAwareModule = {
  KeyboardAwareFlatList?: React.ComponentType<any>;
};

let keyboardAwareModule: KeyboardAwareModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  keyboardAwareModule = require('react-native-keyboard-aware-scroll-view');
} catch {
  keyboardAwareModule = null;
}

const KeyboardAwareFlatList = keyboardAwareModule?.KeyboardAwareFlatList;
const HAS_KEYBOARD_AWARE = Boolean(KeyboardAwareFlatList);

type KeyboardFlatListProps<ItemT> = FlatListProps<ItemT> & {
  extraScrollHeight?: number;
};

export default function KeyboardFlatList<ItemT>({
  extraScrollHeight = 24,
  keyboardShouldPersistTaps = 'always',
  keyboardDismissMode,
  ...rest
}: KeyboardFlatListProps<ItemT>) {
  const ListComponent = (HAS_KEYBOARD_AWARE ? KeyboardAwareFlatList : FlatList) as React.ComponentType<any>;

  const keyboardAwareProps = HAS_KEYBOARD_AWARE
    ? {
        enableOnAndroid: true,
        extraScrollHeight,
        keyboardOpeningTime: Platform.OS === 'android' ? 0 : 250,
      }
    : null;

  return (
    <ListComponent
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode ?? 'none'}
      {...keyboardAwareProps}
      {...rest}
    />
  );
}
