import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { usersApi } from '@/lib/api/users-api';

function isFcmNativeUnavailable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '');
  return (
    /FirebaseApp is not initialized/i.test(msg) ||
    /fcm-credentials/i.test(msg) ||
    /getDevicePushTokenAsync/i.test(msg)
  );
}

function canRegisterNativePush(): boolean {
  // Expo Go cannot deliver native FCM/APNs device tokens on Android.
  if (Constants.appOwnership === 'expo') return false;
  return true;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Registers the device push token in Neon `users.fcm_tokens` only.
 * Dual registration to Cloud Functions + Neon previously meant chat-notify (reading
 * Firestore) and the client (writing Neon) never agreed — pushes silently failed.
 */
export function useFcmTokenRegistration(userId: string | null) {
  const registeredRef = useRef(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      registeredRef.current = false;
      const previous = tokenRef.current;
      tokenRef.current = null;
      if (previous) {
        usersApi.unregisterFcmToken(previous).catch(() => {});
      }
      return;
    }

    if (registeredRef.current) return;

    const register = async () => {
      if (!canRegisterNativePush()) {
        console.warn(
          'Push token registration skipped in Expo Go — use a dev/production build for FCM.'
        );
        return;
      }

      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Notification permissions not granted');
          return;
        }

        const tokenData = await Notifications.getDevicePushTokenAsync();
        const token = tokenData.data;
        if (!token) return;

        await usersApi.registerFcmToken(token);
        tokenRef.current = token;
        registeredRef.current = true;
        console.log('FCM token registered to Neon:', Platform.OS);
      } catch (err) {
        if (isFcmNativeUnavailable(err)) {
          console.warn(
            'Native push unavailable on this Android build. Add google-services.json, set android.googleServicesFile in app.config.js, then rebuild the dev client. See https://docs.expo.dev/push-notifications/fcm-credentials/'
          );
          return;
        }
        console.error('Failed to register FCM token:', err);
      }
    };

    register();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const sub = Notifications.addPushTokenListener(({ data: token }) => {
      if (!token || !canRegisterNativePush()) return;
      usersApi.registerFcmToken(token).catch((err) => {
        if (isFcmNativeUnavailable(err)) return;
        console.error('Failed to register refreshed FCM token:', err);
      });
      tokenRef.current = token;
    });

    return () => sub.remove();
  }, [userId]);
}
