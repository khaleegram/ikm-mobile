import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, Unsubscribe, where } from 'firebase/firestore';

import { firestore } from '../config';

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
      orderBy('createdAt', 'desc'),
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
  const { idSet, loading } = useFollowingUserIds(followerId);
  const isFollowing = Boolean(followedId && idSet.has(String(followedId)));
  return { isFollowing, loading };
}

