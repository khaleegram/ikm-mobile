/**
 * Cloud Functions for IKM Marketplace
 * 
 * This file contains all HTTP callable functions that can be used
 * from both the web app and mobile app.
 * 
 * Authentication: Functions use Firebase ID token from Authorization header
 * Format: Authorization: Bearer <firebase-id-token>
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { onObjectFinalized } from 'firebase-functions/v2/storage';

// Initialize Firebase Admin
admin.initializeApp();

// CORS configuration - allow all origins for mobile/web apps
const corsHandler = cors({ origin: true });

// Define Firebase Secret for Paystack

// Import utilities
import {
    requireAuth,
    sendError,
    sendResponse,
} from './utils';

// ============================================================================
// PAYMENT FUNCTIONS
// ============================================================================




function asNonEmptyString(value: unknown): string {
  return String(value ?? '').trim();
}


const execFileAsync = promisify(execFile);

function safeTmpFile(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(os.tmpdir(), cleaned);
}

function parseMarketPostIdFromVideoPath(objectName: string): { ownerId: string | null; postId: string | null } {
  // Expected: marketPosts/{uid}/post_{postId}.mp4 (from mobile app)
  const normalized = String(objectName || '').trim();
  const parts = normalized.split('/');
  if (parts.length < 3) return { ownerId: null, postId: null };
  if (parts[0] !== 'marketPosts') return { ownerId: null, postId: null };
  const ownerId = parts[1] || null;
  const fileName = parts.slice(2).join('/');
  const match = fileName.match(/post_([a-zA-Z0-9_-]+)\./);
  const postId = match?.[1] ? String(match[1]).trim() : null;
  return { ownerId, postId };
}

async function ensureDirExists(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

/**
 * Storage trigger: when a Market Street video is uploaded, extract audio to an m4a file
 * and update:
 * - `marketSounds/{soundId}.sourceUri` to point to the extracted audio
 * - `marketPosts/{postId}.soundMeta.sourceUri` to match (for reuse/detail preview)
 *
 * This makes "Original sound" a real reusable audio asset while leaving feed playback
 * free to use the video’s own audio track.
 */
