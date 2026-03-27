import { auth, firestore } from '@/lib/firebase/config';
import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

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

    const ref = doc(firestore, 'marketFollows', followDocId(followerId, followedId));
    const existing = await getDoc(ref);
    if (existing.exists()) return;

    await setDoc(ref, {
      followerId,
      followedId,
      createdAt: serverTimestamp(),
    });
  },

  async unfollowUser(targetUserId: string) {
    const followerId = requireAuthenticatedUserId();
    const followedId = normalizeUid(targetUserId);
    if (!followedId) return;
    await deleteDoc(doc(firestore, 'marketFollows', followDocId(followerId, followedId)));
  },

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

