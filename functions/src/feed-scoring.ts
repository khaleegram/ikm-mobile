import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const ACTION_WEIGHTS = {
  full_completion: 10,
  loop: 8,
  dwell: 2,
  chat: 15,
  like: 2,
  favorite: 2,
  immediate_skip: -12,
} as const;

export type FeedActionType = keyof typeof ACTION_WEIGHTS;

export interface ScoreBreakdown {
  fullCompletion: number;
  loops: number;
  dwell: number;
  chat: number;
  likes: number;
  favorites: number;
  skips: number;
}

export interface MarketPostScoreDoc {
  postId: string;
  posterId: string;
  hashtags: string[];
  status: 'active' | 'hidden' | 'deleted';
  totalPoints: number;
  score: number;
  breakdown: ScoreBreakdown;
  views: number;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

export function computeDecayedScore(totalPoints: number, createdAt: Date): number {
  const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / 3_600_000);
  const denominator = Math.pow(ageHours + 2, 1.5);
  if (denominator <= 0) return totalPoints;
  return totalPoints / denominator;
}

export function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date(0);
}

export function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    )
  );
}

export function pointsForActions(actions: Partial<Record<FeedActionType, number>>): number {
  let total = 0;
  (Object.keys(actions) as FeedActionType[]).forEach((action) => {
    const count = Number(actions[action] || 0);
    if (!Number.isFinite(count) || count === 0) return;
    total += ACTION_WEIGHTS[action] * count;
  });
  return total;
}

export async function ensurePostScoreDoc(
  postId: string,
  postData?: FirebaseFirestore.DocumentData | null
): Promise<FirebaseFirestore.DocumentReference> {
  const firestore = admin.firestore();
  const scoreRef = firestore.collection('marketPostScores').doc(postId);
  const existing = await scoreRef.get();
  if (existing.exists) return scoreRef;

  let data = postData;
  if (!data) {
    const postSnap = await firestore.collection('marketPosts').doc(postId).get();
    data = postSnap.exists ? postSnap.data() : {};
  }

  const createdAt = asDate(data?.createdAt);
  const payload: MarketPostScoreDoc = {
    postId,
    posterId: String(data?.posterId || '').trim(),
    hashtags: normalizeHashtags(data?.hashtags),
    status: (data?.status as MarketPostScoreDoc['status']) || 'active',
    totalPoints: 0,
    score: computeDecayedScore(0, createdAt),
    breakdown: {
      fullCompletion: 0,
      loops: 0,
      dwell: 0,
      chat: 0,
      likes: 0,
      favorites: 0,
      skips: 0,
    },
    views: typeof data?.views === 'number' ? data.views : 0,
    createdAt: data?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await scoreRef.set(payload, { merge: true });
  return scoreRef;
}

export async function applyScoreDelta(
  postId: string,
  delta: Partial<Record<FeedActionType, number>>,
  options?: { incrementViews?: number | boolean; postData?: FirebaseFirestore.DocumentData | null }
): Promise<{ totalPoints: number; score: number }> {
  const firestore = admin.firestore();
  const scoreRef = await ensurePostScoreDoc(postId, options?.postData);

  return firestore.runTransaction(async (transaction) => {
    const scoreSnap = await transaction.get(scoreRef);
    const scoreData = scoreSnap.data() || {};
    const createdAt = asDate(scoreData.createdAt);
    const breakdown: ScoreBreakdown = {
      fullCompletion: Number(scoreData.breakdown?.fullCompletion || 0),
      loops: Number(scoreData.breakdown?.loops || 0),
      dwell: Number(scoreData.breakdown?.dwell || 0),
      chat: Number(scoreData.breakdown?.chat || 0),
      likes: Number(scoreData.breakdown?.likes || 0),
      favorites: Number(scoreData.breakdown?.favorites || 0),
      skips: Number(scoreData.breakdown?.skips || 0),
    };

    if (delta.full_completion) {
      breakdown.fullCompletion = Math.max(0, breakdown.fullCompletion + delta.full_completion);
    }
    if (delta.loop) breakdown.loops = Math.max(0, breakdown.loops + delta.loop);
    if (delta.dwell) breakdown.dwell = Math.max(0, breakdown.dwell + delta.dwell);
    if (delta.chat) breakdown.chat = Math.max(0, breakdown.chat + delta.chat);
    if (delta.like) breakdown.likes = Math.max(0, breakdown.likes + delta.like);
    if (delta.favorite) breakdown.favorites = Math.max(0, breakdown.favorites + delta.favorite);
    if (delta.immediate_skip) breakdown.skips = Math.max(0, breakdown.skips + delta.immediate_skip);

    const previousPoints = Number(scoreData.totalPoints || 0);
    const addedPoints = pointsForActions(delta);
    const totalPoints = previousPoints + addedPoints;
    const score = computeDecayedScore(totalPoints, createdAt);
    const viewIncrement = options?.incrementViews ? 1 : 0;
    const views = Number(scoreData.views || 0) + viewIncrement;

    transaction.set(
      scoreRef,
      {
        totalPoints,
        score,
        breakdown,
        views,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (viewIncrement > 0) {
      const postRef = firestore.collection('marketPosts').doc(postId);
      transaction.set(
        postRef,
        { views: FieldValue.increment(1) },
        { merge: true }
      );
    }

    return { totalPoints, score };
  });
}
