import { PermissionsAndroid, Platform } from 'react-native';

export type DeviceCoordinates = {
  latitude: number;
  longitude: number;
};

async function ensureLocationPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Allow Location',
        message: 'IKM uses your location to help prefill delivery settings.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      }
    );

    if (status !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Location permission denied.');
    }
  } catch (error: any) {
    throw new Error(error?.message || 'Location permission denied.');
  }
}

export async function getDeviceCoordinates(timeoutMs: number = 15000): Promise<DeviceCoordinates> {
  await ensureLocationPermission();
  const geolocation = (globalThis as any)?.navigator?.geolocation;
  if (!geolocation?.getCurrentPosition) {
    throw new Error('Device location is not available on this build.');
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position: any) => {
        const latitude = Number(position?.coords?.latitude);
        const longitude = Number(position?.coords?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          reject(new Error('Unable to read your current location.'));
          return;
        }
        resolve({ latitude, longitude });
      },
      (error: any) => {
        reject(new Error(error?.message || 'Location permission denied.'));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 10000,
      }
    );
  });
}
