import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';

const NOTIFICATION_FUNCTIONS = {
  registerFcmToken: cloudFunctionUrl('registerFcmToken'),
  unregisterFcmToken: cloudFunctionUrl('unregisterFcmToken'),
  getNotifications: cloudFunctionUrl('getNotifications'),
  getUnreadCount: cloudFunctionUrl('getUnreadNotificationCount'),
  markRead: cloudFunctionUrl('markNotificationRead'),
  markAllRead: cloudFunctionUrl('markAllNotificationsRead'),
};

export const notificationsApi = {
  registerFcmToken: async (token: string, platform: 'ios' | 'android'): Promise<void> => {
    await coreCloudClient.request(NOTIFICATION_FUNCTIONS.registerFcmToken, {
      method: 'POST',
      body: { token, platform },
      requiresAuth: true,
    });
  },

  unregisterFcmToken: async (token: string): Promise<void> => {
    await coreCloudClient.request(NOTIFICATION_FUNCTIONS.unregisterFcmToken, {
      method: 'POST',
      body: { token },
      requiresAuth: true,
    });
  },

  getNotifications: async (params?: { limit?: number; startAfter?: string }): Promise<{ notifications: any[]; hasMore: boolean }> => {
    return coreCloudClient.request(NOTIFICATION_FUNCTIONS.getNotifications, {
      method: 'POST',
      body: params || {},
      requiresAuth: true,
    });
  },

  getUnreadCount: async (): Promise<{ count: number }> => {
    return coreCloudClient.request(NOTIFICATION_FUNCTIONS.getUnreadCount, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  },

  markRead: async (notificationId: string): Promise<void> => {
    await coreCloudClient.request(NOTIFICATION_FUNCTIONS.markRead, {
      method: 'POST',
      body: { notificationId },
      requiresAuth: true,
    });
  },

  markAllRead: async (): Promise<{ success: boolean; count: number }> => {
    return coreCloudClient.request(NOTIFICATION_FUNCTIONS.markAllRead, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  },
};
