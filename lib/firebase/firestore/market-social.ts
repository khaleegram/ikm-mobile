import { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, Unsubscribe, where } from 'firebase/firestore';

import { firestore } from '../config';

function followDocId(followerId: string, followedId: string) {
  return `${followerId}_${followedId}`;
}

export function useFollowingUserIds(userId: string | null) {
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setIds([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'marketFollows'),
      where('followerId', '==', userId),
      limit(500)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setIds(
          snapshot.docs
            .map((docSnap) => String(docSnap.data()?.followedId || '').trim())
            .filter(Boolean)
        );
        setLoading(false);
      },
      () => {
        setIds([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const idSet = useMemo(() => new Set(ids), [ids]);
  return { ids, idSet, loading };
}

export function useBlockedUserIds(userId: string | null) {
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setIds([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'marketBlocks'),
      where('blockerId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(500)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setIds(
          snapshot.docs
            .map((docSnap) => String(docSnap.data()?.blockedId || '').trim())
            .filter(Boolean)
        );
        setLoading(false);
      },
      () => {
        setIds([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const idSet = useMemo(() => new Set(ids), [ids]);
  return { ids, idSet, loading };
}

export function useIsFollowing(followerId: string | null, followedId: string | null) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const follower = String(followerId || '').trim();
    const followed = String(followedId || '').trim();
    if (!follower || !followed) {
      setIsFollowing(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(firestore, 'marketFollows', followDocId(follower, followed)),
      (snapshot) => {
        setIsFollowing(snapshot.exists());
        setLoading(false);
      },
      (err) => {
        // Do not flip to "unfollowed" on transient errors (permissions/offline) — that felt like auto-unfollow.
        console.warn('[useIsFollowing] snapshot error', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [followerId, followedId]);

  return { isFollowing, loading };
}

// Transactional Follow logic
export async function toggleFollow(followerId: string, followedId: string, isCurrentlyFollowing: boolean) {
  const { runTransaction, doc, serverTimestamp } = await import('firebase/firestore');

  const followingRef = doc(firestore, `following/${followerId}/list`, followedId);
  const followerRef = doc(firestore, `followers/${followedId}/list`, followerId);
  
  const originUserRef = doc(firestore, 'users', followerId);
  const targetUserRef = doc(firestore, 'users', followedId);

  await runTransaction(firestore, async (transaction) => {
    if (isCurrentlyFollowing) {
      // Unfollow
      transaction.delete(followingRef);
      transaction.delete(followerRef);

      const originSnap = await transaction.get(originUserRef);
      const targetSnap = await transaction.get(targetUserRef);

      const currentFollowing = (originSnap.data()?.followingCount || 1) - 1;
      const currentFollowers = (targetSnap.data()?.followerCount || 1) - 1;

      transaction.update(originUserRef, { followingCount: Math.max(0, currentFollowing) });
      transaction.update(targetUserRef, { followerCount: Math.max(0, currentFollowers) });
    } else {
      // Follow
      const now = serverTimestamp();
      transaction.set(followingRef, { createdAt: now });
      transaction.set(followerRef, { createdAt: now });

      const originSnap = await transaction.get(originUserRef);
      const targetSnap = await transaction.get(targetUserRef);

      const currentFollowing = (originSnap.data()?.followingCount || 0) + 1;
      const currentFollowers = (targetSnap.data()?.followerCount || 0) + 1;

      transaction.update(originUserRef, { followingCount: currentFollowing });
      transaction.update(targetUserRef, { followerCount: currentFollowers });
    }
  });
}