export const extractMarketSoundFromMarketVideo = onObjectFinalized(
  { cpu: 2, memory: '1GiB', timeoutSeconds: 300 },
  async (event) => {
    const objectName = String(event.data.name || '').trim();
    const contentType = String(event.data.contentType || '').trim().toLowerCase();
    if (!objectName) return;
    if (!contentType.startsWith('video/')) return;
    if (!objectName.startsWith('marketPosts/')) return;
    if (!objectName.includes('/post_')) return;

    const { ownerId, postId } = parseMarketPostIdFromVideoPath(objectName);
    if (!ownerId || !postId) return;

    const bucket = admin.storage().bucket(event.data.bucket);
    const firestore = admin.firestore();

    // Load post to find associated sound doc (created by client during publish)
    const postRef = firestore.collection('marketPosts').doc(postId);
    const postSnap = await postRef.get();
    if (!postSnap.exists) return;
    const postData = postSnap.data() || {};
    const soundId = String((postData as any)?.soundMeta?.soundId || '').trim();
    const soundType = String((postData as any)?.soundMeta?.sourceType || '').trim().toLowerCase();
    if (!soundId) return;
    if (soundType !== 'original') return;

    // Download video to tmp and extract audio with ffmpeg
    const ffmpegPath = require('ffmpeg-static') as string | null;
    if (!ffmpegPath) {
      console.error('ffmpeg-static not available; cannot extract audio');
      return;
    }

    const tmpDir = path.join(os.tmpdir(), `ikm_sound_${postId}`);
    await ensureDirExists(tmpDir);
    const tmpVideoPath = safeTmpFile(`market_post_${postId}.mp4`);
    const tmpAudioPath = safeTmpFile(`market_sound_${postId}.m4a`);

    try {
      await bucket.file(objectName).download({ destination: tmpVideoPath });

      // Extract audio track (AAC in m4a container) with a reasonable bitrate.
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i',
        tmpVideoPath,
        '-vn',
        '-acodec',
        'aac',
        '-b:a',
        '128k',
        tmpAudioPath,
      ]);

      const destPath = `marketSounds/${ownerId}/sound_${postId}.m4a`;
      await bucket.upload(tmpAudioPath, {
        destination: destPath,
        metadata: {
          contentType: 'audio/mp4',
          cacheControl: 'public,max-age=31536000',
        },
      });

      // Signed URL is not desired; use public download URL
      const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
        event.data.bucket
      )}/o/${encodeURIComponent(destPath)}?alt=media`;

      await firestore.runTransaction(async (tx) => {
        const soundRef = firestore.collection('marketSounds').doc(soundId);
        tx.set(
          soundRef,
          {
            sourceUri: audioUrl,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        tx.set(
          postRef,
          {
            soundMeta: {
              ...(postData as any).soundMeta,
              sourceUri: audioUrl,
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    } catch (error) {
      console.error('Failed to extract/upload market sound audio:', error);
    } finally {
      try {
        await fs.unlink(tmpVideoPath);
      } catch {}
      try {
        await fs.unlink(tmpAudioPath);
      } catch {}
    }
  }
);


// ============================================================================
// ORDER FUNCTIONS
// ============================================================================
// ============================================================================
// SHIPPING FUNCTIONS (PUBLIC - NO AUTH REQUIRED)
// ============================================================================
// ============================================================================
// PAYOUT FUNCTIONS
// ============================================================================
// ============================================================================
// CHAT FUNCTIONS
// ============================================================================

/**
 * Send order message
 */
export const sendOrderMessage = functions.https.onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, message, imageUrl } = request.body;

      if (!orderId) {
        return sendError(response, 'Order ID is required');
      }

      if (!message && !imageUrl) {
        return sendError(response, 'Message or image is required');
      }

      const firestore = admin.firestore();
      const orderDoc = await firestore.collection('orders').doc(orderId).get();

      if (!orderDoc.exists) {
        return sendError(response, 'Order not found', 404);
      }

      const order = orderDoc.data()!;
      if (order.customerId !== auth.uid && order.sellerId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Unauthorized: You do not have access to this order', 403);
      }

      const senderType = order.customerId === auth.uid ? 'customer' : 'seller';

      await firestore.collection('orders').doc(orderId).collection('chat').add({
        orderId,
        senderId: auth.uid,
        senderType,
        message: message || null,
        imageUrl: imageUrl || null,
        isSystemMessage: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error in sendOrderMessage:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// USER FUNCTIONS
// ============================================================================
// ============================================================================
// SEARCH FUNCTIONS (PUBLIC)
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - PRODUCT MANAGEMENT
// ============================================================================
// ============================================================================
// NORTHERN PRODUCT FUNCTIONS (Category-Specific Products)
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - DASHBOARD & ANALYTICS
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - REPORTS
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - MARKETING (DISCOUNT CODES)
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - STORE MANAGEMENT
// ============================================================================
// ============================================================================
// SELLER FUNCTIONS - CUSTOMERS
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - USER MANAGEMENT
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - PLATFORM SETTINGS
// ============================================================================
// ============================================================================
// ADMIN FUNCTIONS - ORDERS & DISPUTES
// ============================================================================
// ============================================================================
// SHIPPING ZONE FUNCTIONS
// ============================================================================
// ============================================================================
// ORDER AVAILABILITY FUNCTIONS
// ============================================================================
// ============================================================================
// PARKS MANAGEMENT FUNCTIONS (ADMIN)
// ============================================================================
// ============================================================================
// EARNINGS FUNCTIONS
// ============================================================================
// ============================================================================
// PAYOUT REQUEST FUNCTIONS
// ============================================================================
// ============================================================================
// SECURITY & ADMIN FUNCTIONS
// ============================================================================
// ============================================================================
// MARKET STREET FUNCTIONS
// ============================================================================

function normalizeMarketHashtags(rawHashtags: unknown): string[] {
  if (!Array.isArray(rawHashtags)) {
    return [];
  }

  const uniqueTags = new Set<string>();

  for (const value of rawHashtags) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = value
      .trim()
      .replace(/^#/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');

    if (!normalized || normalized.length > 30) {
      continue;
    }

    uniqueTags.add(normalized);

    if (uniqueTags.size >= 10) {
      break;
    }
  }

  return Array.from(uniqueTags);
}

function parseBase64Image(imageDataUrl: string): {
  buffer: Buffer;
  extension: string;
  contentType: string;
} {
  const match = imageDataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new Error('Invalid image format. Expected base64 data URL.');
  }

  const mimeSubtype = match[1].toLowerCase();
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer.length) {
    throw new Error('Invalid image payload.');
  }

  const extensionBase = mimeSubtype.split('+')[0] || 'jpeg';
  const extension = extensionBase === 'jpeg' ? 'jpg' : extensionBase;

  return {
    buffer,
    extension,
    contentType: `image/${mimeSubtype}`,
  };
}

async function uploadMarketImage(
  imageDataUrl: string,
  destinationWithoutExt: string,
): Promise<string> {
  const { buffer, extension, contentType } = parseBase64Image(imageDataUrl);
  const storage = admin.storage();
  const bucket = storage.bucket();
  const filePath = `${destinationWithoutExt}.${extension}`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: 'public,max-age=31536000',
    },
  });
  await file.makePublic();

  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

async function adjustTrendingHashtags(hashtags: string[], delta: number): Promise<void> {
  if (!hashtags.length || delta === 0) {
    return;
  }

  const firestore = admin.firestore();

  await Promise.all(
    hashtags.map(async (tag) => {
      const ref = firestore.collection('trendingHashtags').doc(tag);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const existingCount = snapshot.exists ? (snapshot.data()?.count || 0) : 0;
        const nextCount = existingCount + delta;

        if (nextCount <= 0) {
          transaction.delete(ref);
          return;
        }

        const payload: Record<string, unknown> = {
          tag,
          count: nextCount,
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (!snapshot.exists) {
          payload.createdAt = FieldValue.serverTimestamp();
        }

        transaction.set(ref, payload, { merge: true });
      });
    }),
  );
}

async function deleteCollectionInBatches(
  baseQuery: admin.firestore.Query<admin.firestore.DocumentData>,
  batchSize: number = 400,
): Promise<void> {
  while (true) {
    const snapshot = await baseQuery.limit(batchSize).get();
    if (snapshot.empty) {
      return;
    }

    const batch = admin.firestore().batch();
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();

    if (snapshot.size < batchSize) {
      return;
    }
  }
}

/**
 * Create Market Post with image uploads
 */
export const createMarketPost = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const {
        images,
        hashtags,
        price,
        description,
        location,
        contactMethod,
      } = request.body || {};

      if (!Array.isArray(images) || images.length < 1 || images.length > 20) {
        return sendError(response, 'Images are required (1-20 images)', 400);
      }

      const cleanDescription =
        typeof description === 'string' ? description.trim() : '';
      if (cleanDescription.length > 1000) {
        return sendError(response, 'Description is too long (max 1000 characters)', 400);
      }

      let cleanPrice: number | undefined;
      if (price !== undefined && price !== null && price !== '') {
        const parsedPrice = Number(price);
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
          return sendError(response, 'Price must be a positive number', 400);
        }
        cleanPrice = parsedPrice;
      }

      const cleanContactMethod =
        contactMethod === 'whatsapp' ? 'whatsapp' : 'in-app';

      let cleanLocation: { state?: string; city?: string } | undefined;
      if (location && typeof location === 'object') {
        const rawState = typeof location.state === 'string' ? location.state.trim() : '';
        const rawCity = typeof location.city === 'string' ? location.city.trim() : '';
        cleanLocation = {};
        if (rawState) cleanLocation.state = rawState;
        if (rawCity) cleanLocation.city = rawCity;
        if (!cleanLocation.state && !cleanLocation.city) {
          cleanLocation = undefined;
        }
      }

      const normalizedHashtags = normalizeMarketHashtags(hashtags);
      const postRef = firestore.collection('marketPosts').doc();

      const uploadedImages = await Promise.all(
        images.map(async (image: unknown, index: number) => {
          if (typeof image !== 'string' || !image.startsWith('data:image/')) {
            throw new Error(`Invalid image at position ${index + 1}`);
          }

          const destination = `marketPosts/${postRef.id}/${Date.now()}_${index + 1}`;
          return uploadMarketImage(image, destination);
        }),
      );

      const postPayload: Record<string, unknown> = {
        posterId: auth.uid,
        images: uploadedImages,
        hashtags: normalizedHashtags,
        contactMethod: cleanContactMethod,
        likes: 0,
        views: 0,
        comments: 0,
        likedBy: [],
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (cleanPrice !== undefined) {
        postPayload.price = cleanPrice;
      }
      if (cleanDescription) {
        postPayload.description = cleanDescription;
      }
      if (cleanLocation) {
        postPayload.location = cleanLocation;
      }

      await postRef.set(postPayload);

      if (normalizedHashtags.length) {
        await adjustTrendingHashtags(normalizedHashtags, 1);
      }

      const createdPostDoc = await postRef.get();

      return sendResponse(response, {
        success: true,
        postId: postRef.id,
        post: {
          id: postRef.id,
          ...createdPostDoc.data(),
        },
      });
    } catch (error: any) {
      console.error('Error in createMarketPost:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Like or unlike a Market Post
 */
export const likeMarketPost = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { postId } = request.body || {};
      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      let likes = 0;
      let isLiked = false;

      await firestore.runTransaction(async (transaction) => {
        const postDoc = await transaction.get(postRef);
        if (!postDoc.exists) {
          throw new Error('Post not found');
        }

        const postData = postDoc.data() || {};
        const currentLikedBy = Array.isArray(postData.likedBy)
          ? postData.likedBy.filter((id): id is string => typeof id === 'string')
          : [];
        const currentLikes = typeof postData.likes === 'number' ? postData.likes : 0;

        if (currentLikedBy.includes(auth.uid)) {
          const nextLikedBy = currentLikedBy.filter((id) => id !== auth.uid);
          likes = Math.max(0, currentLikes - 1);
          isLiked = false;
          transaction.update(postRef, {
            likedBy: nextLikedBy,
            likes,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        likes = currentLikes + 1;
        isLiked = true;
        transaction.update(postRef, {
          likedBy: [...currentLikedBy, auth.uid],
          likes,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      return sendResponse(response, {
        success: true,
        likes,
        isLiked,
      });
    } catch (error: any) {
      console.error('Error in likeMarketPost:', error);
      const statusCode = error.message === 'Post not found' ? 404 : 500;
      return sendError(response, error.message || 'Internal server error', statusCode);
    }
  });
});

/**
 * Delete Market Post (poster or admin only)
 */
export const deleteMarketPost = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { postId } = request.body || {};
      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return sendError(response, 'Post not found', 404);
      }

      const postData = postDoc.data() || {};
      const posterId = typeof postData.posterId === 'string' ? postData.posterId : '';
      if (!posterId) {
        return sendError(response, 'Invalid post owner', 400);
      }

      if (posterId !== auth.uid && !auth.isAdmin) {
        return sendError(response, 'Forbidden: You can only delete your own posts', 403);
      }

      const hashtags = Array.isArray(postData.hashtags)
        ? normalizeMarketHashtags(postData.hashtags)
        : [];

      await deleteCollectionInBatches(
        firestore.collection('marketPostComments').where('postId', '==', postId),
      );

      const chatSnapshot = await firestore
        .collection('marketChats')
        .where('postId', '==', postId)
        .get();

      for (const chatDoc of chatSnapshot.docs) {
        await deleteCollectionInBatches(chatDoc.ref.collection('messages'));
        await chatDoc.ref.delete();

        try {
          await admin.storage().bucket().deleteFiles({
            prefix: `marketMessages/${chatDoc.id}/`,
          });
        } catch (error) {
          console.warn(`Failed to delete chat images for ${chatDoc.id}:`, error);
        }
      }

      try {
        await admin.storage().bucket().deleteFiles({ prefix: `marketPosts/${postId}/` });
      } catch (error) {
        console.warn(`Failed to delete post images for ${postId}:`, error);
      }

      await postRef.delete();

      if (hashtags.length) {
        await adjustTrendingHashtags(hashtags, -1);
      }

      return sendResponse(response, {
        success: true,
        message: 'Post deleted successfully',
      });
    } catch (error: any) {
      console.error('Error in deleteMarketPost:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Increment post views (public endpoint)
 */
export const incrementPostViews = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const { postId } = request.body || {};
      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return sendError(response, 'Post not found', 404);
      }

      await postRef.update({
        views: FieldValue.increment(1),
      });

      return sendResponse(response, {
        success: true,
        message: 'Views incremented',
      });
    } catch (error: any) {
      console.error('Error in incrementPostViews:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create Market Comment
 */
export const createMarketComment = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { postId, comment } = request.body || {};

      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const cleanComment = typeof comment === 'string' ? comment.trim() : '';
      if (!cleanComment) {
        return sendError(response, 'Comment cannot be empty', 400);
      }
      if (cleanComment.length > 500) {
        return sendError(response, 'Comment is too long (max 500 characters)', 400);
      }

      const firestore = admin.firestore();
      const postRef = firestore.collection('marketPosts').doc(postId);
      const commentRef = firestore.collection('marketPostComments').doc();

      await firestore.runTransaction(async (transaction) => {
        const postDoc = await transaction.get(postRef);
        if (!postDoc.exists) {
          throw new Error('Post not found');
        }

        transaction.set(commentRef, {
          postId,
          userId: auth.uid,
          comment: cleanComment,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.update(postRef, {
          comments: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      return sendResponse(response, {
        success: true,
        commentId: commentRef.id,
        message: 'Comment added successfully',
      });
    } catch (error: any) {
      console.error('Error in createMarketComment:', error);
      const statusCode = error.message === 'Post not found' ? 404 : 500;
      return sendError(response, error.message || 'Internal server error', statusCode);
    }
  });
});

/**
 * Delete Market Comment
 */
export const deleteMarketComment = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { commentId } = request.body || {};

      if (!commentId || typeof commentId !== 'string') {
        return sendError(response, 'Comment ID is required', 400);
      }

      const firestore = admin.firestore();
      const commentRef = firestore.collection('marketPostComments').doc(commentId);

      await firestore.runTransaction(async (transaction) => {
        const commentDoc = await transaction.get(commentRef);
        if (!commentDoc.exists) {
          throw new Error('Comment not found');
        }

        const commentData = commentDoc.data() || {};
        const commentOwnerId =
          typeof commentData.userId === 'string' ? commentData.userId : '';

        if (!commentOwnerId) {
          throw new Error('Invalid comment owner');
        }

        if (commentOwnerId !== auth.uid && !auth.isAdmin) {
          throw new Error('Forbidden: You can only delete your own comments');
        }

        const postId = typeof commentData.postId === 'string' ? commentData.postId : '';
        if (!postId) {
          throw new Error('Invalid post reference');
        }

        const postRef = firestore.collection('marketPosts').doc(postId);
        const postDoc = await transaction.get(postRef);
        const currentComments = postDoc.exists && typeof postDoc.data()?.comments === 'number'
          ? postDoc.data()!.comments
          : 0;

        transaction.delete(commentRef);

        if (postDoc.exists) {
          transaction.update(postRef, {
            comments: Math.max(0, currentComments - 1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      return sendResponse(response, {
        success: true,
        message: 'Comment deleted successfully',
      });
    } catch (error: any) {
      console.error('Error in deleteMarketComment:', error);
      if (error.message === 'Comment not found') {
        return sendError(response, error.message, 404);
      }
      if (error.message?.startsWith('Forbidden')) {
        return sendError(response, error.message, 403);
      }
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Create or fetch Market Chat
 */
export const createMarketChat = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { buyerId, posterId, postId } = request.body || {};

      if (!postId || typeof postId !== 'string') {
        return sendError(response, 'Post ID is required', 400);
      }

      const firestore = admin.firestore();
      const postDoc = await firestore.collection('marketPosts').doc(postId).get();
      if (!postDoc.exists) {
        return sendError(response, 'Post not found', 404);
      }

      const postData = postDoc.data() || {};
      const finalPosterId =
        typeof posterId === 'string' && posterId.trim()
          ? posterId.trim()
          : (typeof postData.posterId === 'string' ? postData.posterId : '');
      const finalBuyerId =
        typeof buyerId === 'string' && buyerId.trim()
          ? buyerId.trim()
          : auth.uid;

      if (!finalPosterId || !finalBuyerId) {
        return sendError(response, 'Invalid chat participants', 400);
      }

      if (finalPosterId === finalBuyerId) {
        return sendError(response, 'Cannot create chat with yourself', 400);
      }

      if (auth.uid !== finalBuyerId && auth.uid !== finalPosterId) {
        return sendError(response, 'Forbidden: You are not a participant', 403);
      }

      const chatId = `${finalBuyerId}_${finalPosterId}_${postId}`;
      const chatRef = firestore.collection('marketChats').doc(chatId);
      const existingChatDoc = await chatRef.get();

      if (existingChatDoc.exists) {
        return sendResponse(response, {
          success: true,
          chatId,
          chat: {
            id: chatId,
            ...existingChatDoc.data(),
          },
        });
      }

      const posterUserDoc = await firestore.collection('users').doc(finalPosterId).get();
      const posterUserData = posterUserDoc.data() || {};
      const posterName =
        (typeof posterUserData.storeName === 'string' && posterUserData.storeName) ||
        (typeof posterUserData.displayName === 'string' && posterUserData.displayName) ||
        'Seller';

      await chatRef.set({
        chatId,
        postId,
        buyerId: finalBuyerId,
        posterId: finalPosterId,
        participants: [finalBuyerId, finalPosterId],
        posterName,
        lastMessage: '',
        lastMessageAt: null,
        unreadCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const createdChatDoc = await chatRef.get();

      return sendResponse(response, {
        success: true,
        chatId,
        chat: {
          id: chatId,
          ...createdChatDoc.data(),
        },
      });
    } catch (error: any) {
      console.error('Error in createMarketChat:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Send Market Message
 */
export const sendMarketMessage = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const {
        chatId,
        message,
        imageUrl,
        paymentLink,
      } = request.body || {};

      if (!chatId || typeof chatId !== 'string') {
        return sendError(response, 'Chat ID is required', 400);
      }

      const cleanMessage = typeof message === 'string' ? message.trim() : '';
      const cleanImage = typeof imageUrl === 'string' ? imageUrl.trim() : '';
      const cleanPaymentLink = typeof paymentLink === 'string' ? paymentLink.trim() : '';

      if (!cleanMessage && !cleanImage) {
        return sendError(response, 'Message or image is required', 400);
      }

      if (cleanMessage.length > 1000) {
        return sendError(response, 'Message is too long (max 1000 characters)', 400);
      }

      let normalizedPaymentLink: string | undefined;
      if (cleanPaymentLink) {
        try {
          const parsed = new URL(cleanPaymentLink);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return sendError(response, 'Invalid payment link URL', 400);
          }
          normalizedPaymentLink = cleanPaymentLink;
        } catch {
          return sendError(response, 'Invalid payment link URL', 400);
        }
      }

      const firestore = admin.firestore();
      const chatRef = firestore.collection('marketChats').doc(chatId);
      let chatDoc = await chatRef.get();

      if (!chatDoc.exists) {
        const segments = chatId.split('_').filter(Boolean);
        let inferredBuyerId = auth.uid;
        let inferredPosterId = '';
        let inferredPostId = '';

        if (segments.length >= 3) {
          inferredBuyerId = segments[0];
          inferredPosterId = segments[1];
          inferredPostId = segments.slice(2).join('_');
        } else if (segments.length === 2) {
          inferredPosterId = segments[0];
          inferredPostId = segments[1];
        } else {
          return sendError(response, 'Chat not found', 404);
        }

        if (!inferredPostId || !inferredPosterId) {
          return sendError(response, 'Invalid chat metadata', 400);
        }

        if (auth.uid !== inferredBuyerId && auth.uid !== inferredPosterId) {
          inferredBuyerId = auth.uid;
        }

        const participants = Array.from(new Set([inferredBuyerId, inferredPosterId]));
        if (participants.length < 2) {
          return sendError(response, 'Invalid chat participants', 400);
        }

        const postDoc = await firestore.collection('marketPosts').doc(inferredPostId).get();
        if (!postDoc.exists) {
          return sendError(response, 'Related post not found', 404);
        }

        await chatRef.set({
          chatId,
          postId: inferredPostId,
          buyerId: inferredBuyerId,
          posterId: inferredPosterId,
          participants,
          lastMessage: '',
          lastMessageAt: null,
          unreadCount: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        chatDoc = await chatRef.get();
      }

      const chatData = chatDoc.data() || {};
      const participants = Array.isArray(chatData.participants)
        ? chatData.participants.filter((id): id is string => typeof id === 'string')
        : [];

      if (!participants.includes(auth.uid)) {
        return sendError(response, 'Forbidden: You are not part of this chat', 403);
      }

      const receiverId = participants.find((id) => id !== auth.uid);
      if (!receiverId) {
        return sendError(response, 'Invalid chat participants', 400);
      }

      const postId = typeof chatData.postId === 'string' ? chatData.postId : '';
      if (!postId) {
        return sendError(response, 'Invalid chat post reference', 400);
      }

      const messageRef = chatRef.collection('messages').doc();
      let uploadedImageUrl: string | undefined;

      if (cleanImage) {
        if (cleanImage.startsWith('data:image/')) {
          uploadedImageUrl = await uploadMarketImage(
            cleanImage,
            `marketMessages/${chatRef.id}/${messageRef.id}_image`,
          );
        } else {
          uploadedImageUrl = cleanImage;
        }
      }

      const messagePayload: Record<string, unknown> = {
        chatId: chatRef.id,
        senderId: auth.uid,
        receiverId,
        postId,
        message: cleanMessage,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      };

      if (uploadedImageUrl) {
        messagePayload.imageUrl = uploadedImageUrl;
      }
      if (normalizedPaymentLink) {
        messagePayload.paymentLink = normalizedPaymentLink;
      }

      await messageRef.set(messagePayload);

      await chatRef.set({
        lastMessage: cleanMessage || (uploadedImageUrl ? 'Image' : 'Message'),
        lastMessageAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return sendResponse(response, {
        success: true,
        messageId: messageRef.id,
        message: 'Message sent successfully',
      });
    } catch (error: any) {
      console.error('Error in sendMarketMessage:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

// ============================================================================
// KEEP HELLO WORLD FOR TESTING
// ============================================================================
// Force redeploy to pick up config changes
