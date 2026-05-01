import { auth, firestore } from '@/lib/firebase/config';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

function requireAuthenticatedUserId(): string {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Please log in to continue.');
  return userId;
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function followDocId(followerId: string, followedId: string) {
  return `${followerId}_${followedId}`;
}

function blockDocId(blockerId: string, blockedId: string) {
  return `${blockerId}_${blockedId}`;
}

export const marketSocialApi = {
  async followUser(targetUserId: string) {
    const followerId = requireAuthenticatedUserId();
    const followedId = normalizeUid(targetUserId);
    if (!followedId) throw new Error('User not found.');
    if (followedId === followerId) throw new Error('You cannot follow yourself.');

    const marketFollowRef = doc(firestore, 'marketFollows', followDocId(followerId, followedId));
    const marketExisting = await getDoc(marketFollowRef);
    if (marketExisting.exists()) return;

    const followerProfile = await getDoc(doc(firestore, 'users', followerId));
    const followedProfile = await getDoc(doc(firestore, 'users', followedId));
    if (!followerProfile.exists() || !followedProfile.exists()) {
      throw new Error('Profile still syncing. Try again in a moment.');
    }

    const batch = writeBatch(firestore);
    batch.set(marketFollowRef, {
      followerId,
      followedId,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(firestore, 'users', followerId), {
      followingCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(firestore, 'users', followedId), {
      followerCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  },

  async unfollowUser(targetUserId: string) {
    const followerId = requireAuthenticatedUserId();
    const followedId = normalizeUid(targetUserId);
    if (!followedId) return;

    const marketFollowRef = doc(firestore, 'marketFollows', followDocId(followerId, followedId));
    const edge = await getDoc(marketFollowRef);
    if (!edge.exists()) return;

    const batch = writeBatch(firestore);
    batch.delete(marketFollowRef);
    batch.update(doc(firestore, 'users', followerId), {
      followingCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(firestore, 'users', followedId), {
      followerCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  },

  /**
   * Set follow state explicitly — avoids races with optimistic UI vs stale "current" state.
   */
  async setFollowState(targetUserId: string, shouldFollow: boolean) {
    if (shouldFollow) return this.followUser(targetUserId);
    return this.unfollowUser(targetUserId);
  },

  /** @deprecated Prefer setFollowState (explicit intent). */
  async toggleFollowUser(targetUserId: string, isFollowing: boolean) {
    if (isFollowing) return this.unfollowUser(targetUserId);
    return this.followUser(targetUserId);
  },

  async blockUser(targetUserId: string) {
    const blockerId = requireAuthenticatedUserId();
    const blockedId = normalizeUid(targetUserId);
    if (!blockedId) throw new Error('User not found.');
    if (blockedId === blockerId) throw new Error('You cannot block yourself.');

    const batch = writeBatch(firestore);
    batch.set(doc(firestore, 'marketBlocks', blockDocId(blockerId, blockedId)), {
      blockerId,
      blockedId,
      createdAt: serverTimestamp(),
    });
    // Also remove follow both ways (clean up social graph)
    batch.delete(doc(firestore, 'marketFollows', followDocId(blockerId, blockedId)));
    batch.delete(doc(firestore, 'marketFollows', followDocId(blockedId, blockerId)));
    batch.delete(doc(firestore, `following/${blockerId}/list`, blockedId));
    batch.delete(doc(firestore, `following/${blockedId}/list`, blockerId));
    batch.delete(doc(firestore, `followers/${blockedId}/list`, blockerId));
    batch.delete(doc(firestore, `followers/${blockerId}/list`, blockedId));
    await batch.commit();
  },

  async unblockUser(targetUserId: string) {
    const blockerId = requireAuthenticatedUserId();
    const blockedId = normalizeUid(targetUserId);
    if (!blockedId) return;
    await deleteDoc(doc(firestore, 'marketBlocks', blockDocId(blockerId, blockedId)));
  },

  async report(input: {
    targetType: 'post' | 'sound' | 'user';
    targetId: string;
    reason: string;
    details?: string;
  }) {
    const reporterId = requireAuthenticatedUserId();
    const targetId = normalizeUid(input.targetId);
    const reason = String(input.reason || '').trim().slice(0, 80);
    const details = String(input.details || '').trim().slice(0, 600);
    if (!targetId) throw new Error('Nothing to report.');
    if (!reason) throw new Error('Please select a reason.');

    const reportRef = doc(collection(firestore, 'marketReports'));
    await setDoc(reportRef, {
      reporterId,
      targetType: input.targetType,
      targetId,
      reason,
      details: details || null,
      createdAt: serverTimestamp(),
    });
  },
};

