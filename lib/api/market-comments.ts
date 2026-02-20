// Market Comment API endpoints - Uses Cloud Functions
import { MarketComment } from '@/types';
import { cloudFunctions } from './cloud-functions';

export const marketCommentsApi = {
  // Create comment (uses Cloud Function)
  create: async (postId: string, comment: string): Promise<MarketComment> => {
    if (!comment.trim()) {
      throw new Error('Comment cannot be empty');
    }

    const response = await cloudFunctions.createMarketComment({
      postId,
      comment: comment.trim(),
    });

    return {
      id: response.commentId,
      postId,
      userId: '', // Will be set by backend
      comment: comment.trim(),
      createdAt: new Date(),
    } as MarketComment;
  },

  // Delete comment (uses Cloud Function)
  delete: async (commentId: string): Promise<void> => {
    await cloudFunctions.deleteMarketComment(commentId);
  },
};
