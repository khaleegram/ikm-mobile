import React from 'react';
import { FlatList, type FlatListProps } from 'react-native';

type FlashListModule = {
  FlashList?: React.ComponentType<any>;
};

let RuntimeFlashList: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const moduleRef = require('@shopify/flash-list') as FlashListModule;
  RuntimeFlashList = moduleRef?.FlashList || null;
} catch {
  RuntimeFlashList = null;
}

export type FlashListCompatProps<ItemT> = FlatListProps<ItemT> & {
  estimatedItemSize?: number;
};

export function FlashListCompat<ItemT>({
  estimatedItemSize,
  ...props
}: FlashListCompatProps<ItemT>) {
  if (RuntimeFlashList) {
    const FlashListComponent = RuntimeFlashList as React.ComponentType<any>;
    return <FlashListComponent {...props} estimatedItemSize={estimatedItemSize} />;
  }

  const FlatListComponent = FlatList as unknown as React.ComponentType<any>;
  return <FlatListComponent {...props} />;
}
