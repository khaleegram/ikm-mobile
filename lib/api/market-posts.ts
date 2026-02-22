// Market Post API endpoints - Uses Cloud Functions
import { MarketPost } from '@/types';
import { cloudFunctions } from './cloud-functions';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';

export interface CreateMarketPostData {
  images: string[]; // 1-20 image URIs (will be converted to base64)
  hashtags?: string[];
  price?: number;
  isNegotiable?: boolean;
  description?: string;
  location?: {
    state?: string;
    city?: string;
  };
  contactMethod?: 'in-app' | 'whatsapp';
}

export const marketPostsApi = {
  // Create Market Post (uses Cloud Function)
  create: async (data: CreateMarketPostData): Promise<MarketPost> => {
    // Convert image URIs to base64
    const imageBase64Array: string[] = [];
    for (const imageUri of data.images) {
      if (imageUri.startsWith('file://') || imageUri.startsWith('asset://')) {
        try {
          const base64 = await convertImageToBase64(imageUri);
          imageBase64Array.push(base64);
        } catch (error: any) {
          console.error('Failed to convert image to base64:', error);
          throw new Error(`Failed to process image: ${error.message}`);
        }
      } else if (imageUri.startsWith('data:')) {
        // Already base64
        imageBase64Array.push(imageUri);
      } else {
        throw new Error('Invalid image URI format');
      }
    }

    if (imageBase64Array.length === 0) {
      throw new Error('At least one image is required');
    }

    if (imageBase64Array.length > 20) {
      throw new Error('Maximum 20 images allowed');
    }

    const response = await cloudFunctions.createMarketPost({
      images: imageBase64Array,
      hashtags: data.hashtags || [],
      price: data.price,
      isNegotiable: Boolean(data.isNegotiable),
      description: data.description,
      location: data.location,
      contactMethod: data.contactMethod || 'in-app',
    });

    return response.post as MarketPost;
  },

  // Like/unlike a post
  like: async (postId: string): Promise<{ likes: number; isLiked: boolean }> => {
    const response = await cloudFunctions.likeMarketPost(postId);
    return {
      likes: response.likes,
      isLiked: response.isLiked,
    };
  },

  // Delete a post (poster only)
  delete: async (postId: string): Promise<void> => {
    await cloudFunctions.deleteMarketPost(postId);
  },

  // Increment view count (can be called by guests)
  incrementViews: async (postId: string): Promise<void> => {
    try {
      await cloudFunctions.incrementPostViews(postId);
    } catch (error: any) {
      // Silently fail for view increments (not critical)
      console.warn('Failed to increment views:', error);
    }
  },
};
