import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import cors = require('cors');

import {
  ACTION_WEIGHTS,
  applyScoreDelta,
  asDate,
  computeDecayedScore,
  ensurePostScoreDoc,
  normalizeHashtags,
  type FeedActionType,
} from './feed-scoring';
import { requireAuth, sendError, sendResponse } from './utils';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const corsHandler = cors({ origin: true });

const FEED_TOTAL = 25;
const BUCKET_A_SIZE = 13;
const BUCKET_B_SIZE = 7;
const BUCKET_C_SIZE = 5;
const COLD_START_MAX_VIEWS = 100;
const COLD_START_MAX_AGE_HOURS = 6;
const TASTE_INTERACTION_LIMIT = 10;
const IMMEDIATE_SKIP_THRESHOLD_SEC = 2;
const COMPLETION_THRESHOLD = 0.95;
const IMAGE_COMPLETION_SEC = 5;
const IMAGE_VIEW_TARGET_SEC = 8;
const DWELL_BLOCK_SEC = 4;
const MAX_DWELL_BLOCKS = 5;

type WatchSessionPayload = {
  postId: string;
  watchTimeSec?: number;
  videoDurationSec?: number;
  loopCount?: number;
  mediaType?: string;
};

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function interleaveBuckets<T>(buckets: T[][]): T[] {
  const queues = buckets.map((bucket) => [...bucket]);
  const merged: T[] = [];
  while (queues.some((queue) => queue.length > 0)) {
    queues.forEach((queue) => {
      if (queue.length > 0) merged.push(queue.shift()!);
    });
  }
  return merged;
}

async function logInteractionRecord(
  userId: string,
  postId: string,
  posterId: string,
  actionType: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const firestore = admin.firestore();
  await firestore.collection('marketPostInteractions').add({
    userId,
    postId,
    posterId,
    actionType,
    ...extra,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function resolvePostContext(postId: string) {
  const firestore = admin.firestore();
  const postSnap = await firestore.collection('marketPosts').doc(postId).get();
  if (!postSnap.exists) {
    throw new Error('Post not found');
  }
  const postData = postSnap.data() || {};
  return {
    postRef: postSnap.ref,
    postData,
    posterId: String(postData.posterId || '').trim(),
    hashtags: normalizeHashtags(postData.hashtags),
    status: String(postData.status || 'active'),
  };
}

function deriveWatchActions(payload: WatchSessionPayload): Partial<Record<FeedActionType, number>> {
  const watchTimeSec = Math.max(0, Number(payload.watchTimeSec || 0));
  const videoDurationSec = Math.max(0, Number(payload.videoDurationSec || 0));
  const mediaType = String(payload.mediaType || 'video').trim();
  const isImage = mediaType === 'image_gallery';
  const actions: Partial<Record<FeedActionType, number>> = {};

  if (watchTimeSec > 0 && watchTimeSec < IMMEDIATE_SKIP_THRESHOLD_SEC) {
    actions.immediate_skip = 1;
    return actions;
  }

  if (isImage) {
    const targetSec = Math.max(IMAGE_VIEW_TARGET_SEC, videoDurationSec || IMAGE_VIEW_TARGET_SEC);
    if (
      watchTimeSec >= IMAGE_COMPLETION_SEC ||
      watchTimeSec >= targetSec * COMPLETION_THRESHOLD
    ) {
      actions.full_completion = 1;
    }
  } else if (videoDurationSec > 0) {
    const requiredWatchSec = Math.max(8, videoDurationSec * COMPLETION_THRESHOLD);
    if (watchTimeSec >= requiredWatchSec) {
      actions.full_completion = 1;
    }
  } else if (watchTimeSec >= 12) {
    actions.full_completion = 1;
  }

  if (watchTimeSec >= DWELL_BLOCK_SEC) {
    const dwellBlocks = Math.min(MAX_DWELL_BLOCKS, Math.floor(watchTimeSec / DWELL_BLOCK_SEC));
    if (dwellBlocks > 0) {
      actions.dwell = dwellBlocks;
    }
  }

  return actions;
}

/**
 * Log a watch session or explicit feed action (chat, favorite, etc.).
 */
export const logMarketPostInteraction = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const body = request.body || {};
      const postId = String(body.postId || '').trim();
      const actionType = String(body.actionType || 'watch_session').trim();

      if (!postId) {
        return sendError(response, 'Post ID is required', 400);
      }

      const { posterId, hashtags, status, postData } = await resolvePostContext(postId);
      if (status !== 'active') {
        return sendResponse(response, { success: true, skipped: true });
      }

      if (posterId === auth.uid) {
        return sendResponse(response, { success: true, skipped: true, reason: 'own_post' });
      }

      await ensurePostScoreDoc(postId, postData);

      if (actionType === 'watch_session') {
        const watchPayload: WatchSessionPayload = {
          postId,
          watchTimeSec: Number(body.watchTimeSec || 0),
          videoDurationSec: Number(body.videoDurationSec || 0),
          loopCount: 0,
          mediaType: String(body.mediaType || 'video').trim(),
        };

        const derivedActions = deriveWatchActions(watchPayload);
        const hasEngagement = Object.keys(derivedActions).length > 0;

        await logInteractionRecord(auth.uid, postId, posterId, 'watch_session', {
          watchTimeSec: watchPayload.watchTimeSec,
          videoDurationSec: watchPayload.videoDurationSec,
          mediaType: watchPayload.mediaType,
          completionRate:
            Number(watchPayload.videoDurationSec) > 0
              ? Number(watchPayload.watchTimeSec) / Number(watchPayload.videoDurationSec)
              : null,
          hashtags,
          derivedActions,
        });

        if (hasEngagement) {
          for (const [action, count] of Object.entries(derivedActions)) {
            if (!count) continue;
            await logInteractionRecord(auth.uid, postId, posterId, action, {
              count,
              hashtags,
              source: 'watch_session',
            });
          }
        }

        const scoreResult = await applyScoreDelta(postId, derivedActions, {
          incrementViews: 1,
          postData,
        });

        return sendResponse(response, {
          success: true,
          actions: derivedActions,
          totalPoints: scoreResult.totalPoints,
          score: scoreResult.score,
        });
      }

      const explicitAction = actionType as FeedActionType;
      if (!(explicitAction in ACTION_WEIGHTS)) {
        return sendError(response, 'Unsupported action type', 400);
      }

      await logInteractionRecord(auth.uid, postId, posterId, explicitAction, {
        hashtags,
      });

      const scoreResult = await applyScoreDelta(postId, { [explicitAction]: 1 }, { postData });

      return sendResponse(response, {
        success: true,
        action: explicitAction,
        totalPoints: scoreResult.totalPoints,
        score: scoreResult.score,
      });
    } catch (error: any) {
      console.error('Error in logMarketPostInteraction:', error);
      const statusCode = error.message === 'Post not found' ? 404 : 500;
      return sendError(response, error.message || 'Internal server error', statusCode);
    }
  });
});

