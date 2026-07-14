import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import { MarketComment } from '@/types';

export const marketCommentsApi = {
  list: async (postId: string): Promise<MarketComment[]> => {
    const response = await coreCloudClient.request<{
      success: boolean;
      comments: Array<{
        id: string;
        postId: string;
        userId: string;
        text?: string;
        body?: string;
        displayName?: string;
        avatarUrl?: string;
        createdAt?: string;
      }>;
    }>(apiUrl(`/posts/${encodeURIComponent(postId)}/comments`), {
      method: 'GET',
      requiresAuth: true,
    });
    return (response.comments || []).map(
      (c) =>
        ({
          id: c.id,
          postId: c.postId,
          userId: c.userId,
          comment: c.text || c.body || '',
          createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          userDisplayName: c.displayName,
          userAvatarUrl: c.avatarUrl,
        }) as MarketComment
    );
  },

  create: async (postId: string, comment: string): Promise<MarketComment> => {
    if (!comment.trim()) throw new Error('Comment cannot be empty');
    const response = await coreCloudClient.request<{
      success: boolean;
      comment: {
        id: string;
        postId: string;
        userId: string;
        text?: string;
        body?: string;
        createdAt?: string;
      };
    }>(apiUrl(`/posts/${encodeURIComponent(postId)}/comments`), {
      method: 'POST',
      body: { text: comment.trim() },
      requiresAuth: true,
    });
    const c = response.comment;
    return {
      id: c.id,
      postId: c.postId || postId,
      userId: c.userId,
      comment: c.text || c.body || comment.trim(),
      createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
    } as MarketComment;
  },

  delete: async (commentId: string): Promise<void> => {
    await coreCloudClient.request(apiUrl(`/comments/${encodeURIComponent(commentId)}`), {
      method: 'DELETE',
      requiresAuth: true,
    });
  },
};
