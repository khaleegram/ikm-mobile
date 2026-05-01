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

/**
 * Full-viewport vertical paging (TikTok-style) is unreliable with FlashList:
 * recycling + snap/paging fights fixed cell heights and breaks layout.
 * Use native FlatList for that case.
 */
export const FlashListCompat = React.forwardRef<any, FlashListCompatProps<any>>(function FlashListCompat(
  { estimatedItemSize, pagingEnabled, ...props },
  ref
) {
  if (RuntimeFlashList && pagingEnabled !== true) {
    const FlashListComponent = RuntimeFlashList as React.ComponentType<any>;
    return (
      <FlashListComponent
        ref={ref}
        {...props}
        pagingEnabled={pagingEnabled}
        estimatedItemSize={estimatedItemSize}
      />
    );
  }

  const FlatListComponent = FlatList as unknown as React.ComponentType<any>;
  return <FlatListComponent ref={ref} {...props} pagingEnabled={pagingEnabled} />;
});