async function getUserLikedPostIds(userId: string): Promise<string[]> {
  const firestore = admin.firestore();
  const snapshot = await firestore
    .collection('marketPosts')
    .where('likedBy', 'array-contains', userId)
    .orderBy('createdAt', 'desc')
    .limit(300)
    .get();

  return snapshot.docs.map((docSnap) => docSnap.id).filter(Boolean);
}

async function getUserTasteHashtags(userId: string): Promise<string[]> {
  const firestore = admin.firestore();
  const snapshot = await firestore
    .collection('marketPostInteractions')
    .where('userId', '==', userId)
    .where('actionType', 'in', ['full_completion', 'chat'])
    .orderBy('createdAt', 'desc')
    .limit(TASTE_INTERACTION_LIMIT)
    .get();

  const tags = new Set<string>();
  snapshot.docs.forEach((docSnap) => {
    normalizeHashtags(docSnap.data()?.hashtags).forEach((tag) => tags.add(tag));
  });

  return Array.from(tags).slice(0, 10);
}

async function fetchScorePostIds(
  constraints: ((query: FirebaseFirestore.Query) => FirebaseFirestore.Query)[],
  limit: number,
  excludeIds: Set<string>
): Promise<string[]> {
  const firestore = admin.firestore();
  let queryRef: FirebaseFirestore.Query = firestore
    .collection('marketPostScores')
    .where('status', '==', 'active');

  constraints.forEach((apply) => {
    queryRef = apply(queryRef);
  });

  const snapshot = await queryRef.orderBy('score', 'desc').limit(Math.max(limit * 3, limit)).get();
  const ids: string[] = [];
  snapshot.docs.forEach((docSnap) => {
    const postId = String(docSnap.id || docSnap.data()?.postId || '').trim();
    if (!postId || excludeIds.has(postId)) return;
    ids.push(postId);
  });
  return ids.slice(0, limit);
}

async function fetchColdStartPostIds(limit: number, excludeIds: Set<string>): Promise<string[]> {
  const firestore = admin.firestore();
  const cutoff = Timestamp.fromDate(
    new Date(Date.now() - COLD_START_MAX_AGE_HOURS * 3_600_000)
  );

  const snapshot = await firestore
    .collection('marketPosts')
    .where('status', '==', 'active')
    .where('createdAt', '>=', cutoff)
    .orderBy('createdAt', 'desc')
    .limit(Math.max(limit * 4, limit))
    .get();

  const ids: string[] = [];
  snapshot.docs.forEach((docSnap) => {
    const postId = docSnap.id;
    const views = Number(docSnap.data()?.views || 0);
    if (!postId || excludeIds.has(postId) || views >= COLD_START_MAX_VIEWS) return;
    ids.push(postId);
  });

  return ids.slice(0, limit);
}

