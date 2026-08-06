import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Shared MMKV instance for query cache + app state.
 * Requires a native rebuild after install (`npx expo run:android`).
 */
export const appStorage: MMKV = createMMKV({ id: 'chatcart-app' });

export const mmkvStorage = {
  getItem: (key: string): string | null => appStorage.getString(key) ?? null,
  setItem: (key: string, value: string): void => {
    appStorage.set(key, value);
  },
  removeItem: (key: string): void => {
    appStorage.remove(key);
  },
};
