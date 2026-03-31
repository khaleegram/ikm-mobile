import { coreCloudClient } from './core-cloud-client';
import type { MarketPost, MarketSound } from '@/types';
import {
  collection,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { auth, firestore } from '@/lib/firebase/config';
import {
  buildOriginalSoundTitle,
  buildUploadedSoundTitle,
  inferFileExtension,
} from '@/lib/utils/market-media';
import {
  uploadAudio,
  uploadImage,
  uploadImages,
  uploadVideo,
} from '@/lib/utils/image-upload';

const MARKET_POST_FUNCTIONS = {
  likeMarketPost: 'https://likemarketpost-q3rjv54uka-uc.a.run.app',
  deleteMarketPost: 'https://deletemarketpost-q3rjv54uka-uc.a.run.app',
  incrementPostViews: 'https://incrementpostviews-q3rjv54uka-uc.a.run.app',
};


export interface CreateMarketPostSoundSelection {
  mode?: 'original' | 'existing' | 'uploaded' | 'none';
  existingSound?: MarketSound | null;
  uploadedAudioUri?: string | null;
  soundTitle?: string;
  startMs?: number;
  soundVolume?: number;
  originalAudioVolume?: number;
  useOriginalVideoAudio?: boolean;
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
  description?: string;
  location?: {
    state?: string;
    city?: string;
  };
  contactMethod?: 'in-app' | 'whatsapp';
  soundSelection?: CreateMarketPostSoundSelection;
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

function clampUnitVolume(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
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

function buildLocalMarketPostSnapshot(
  id: string,
  data: {
    posterId: string;
    mediaType: MarketPost['mediaType'];
    images: string[];
    coverImageUrl?: string;
    videoUrl?: string;
    videoDurationMs?: number;
    hashtags: string[];
    price?: number;
    isNegotiable?: boolean;
    description?: string;
    location?: { state?: string; city?: string };
    contactMethod: 'in-app' | 'whatsapp';
    soundMeta?: MarketPost['soundMeta'];
  }
): MarketPost {
  const now = new Date();
  return {
    id,
    posterId: data.posterId,
    mediaType: data.mediaType,
    images: data.images,
    coverImageUrl: data.coverImageUrl,
    videoUrl: data.videoUrl,
    videoMeta: data.videoUrl
      ? {
          durationMs: data.videoDurationMs,
          originalAudioMuted:
            Boolean(data.soundMeta && data.soundMeta.useOriginalVideoAudio === false) &&
            clampUnitVolume(data.soundMeta?.originalAudioVolume, 0) <= 0,
        }
      : undefined,
    soundMeta: data.soundMeta,
    hashtags: data.hashtags,
    price: data.price,
    isNegotiable: Boolean(data.isNegotiable),
    description: data.description,
    location: data.location,
    contactMethod: data.contactMethod,
    likes: 0,
    views: 0,
    comments: 0,
    likedBy: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export const marketPostsApi = {
  async create(data: CreateMarketPostData): Promise<MarketPost> {
    const user = requireAuthenticatedUser();
    const postRef = doc(collection(firestore, 'marketPosts'));
    const mediaType: MarketPost['mediaType'] =
      data.mediaType || (String(data.videoUri || '').trim() ? 'video' : 'image_gallery');
    const hashtags = normalizeHashtags(data.hashtags);
    const description = String(data.description || '').trim() || undefined;
    const location = buildLocation(data.location);
    const contactMethod = data.contactMethod || 'in-app';

    let uploadedImages: string[] = [];
    let uploadedCoverImageUrl = '';
    let uploadedVideoUrl = '';
    let soundMeta: MarketPost['soundMeta'] | undefined;
    const batch = writeBatch(firestore);

    if (mediaType === 'image_gallery') {
      const images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
      if (images.length === 0) {
        throw new Error('Please add at least one photo.');
      }
      if (images.length > 20) {
        throw new Error('Maximum 20 photos allowed.');
      }

      uploadedImages = await uploadImages(images, 'marketPosts', user.uid);
    } else {
      const videoUri = String(data.videoUri || '').trim();
      if (!videoUri) {
        throw new Error('Please pick a video before publishing.');
      }

      const videoExtension = inferFileExtension(videoUri, 'mp4');
      const uploadedVideo = await uploadVideo(
        videoUri,
        `marketPosts/${user.uid}/post_${postRef.id}.${videoExtension}`
      );
      uploadedVideoUrl = uploadedVideo.url;

      const coverImageUri = String(data.coverImageUri || '').trim();
      if (coverImageUri) {
        const coverExtension = inferFileExtension(coverImageUri, 'jpg');
        const uploadedCover = await uploadImage(
          coverImageUri,
          `marketPosts/${user.uid}/cover_${postRef.id}.${coverExtension}`
        );
        uploadedCoverImageUrl = uploadedCover.url;
        uploadedImages = [uploadedCover.url];
      }

      const soundSelection = data.soundSelection || { mode: 'original' };
      const soundMode = soundSelection.mode || 'original';
      const soundVolume = clampUnitVolume(soundSelection.soundVolume, soundMode === 'original' ? 1 : 0.9);
      const originalAudioVolume = clampUnitVolume(
        soundSelection.originalAudioVolume,
        soundMode === 'original' ? 1 : 0
      );
      const startMs = Number.isFinite(soundSelection.startMs)
        ? Math.max(0, Number(soundSelection.startMs))
        : 0;
      const useOriginalVideoAudio =
        soundMode === 'original' ? true : Boolean(soundSelection.useOriginalVideoAudio);

      if (soundMode === 'existing' && soundSelection.existingSound?.id) {
        const existingSound = soundSelection.existingSound;
        const soundId = existingSound.id!; // Checked in if condition
        
        soundMeta = {
          soundId,
          title: existingSound.title,
          sourceUri: existingSound.sourceUri,
          sourceType: existingSound.sourceType,
          artworkUrl: existingSound.artworkUrl || uploadedCoverImageUrl || undefined,
          durationMs: existingSound.durationMs,
          startMs,
          soundVolume,
          originalAudioVolume,
          useOriginalVideoAudio,
        };

        batch.set(
          doc(firestore, 'marketSounds', soundId),
          {
            usageCount: increment(1),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else if (soundMode === 'uploaded' && soundSelection.uploadedAudioUri) {
        const audioExtension = inferFileExtension(soundSelection.uploadedAudioUri, 'm4a');
        const uploadedAudio = await uploadAudio(
          soundSelection.uploadedAudioUri,
          `marketSounds/${user.uid}/sound_${postRef.id}.${audioExtension}`
        );
        const soundRef = doc(collection(firestore, 'marketSounds'));
        const soundTitle =
          String(soundSelection.soundTitle || '').trim() ||
          buildUploadedSoundTitle(soundSelection.uploadedAudioUri, user.displayName || user.email);

        batch.set(soundRef, {
          title: soundTitle,
          createdBy: user.uid,
          creatorName: String(user.displayName || user.email || '').trim() || null,
          sourceType: 'uploaded',
          sourceUri: uploadedAudio.url,
          artworkUrl: uploadedCoverImageUrl || null,
          durationMs: null,
          usageCount: 1,
          savedCount: 0,
          rightsStatus: 'owned',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        soundMeta = {
          soundId: soundRef.id,
          title: soundTitle,
          sourceUri: uploadedAudio.url,
          sourceType: 'uploaded',
          artworkUrl: uploadedCoverImageUrl || undefined,
          startMs,
          soundVolume,
          originalAudioVolume,
          useOriginalVideoAudio,
        };
      } else if (soundMode !== 'none') {
        const soundRef = doc(collection(firestore, 'marketSounds'));
        const soundTitle = buildOriginalSoundTitle(user.displayName || user.email);

        batch.set(soundRef, {
          title: soundTitle,
          createdBy: user.uid,
          creatorName: String(user.displayName || user.email || '').trim() || null,
          sourceType: 'original',
          sourceUri: uploadedVideoUrl,
          artworkUrl: uploadedCoverImageUrl || null,
          durationMs: Number.isFinite(data.videoDurationMs) ? Number(data.videoDurationMs) : null,
          usageCount: 1,
          savedCount: 0,
          rightsStatus: 'owned',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        soundMeta = {
          soundId: soundRef.id,
          title: soundTitle,
          sourceUri: uploadedVideoUrl,
          sourceType: 'original',
          artworkUrl: uploadedCoverImageUrl || undefined,
          durationMs: Number.isFinite(data.videoDurationMs) ? Number(data.videoDurationMs) : undefined,
          startMs,
          soundVolume,
          originalAudioVolume,
          useOriginalVideoAudio: true,
        };
      }
    }

    const price = Number.isFinite(data.price) ? Number(data.price) : undefined;
    const payload = {
      posterId: user.uid,
      mediaType,
      images: uploadedImages,
      coverImageUrl: uploadedCoverImageUrl || null,
      videoUrl: uploadedVideoUrl || null,
      videoMeta: uploadedVideoUrl
        ? {
            durationMs: Number.isFinite(data.videoDurationMs) ? Number(data.videoDurationMs) : null,
            originalAudioMuted:
              clampUnitVolume(soundMeta?.originalAudioVolume, 0) <= 0 &&
              soundMeta?.useOriginalVideoAudio !== true,
          }
        : null,
      soundMeta: soundMeta || null,
      hashtags,
      price: price ?? null,
      isNegotiable: Boolean(price && data.isNegotiable),
      description: description || null,
      location: location || null,
      contactMethod,
      likes: 0,
      views: 0,
      comments: 0,
      likedBy: [],
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    batch.set(postRef, payload);

    hashtags.forEach((tag) => {
      batch.set(
        doc(firestore, 'trendingHashtags', tag),
        {
          tag,
          count: increment(1),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();

    return buildLocalMarketPostSnapshot(postRef.id, {
      posterId: user.uid,
      mediaType,
      images: uploadedImages,
      coverImageUrl: uploadedCoverImageUrl || undefined,
      videoUrl: uploadedVideoUrl || undefined,
      videoDurationMs: Number.isFinite(data.videoDurationMs) ? Number(data.videoDurationMs) : undefined,
      hashtags,
      price,
      isNegotiable: Boolean(price && data.isNegotiable),
      description,
      location,
      contactMethod,
      soundMeta,
    });
  },

  async like(postId: string): Promise<{ likes: number; isLiked: boolean }> {
    const response = await coreCloudClient.request<any>(MARKET_POST_FUNCTIONS.likeMarketPost, {
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
    await coreCloudClient.request(MARKET_POST_FUNCTIONS.deleteMarketPost, {
      method: 'POST',
      body: { postId },
      requiresAuth: true,
    });
  },

  async incrementViews(postId: string): Promise<void> {
    try {
      await coreCloudClient.request(MARKET_POST_FUNCTIONS.incrementPostViews, {
        method: 'POST',
        body: { postId },
        requiresAuth: true,
      });
    } catch (error: any) {
      console.warn('Failed to increment views:', error);
    }
  },
};

