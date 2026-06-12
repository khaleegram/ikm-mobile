import { coreCloudClient } from './core-cloud-client';

const NOTIFICATION_FUNCTIONS = {
  registerFcmToken: 'https://registerfcmtoken-q3rjv54uka-uc.a.run.app',
  unregisterFcmToken: 'https://unregisterfcmtoken-q3rjv54uka-uc.a.run.app',
  getNotifications: 'https://getnotifications-q3rjv54uka-uc.a.run.app',
  getUnreadCount: 'https://getunreadnotificationcount-q3rjv54uka-uc.a.run.app',
  markRead: 'https://marknotificationread-q3rjv54uka-uc.a.run.app',
  markAllRead: 'https://markallnotificationsread-q3rjv54uka-uc.a.run.app',
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
