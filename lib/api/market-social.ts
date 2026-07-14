import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import { auth } from '@/lib/firebase/config';

function requireAuthenticatedUserId(): string {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Please log in to continue.');
  return userId;
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

export const marketSocialApi = {
  async followUser(targetUserId: string) {
    requireAuthenticatedUserId();
    const followedId = normalizeUid(targetUserId);
    if (!followedId) throw new Error('User not found.');
    await coreCloudClient.request(apiUrl('/social/follow'), {
      method: 'POST',
      body: { userId: followedId },
      requiresAuth: true,
    });
  },

  async unfollowUser(targetUserId: string) {
    requireAuthenticatedUserId();
    const followedId = normalizeUid(targetUserId);
    if (!followedId) return;
    await coreCloudClient.request(apiUrl(`/social/follow/${encodeURIComponent(followedId)}`), {
      method: 'DELETE',
      requiresAuth: true,
    });
  },

  async setFollowState(targetUserId: string, shouldFollow: boolean) {
    if (shouldFollow) return this.followUser(targetUserId);
    return this.unfollowUser(targetUserId);
  },

  async toggleFollowUser(targetUserId: string, isFollowing: boolean) {
    if (isFollowing) return this.unfollowUser(targetUserId);
    return this.followUser(targetUserId);
  },

  async isFollowing(targetUserId: string): Promise<boolean> {
    const followedId = normalizeUid(targetUserId);
    if (!followedId) return false;
    const response = await coreCloudClient.request<{ success: boolean; following: boolean }>(
      apiUrl(`/social/following/${encodeURIComponent(followedId)}`),
      { method: 'GET', requiresAuth: true }
    );
    return Boolean(response.following);
  },

  async listFollowingIds(): Promise<string[]> {
    const response = await coreCloudClient.request<{ success: boolean; ids: string[] }>(
      apiUrl('/social/following'),
      { method: 'GET', requiresAuth: true }
    );
    return Array.isArray(response.ids) ? response.ids : [];
  },

  async savePost(postId: string) {
    requireAuthenticatedUserId();
    await coreCloudClient.request(apiUrl('/social/save'), {
      method: 'POST',
      body: { postId },
      requiresAuth: true,
    });
  },

  async unsavePost(postId: string) {
    requireAuthenticatedUserId();
    await coreCloudClient.request(apiUrl(`/social/save/${encodeURIComponent(postId)}`), {
      method: 'DELETE',
      requiresAuth: true,
    });
  },

  async listSaved(): Promise<{ ids: string[]; posts: any[] }> {
    const response = await coreCloudClient.request<{
      success: boolean;
      ids: string[];
      posts: any[];
    }>(apiUrl('/social/saved'), { method: 'GET', requiresAuth: true });
    return {
      ids: Array.isArray(response.ids) ? response.ids : [],
      posts: Array.isArray(response.posts) ? response.posts : [],
    };
  },

  async blockUser(targetUserId: string) {
    requireAuthenticatedUserId();
    const blockedId = normalizeUid(targetUserId);
    if (!blockedId) throw new Error('User not found.');
    await coreCloudClient.request(apiUrl('/social/block'), {
      method: 'POST',
      body: { userId: blockedId },
      requiresAuth: true,
    });
  },

  async unblockUser(targetUserId: string) {
    requireAuthenticatedUserId();
    const blockedId = normalizeUid(targetUserId);
    if (!blockedId) return;
    await coreCloudClient.request(apiUrl(`/social/block/${encodeURIComponent(blockedId)}`), {
      method: 'DELETE',
      requiresAuth: true,
    });
  },

  async listBlockedIds(): Promise<string[]> {
    const response = await coreCloudClient.request<{ success: boolean; ids: string[] }>(
      apiUrl('/social/blocked'),
      { method: 'GET', requiresAuth: true }
    );
    return Array.isArray(response.ids) ? response.ids : [];
  },

  async report(input: {
    targetType: 'post' | 'sound' | 'user';
    targetId: string;
    reason: string;
    details?: string;
  }) {
    // Reports stay on Cloud Functions / admin for now — deferred commerce/admin phase.
    const { marketSocialApiLegacyReport } = await import('./market-social-report');
    return marketSocialApiLegacyReport(input);
  },
};
