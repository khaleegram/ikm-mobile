import * as VideoThumbnails from 'expo-video-thumbnails';

import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import type { MarketPost } from '@/types';

import { auth } from '@/lib/firebase/config';
import { inferFileExtension } from '@/lib/utils/market-media';
import { buildUserMediaPath } from '@/lib/utils/media-path';
import {
  uploadImage,
  uploadImages,
  uploadVideo,
} from '@/lib/utils/image-upload';

/** Video posts need a thumbnail for deal-room/feed cards — capture one from the clip itself when the seller skips picking a cover. */
async function captureVideoThumbnail(videoUri: string): Promise<string | null> {
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 100, quality: 0.7 });
    return uri || null;
  } catch {
    return null;
  }
}

export interface CreateMarketPostData {
  mediaType?: MarketPost['mediaType'];
  images?: string[];
  coverImageUri?: string;
  videoUri?: string;
  videoDurationMs?: number;
  hashtags?: string[];
  price?: number;
  isNegotiable?: boolean;
  title?: string;
  description?: string;
  location?: {
    state?: string;
    city?: string;
  };
  contactMethod?: 'in-app' | 'whatsapp';
}

function requireAuthenticatedUser() {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error('Please log in to publish a post.');
  }
  return user;
}

function normalizeHashtags(value: string[] | undefined): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    : [];
}

function buildLocation(value: CreateMarketPostData['location']) {
  if (!value) return undefined;
  const state = String(value.state || '').trim();
  const city = String(value.city || '').trim();
  if (!state && !city) return undefined;
  return {
    state: state || undefined,
    city: city || undefined,
  };
}

function normalizeApiPost(raw: any): MarketPost {
  return {
    ...raw,
    id: String(raw?.id || ''),
    createdAt: raw?.createdAt ? new Date(raw.createdAt) : new Date(),
    updatedAt: raw?.updatedAt ? new Date(raw.updatedAt) : new Date(),
    expiresAt: raw?.expiresAt ? new Date(raw.expiresAt) : undefined,
  } as MarketPost;
}

/** Deployed API still requires auth on post reads; local API allows public. Prefer token when signed in. */
function postReadRequiresAuth(): boolean {
  return Boolean(auth.currentUser);
}

