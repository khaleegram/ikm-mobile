import NetInfo from '@react-native-community/netinfo';
import { onlineManager, focusManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * Wire TanStack Query to React Native lifecycle so:
 * - refetchOnReconnect actually fires when NetInfo comes back online
 * - opt-in refetchOnWindowFocus works when the app returns to foreground
 *
 * Import once at app boot (via query client module).
 */
let wired = false;

export function wireReactQueryRnManagers(): void {
  if (wired) return;
  wired = true;

  onlineManager.setEventListener((setOnline) => {
    return NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setOnline(online);
    });
  });

  const onAppStateChange = (status: AppStateStatus) => {
    if (Platform.OS === 'web') return;
    focusManager.setFocused(status === 'active');
  };

  const sub = AppState.addEventListener('change', onAppStateChange);
  onAppStateChange(AppState.currentState);

  // Keep subscription for app lifetime; no teardown needed at root boot.
  void sub;
}