async function hydratePosts(postIds: string[]): Promise<Record<string, FirebaseFirestore.DocumentData>> {
  const firestore = admin.firestore();
  const chunks: string[][] = [];
  for (let i = 0; i < postIds.length; i += 10) {
    chunks.push(postIds.slice(i, i + 10));
  }

  const postsById: Record<string, FirebaseFirestore.DocumentData> = {};
  await Promise.all(
    chunks.map(async (chunk) => {
      const snapshot = await firestore
        .collection('marketPosts')
        .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
        .get();
      snapshot.docs.forEach((docSnap) => {
        postsById[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
      });
    })
  );

  return postsById;
}

/**
 * Build a personalized 25-post feed from taste, trending, and cold-start buckets.
 */
export const getPersonalizedMarketFeed = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const excludeIds = new Set<string>(
        Array.isArray(request.body?.excludePostIds)
          ? request.body.excludePostIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
          : []
      );

      const [tasteTags, likedPostIds] = await Promise.all([
        getUserTasteHashtags(auth.uid),
        getUserLikedPostIds(auth.uid),
      ]);
      likedPostIds.forEach((postId) => excludeIds.add(postId));

      const [bucketAIds, bucketBIds, bucketCIds] = await Promise.all([
        tasteTags.length
          ? fetchScorePostIds(
              [(q) => q.where('hashtags', 'array-contains-any', tasteTags)],
              BUCKET_A_SIZE,
              excludeIds
            )
          : Promise.resolve([] as string[]),
        fetchScorePostIds([], BUCKET_B_SIZE, excludeIds),
        fetchColdStartPostIds(BUCKET_C_SIZE, excludeIds),
      ]);

      const used = new Set<string>(excludeIds);
      const takeUnique = (ids: string[], target: number) => {
        const picked: string[] = [];
        ids.forEach((id) => {
          if (picked.length >= target) return;
          if (used.has(id)) return;
          used.add(id);
          picked.push(id);
        });
        return picked;
      };

      let taste = takeUnique(shuffleInPlace([...bucketAIds]), BUCKET_A_SIZE);
      let trending = takeUnique(shuffleInPlace([...bucketBIds]), BUCKET_B_SIZE);
      let coldStart = takeUnique(shuffleInPlace([...bucketCIds]), BUCKET_C_SIZE);

      const shortfall = FEED_TOTAL - (taste.length + trending.length + coldStart.length);
      if (shortfall > 0) {
        const backfill = await fetchScorePostIds([], shortfall, used);
        trending = [...trending, ...takeUnique(backfill, shortfall)];
      }

      let orderedIds = interleaveBuckets([
        shuffleInPlace(taste),
        shuffleInPlace(trending),
        shuffleInPlace(coldStart),
      ]).slice(0, FEED_TOTAL);

      if (orderedIds.length < FEED_TOTAL) {
        const firestore = admin.firestore();
        const fallbackSnap = await firestore
          .collection('marketPosts')
          .where('status', '==', 'active')
          .orderBy('createdAt', 'desc')
          .limit(FEED_TOTAL * 2)
          .get();

        fallbackSnap.docs.forEach((docSnap) => {
          if (orderedIds.length >= FEED_TOTAL) return;
          if (used.has(docSnap.id)) return;
          used.add(docSnap.id);
          orderedIds.push(docSnap.id);
        });
      }

      const postsById = await hydratePosts(orderedIds);
      const posts = orderedIds
        .map((id) => postsById[id])
        .filter((post) => post && post.status === 'active');

      return sendResponse(response, {
        success: true,
        posts,
        meta: {
          total: posts.length,
          buckets: {
            taste: taste.length,
            trending: trending.length,
            coldStart: coldStart.length,
          },
          tasteTags,
        },
      });
    } catch (error: any) {
      console.error('Error in getPersonalizedMarketFeed:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

async function refreshActivePostScores(limit: number = 200): Promise<number> {
  const firestore = admin.firestore();
  const snapshot = await firestore
    .collection('marketPostScores')
    .where('status', '==', 'active')
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(500, Math.max(1, limit)))
    .get();

  const batch = firestore.batch();
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const totalPoints = Number(data.totalPoints || 0);
    const createdAt = asDate(data.createdAt);
    const score = computeDecayedScore(totalPoints, createdAt);
    batch.update(docSnap.ref, {
      score,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
  return snapshot.size;
}

/**
 * Recompute decayed scores for active posts (manual maintenance).
 */
export const refreshMarketPostScores = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      await requireAuth(request.headers.authorization || null);
      const refreshed = await refreshActivePostScores(Number(request.body?.limit || 200));

      return sendResponse(response, {
        success: true,
        refreshed,
      });
    } catch (error: any) {
      console.error('Error in refreshMarketPostScores:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

/**
 * Hourly score decay refresh so trending stays time-accurate.
 */
export const scheduledRefreshMarketPostScores = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Africa/Lagos',
  },
  async () => {
    const refreshed = await refreshActivePostScores(500);
    console.log(`scheduledRefreshMarketPostScores refreshed ${refreshed} scores`);
  }
);
