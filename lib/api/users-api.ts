import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';

export type ApiUserProfile = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  storeName?: string | null;
  avatarUrl?: string | null;
  storeLogoUrl?: string | null;
  photoURL?: string | null;
  role?: string;
  marketLocation?: any;
  marketBuyerLocation?: any;
  marketBuyerPhone?: string | null;
  followerCount?: number;
  followingCount?: number;
};

export const usersApi = {
  async getMe(): Promise<ApiUserProfile> {
    const response = await coreCloudClient.request<{ success: boolean; user: ApiUserProfile }>(
      apiUrl('/users/me'),
      { method: 'GET', requiresAuth: true }
    );
    return response.user;
  },

  async updateMe(patch: Partial<ApiUserProfile>): Promise<ApiUserProfile> {
    const response = await coreCloudClient.request<{ success: boolean; user: ApiUserProfile }>(
      apiUrl('/users/me'),
      { method: 'PATCH', body: patch, requiresAuth: true }
    );
    return response.user;
  },

  async getById(userId: string): Promise<ApiUserProfile> {
    const response = await coreCloudClient.request<{ success: boolean; user: ApiUserProfile }>(
      apiUrl(`/users/${encodeURIComponent(userId)}`),
      { method: 'GET', requiresAuth: true }
    );
    return response.user;
  },

  async registerFcmToken(token: string): Promise<void> {
    await coreCloudClient.request(apiUrl('/users/me/fcm-token'), {
      method: 'POST',
      body: { token },
      requiresAuth: true,
    });
  },
};
