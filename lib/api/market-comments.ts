import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import { MarketComment } from '@/types';

function mapComment(c: {
  id: string;
  postId: string;
  userId: string;
  text?: string;
  body?: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt?: string;
}): MarketComment {
  return {
    id: c.id,
    postId: c.postId,
    userId: c.userId,
    comment: c.text || c.body || '',
    createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
    userDisplayName: c.displayName,
    userAvatarUrl: c.avatarUrl,
  } as MarketComment;
}

export const marketCommentsApi = {
  list: async (
    postId: string,
    opts: { limit?: number; before?: string | null } = {}
  ): Promise<MarketComment[]> => {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.before) params.set('before', String(opts.before));
    const qs = params.toString();
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
    }>(apiUrl(`/posts/${encodeURIComponent(postId)}/comments${qs ? `?${qs}` : ''}`), {
      method: 'GET',
      requiresAuth: true,
    });
    return (response.comments || []).map(mapComment);
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
        displayName?: string;
        avatarUrl?: string;
        createdAt?: string;
      };
    }>(apiUrl(`/posts/${encodeURIComponent(postId)}/comments`), {
      method: 'POST',
      body: { text: comment.trim() },
      requiresAuth: true,
    });
    return mapComment({ ...response.comment, postId: response.comment.postId || postId });
  },

  delete: async (commentId: string): Promise<void> => {
    await coreCloudClient.request(apiUrl(`/comments/${encodeURIComponent(commentId)}`), {
      method: 'DELETE',
      requiresAuth: true,
    });
  },
};
