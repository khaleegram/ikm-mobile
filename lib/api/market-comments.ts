import { coreCloudClient } from './core-cloud-client';
import { MarketComment } from '@/types';

const MARKET_COMMENT_FUNCTIONS = {
  createMarketComment: 'https://createmarketcomment-q3rjv54uka-uc.a.run.app',
  deleteMarketComment: 'https://deletemarketcomment-q3rjv54uka-uc.a.run.app',
};

export const marketCommentsApi = {
  // Create comment
  create: async (postId: string, comment: string): Promise<MarketComment> => {
    if (!comment.trim()) {
      throw new Error('Comment cannot be empty');
    }

    const response = await coreCloudClient.request<{ success: boolean; commentId: string }>(MARKET_COMMENT_FUNCTIONS.createMarketComment, {
      method: 'POST',
      body: {
        postId,
        comment: comment.trim(),
      },
      requiresAuth: true,
    });

    return {
      id: response.commentId,
      postId,
      userId: '', // Will be set by backend
      comment: comment.trim(),
      createdAt: new Date(),
    } as MarketComment;
  },

  // Delete comment
  delete: async (commentId: string): Promise<void> => {
    await coreCloudClient.request(MARKET_COMMENT_FUNCTIONS.deleteMarketComment, {
      method: 'POST',
      body: { commentId },
      requiresAuth: true,
    });
  },
};