export const marketPostsApi = {
  async getById(postId: string): Promise<MarketPost | null> {
    const response = await coreCloudClient.request<{ success: boolean; post: MarketPost }>(
      apiUrl(`/posts/${encodeURIComponent(postId)}`),
      { method: 'GET', requiresAuth: postReadRequiresAuth() }
    );
    return response.post ? normalizeApiPost(response.post) : null;
  },

  async getBatch(postIds: string[]): Promise<MarketPost[]> {
    const ids = [...new Set(postIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(
      0,
      50
    );
    if (!ids.length) return [];
    const response = await coreCloudClient.request<{ success: boolean; posts: MarketPost[] }>(
      apiUrl(`/posts/batch?ids=${encodeURIComponent(ids.join(','))}`),
      { method: 'GET', requiresAuth: postReadRequiresAuth() }
    );
    return Array.isArray(response.posts) ? response.posts.map(normalizeApiPost) : [];
  },

  async create(data: CreateMarketPostData, onProgress?: (progress: number) => void): Promise<MarketPost> {
    const user = requireAuthenticatedUser();
    const postId = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const mediaType: MarketPost['mediaType'] =
      data.mediaType || (String(data.videoUri || '').trim() ? 'video' : 'image_gallery');
    const hashtags = normalizeHashtags(data.hashtags);
    const title = String(data.title || '').trim().slice(0, 80) || undefined;
    const description = String(data.description || '').trim() || undefined;
    const location = buildLocation(data.location);
    const contactMethod = data.contactMethod || 'in-app';

    let uploadedImages: string[] = [];
    let uploadedCoverImageUrl = '';
    let uploadedVideoUrl = '';

    if (mediaType === 'image_gallery') {
      const images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
      if (images.length === 0) throw new Error('Please add at least one photo.');
      if (images.length > 20) throw new Error('Maximum 20 photos allowed.');
      onProgress?.(0.05);
      uploadedImages = await uploadImages(images, 'marketPosts', user.uid);
      onProgress?.(0.85);
    } else {
      const videoUri = String(data.videoUri || '').trim();
      if (!videoUri) throw new Error('Please pick a video before publishing.');

      onProgress?.(0.05);
      const videoExtension = inferFileExtension(videoUri, 'mp4');
      const uploadedVideo = await uploadVideo(
        videoUri,
        buildUserMediaPath('marketPosts', user.uid, `post_${postId}.${videoExtension}`),
        (videoProgress) => onProgress?.(0.05 + videoProgress * 0.65)
      );
      uploadedVideoUrl = uploadedVideo.url;
      onProgress?.(0.72);

      const coverImageUri =
        String(data.coverImageUri || '').trim() || (await captureVideoThumbnail(videoUri)) || '';
      if (coverImageUri) {
        const coverExtension = inferFileExtension(coverImageUri, 'jpg');
        const uploadedCover = await uploadImage(
          coverImageUri,
          buildUserMediaPath('marketPosts', user.uid, `cover_${postId}.${coverExtension}`)
        );
        uploadedCoverImageUrl = uploadedCover.url;
        uploadedImages = [uploadedCover.url];
      }
      onProgress?.(0.8);
    }

    const price = Number.isFinite(data.price) ? Number(data.price) : undefined;
    onProgress?.(0.92);

    const response = await coreCloudClient.request<{ success: boolean; post: MarketPost }>(
      apiUrl('/posts'),
      {
        method: 'POST',
        requiresAuth: true,
        body: {
          id: postId,
          mediaType,
          images: uploadedImages,
          coverImageUrl: uploadedCoverImageUrl || uploadedImages[0] || null,
          videoUrl: uploadedVideoUrl || null,
          videoMeta: uploadedVideoUrl
            ? {
                durationMs: Number.isFinite(data.videoDurationMs)
                  ? Number(data.videoDurationMs)
                  : null,
                originalAudioMuted: false,
              }
            : null,
          // No separate soundtrack — audio lives in the uploaded video file.
          soundMeta: null,
          hashtags,
          price: price ?? null,
          isNegotiable: Boolean(price && data.isNegotiable),
          title: title || null,
          description: description || null,
          location: location || null,
          contactMethod,
        },
      }
    );

    onProgress?.(1);
    return normalizeApiPost(response.post);
  },

  async update(postId: string, patch: Record<string, unknown>): Promise<MarketPost> {
    const response = await coreCloudClient.request<{ success: boolean; post: MarketPost }>(
      apiUrl(`/posts/${encodeURIComponent(postId)}`),
      { method: 'PATCH', body: patch, requiresAuth: true }
    );
    return normalizeApiPost(response.post);
  },

  async listByPoster(posterId: string, limit = 60): Promise<MarketPost[]> {
    const id = String(posterId || '').trim();
    if (!id) return [];
    const response = await coreCloudClient.request<{ success: boolean; posts: MarketPost[] }>(
      apiUrl(`/posts?posterId=${encodeURIComponent(id)}&limit=${Math.min(60, Math.max(1, limit))}`),
      { method: 'GET', requiresAuth: postReadRequiresAuth() }
    );
    return Array.isArray(response.posts) ? response.posts.map(normalizeApiPost) : [];
  },

  async like(postId: string): Promise<{ likes: number; isLiked: boolean }> {
    const response = await coreCloudClient.request<any>(apiUrl('/social/like'), {
      method: 'POST',
      body: { postId },
      requiresAuth: true,
    });
    return {
      likes: response.likes,
      isLiked: response.isLiked,
    };
  },

  async delete(postId: string): Promise<void> {
    await coreCloudClient.request(apiUrl(`/posts/${postId}`), {
      method: 'DELETE',
      requiresAuth: true,
    });
  },

  async incrementViews(postId: string): Promise<void> {
    try {
      await coreCloudClient.request(apiUrl('/social/action'), {
        method: 'POST',
        body: { postId, actionType: 'view' },
        requiresAuth: true,
      });
    } catch (error: any) {
      console.warn('Failed to increment views:', error);
    }
  },

  async search(query: string, limit = 50): Promise<MarketPost[]> {
    const q = String(query || '').trim();
    if (!q) return [];
    const response = await coreCloudClient.request<{ success: boolean; posts: MarketPost[] }>(
      apiUrl(`/posts/search?q=${encodeURIComponent(q)}&limit=${limit}`),
      { method: 'GET', requiresAuth: true }
    );
    return Array.isArray(response.posts) ? response.posts.map(normalizeApiPost) : [];
  },

  async listTrendingHashtags(limit = 30): Promise<Array<{ id: string; tag: string; count: number }>> {
    const response = await coreCloudClient.request<{
      success: boolean;
      hashtags: Array<{ id: string; tag: string; count: number }>;
    }>(apiUrl(`/trending-hashtags?limit=${limit}`), {
      method: 'GET',
      requiresAuth: true,
    });
    return Array.isArray(response.hashtags) ? response.hashtags : [];
  },
};
