// Push notifications hook
import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform, AppState } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { getAppVariant } from '../utils/app-variant';

// Configure notification behavior with custom handling
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as NotificationData;
    
    // Customize behavior based on notification type
    const config = getNotificationConfig(data.type);
    
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: config.sound,
      shouldSetBadge: true,
      priority: config.priority,
    };
  },
});

export interface NotificationData {
  orderId?: string;
  productId?: string;
  chatId?: string;
  peerId?: string;
  type: 'new_order' | 'order_update' | 'order_cancelled' | 'low_stock' | 'chat_message' | 'general';
  status?: string;
  amount?: number;
  [key: string]: any;
}

export interface NotificationConfig {
  sound: boolean;
  priority: Notifications.AndroidNotificationPriority;
  color?: string;
  icon?: string;
}

/**
 * Get notification configuration based on type
 */
function getNotificationConfig(type: NotificationData['type']): NotificationConfig {
  switch (type) {
    case 'new_order':
      return {
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        color: '#28A745',
        icon: '💰',
      };
    case 'order_update':
      return {
        sound: true,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        color: '#17A2B8',
        icon: '📦',
      };
    case 'order_cancelled':
      return {
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        color: '#DC3545',
        icon: '❌',
      };
    case 'low_stock':
      return {
        sound: true,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        color: '#FFC107',
        icon: '⚠️',
      };
    case 'chat_message':
      return {
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        color: '#A67C52',
        icon: '💬',
      };
    default:
      return {
        sound: true,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        color: '#007AFF',
        icon: '🔔',
      };
  }
}

export function useNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
  const appState = useRef(AppState.currentState);
  const variant = getAppVariant();

  useEffect(() => {
    // Market app does not need seller/admin push navigation listeners at root startup.
    // This avoids unnecessary navigation updates during initial mount.
    if (variant === 'market') {
      return;
    }

    // Track app state to prevent operations when backgrounded
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      appState.current = nextAppState;
    });

    // Register for push notifications
    registerForPushNotificationsAsync().then((token) => {
      setExpoPushToken(token);
    }).catch((error) => {
      console.error('Error registering for push notifications:', error);
    });

    // Listen for notifications received while app is foregrounded
    try {
      notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
        // Only update state if app is in foreground
        if (appState.current === 'active') {
          setNotification(notification);
        }
      });
    } catch (error) {
      console.error('Error setting up notification listener:', error);
    }

    // Listen for user tapping on notification
    try {
      responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
        // Only handle navigation if app is active or becoming active
        if (appState.current === 'active' || appState.current === 'background') {
          try {
            const data = response.notification.request.content.data as NotificationData;
            // Handle navigation based on notification type
            handleNotificationNavigation(data);
          } catch (error) {
            console.error('Error handling notification navigation:', error);
          }
        }
      });
    } catch (error) {
      console.error('Error setting up notification response listener:', error);
    }

    return () => {
      subscription?.remove();
      try {
        if (notificationListener.current) {
          notificationListener.current.remove();
        }
        if (responseListener.current) {
          responseListener.current.remove();
        }
      } catch (error) {
        console.error('Error removing notification listeners:', error);
      }
    };
  }, [variant]);

  return {
    expoPushToken,
    notification,
  };
}

/**
 * Register for push notifications
 */
async function registerForPushNotificationsAsync(): Promise<string | null> {
  let token: string | null = null;

  if (Platform.OS === 'android') {
    // Create multiple notification channels for different types
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Orders',
      description: 'Notifications for new orders and order updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#28A745',
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Alerts',
      description: 'Important alerts like low stock',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      lightColor: '#FFC107',
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('general', {
      name: 'General',
      description: 'General notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      lightColor: '#007AFF',
      sound: 'default',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return null;
  }
  
  try {
    // Get Expo push token
    // In Expo Go, this uses Expo's push notification service
    // In dev builds/production, it may use FCM if configured
    // Pass projectId to avoid FCM errors if FCM isn't configured
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    
    token = tokenData.data;
  } catch (error: any) {
    // Handle FCM initialization errors gracefully
    // This can happen if FCM credentials aren't configured
    if (error?.message?.includes('FirebaseApp') || error?.message?.includes('FCM')) {
      console.warn('Push notifications not fully configured (FCM credentials missing). Local notifications will still work.');
    } else {
      console.log('Error getting Expo push token:', error);
    }
    // Continue without push token - local notifications will still work
    return null;
  }

  return token;
}

/**
 * Handle notification navigation
 */
function handleNotificationNavigation(data: NotificationData) {
  try {
    // Check if router is available
    if (!router) {
      console.warn('Router not available for notification navigation');
      return;
    }

    // Only navigate if app is in a valid state
    if (AppState.currentState !== 'active' && AppState.currentState !== 'background') {
      return;
    }

    if (data.type === 'new_order' && data.orderId) {
      router.push(`../orders/${data.orderId}` as any);
    } else if (data.type === 'order_update' && data.orderId) {
      router.push(`../orders/${data.orderId}` as any);
    } else if (data.type === 'low_stock' && data.productId) {
      router.push(`../products/${data.productId}` as any);
    }
  } catch (error) {
    console.error('Error in notification navigation:', error);
  }
}

/**
 * Schedule a local notification with custom styling
 */
export async function scheduleNotification(
  title: string,
  body: string,
  data?: NotificationData,
  options?: {
    subtitle?: string;
    categoryIdentifier?: string;
  }
): Promise<string> {
  const config = data ? getNotificationConfig(data.type) : {
    sound: true,
    priority: Notifications.AndroidNotificationPriority.DEFAULT,
  };

  // Determine channel based on type
  let channelId = 'general';
  if (data) {
    if (data.type === 'new_order' || data.type === 'order_update' || data.type === 'order_cancelled') {
      channelId = 'orders';
    } else if (data.type === 'low_stock') {
      channelId = 'alerts';
    } else if (data.type === 'chat_message') {
      channelId = 'messages';
    }
  }

  const notificationContent: Notifications.NotificationContentInput = {
    title,
    body,
    data,
    sound: config.sound,
    subtitle: options?.subtitle,
    categoryIdentifier: options?.categoryIdentifier || data?.type || 'general',
    ...(Platform.OS === 'android' && {
      channelId,
      color: config.color,
      priority: config.priority,
      smallIcon: config.icon,
    }),
    ...(Platform.OS === 'ios' && {
      sound: 'default',
      badge: 1,
    }),
  };

  return await Notifications.scheduleNotificationAsync({
    content: notificationContent,
    trigger: null, // Show immediately
  });
}

/**
 * Schedule a notification with custom icon and color
 */
export async function scheduleCustomNotification(
  title: string,
  body: string,
  data: NotificationData,
  customConfig?: Partial<NotificationConfig>
): Promise<string> {
  const config = { ...getNotificationConfig(data.type), ...customConfig };
  
  let channelId = 'general';
  if (data.type === 'new_order' || data.type === 'order_update' || data.type === 'order_cancelled') {
    channelId = 'orders';
  } else if (data.type === 'low_stock') {
    channelId = 'alerts';
  } else if (data.type === 'chat_message') {
    channelId = 'messages';
  }

  return await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: config.sound,
      ...(Platform.OS === 'android' && {
        channelId,
        color: config.color,
        priority: config.priority,
        smallIcon: config.icon,
      }),
    },
    trigger: null,
  });
}

/**
 * Cancel a notification
 */
export async function cancelNotification(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

/**
 * Cancel all notifications
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

