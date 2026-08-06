import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';

const REVIEW_FUNCTIONS = {
  submitReview: cloudFunctionUrl('submitReview'),
  getSellerReviews: cloudFunctionUrl('getSellerReviews'),
  getReviewForOrder: cloudFunctionUrl('getReviewForOrder'),
};

export const reviewsApi = {
  submit: async (params: {
    orderId: string;
    rating: number;
    text?: string;
  }): Promise<{ success: boolean; reviewId: string; averageRating: number; reviewCount: number }> => {
    return coreCloudClient.request(REVIEW_FUNCTIONS.submitReview, {
      method: 'POST',
      body: params,
      requiresAuth: true,
    });
  },

  getSellerReviews: async (params: { sellerId: string; limit?: number; startAfter?: string }): Promise<{ reviews: any[]; hasMore: boolean }> => {
    return coreCloudClient.request(REVIEW_FUNCTIONS.getSellerReviews, {
      method: 'POST',
      body: params,
      requiresAuth: true,
    });
  },

  getForOrder: async (orderId: string): Promise<{ review: any | null }> => {
    return coreCloudClient.request(REVIEW_FUNCTIONS.getReviewForOrder, {
      method: 'POST',
      body: { orderId },
      requiresAuth: true,
    });
  },
};
