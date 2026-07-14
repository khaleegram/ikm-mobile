import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { notificationsApi } from '@/lib/api/notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useFcmTokenRegistration(userId: string | null) {
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      registeredRef.current = false;
      return;
    }

    if (registeredRef.current) return;

    const register = async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Notification permissions not granted');
          return;
        }

        const tokenData = await Notifications.getDevicePushTokenAsync();
        const token = tokenData.data;

        if (!token) return;

        const platform = Platform.OS === 'android' ? 'android' : 'ios';

        await notificationsApi.registerFcmToken(token, platform);
        try {
          const { usersApi } = await import('@/lib/api/users-api');
          await usersApi.registerFcmToken(token);
        } catch {
          // Postgres token registry is best-effort alongside CF registration.
        }
        registeredRef.current = true;

        console.log('FCM token registered:', platform);
      } catch (err) {
        console.error('Failed to register FCM token:', err);
      }
    };

    register();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const sub = Notifications.addPushTokenListener(({ data: token, type }) => {
      if (!token) return;
      const platform = type === 'android' ? 'android' : 'ios';
      notificationsApi.registerFcmToken(token, platform).catch((err) =>
        console.error('Failed to register refreshed FCM token:', err)
      );
    });

    return () => sub.remove();
  }, [userId]);
}
