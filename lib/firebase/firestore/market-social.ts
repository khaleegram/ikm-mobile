import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, Unsubscribe, where } from 'firebase/firestore';

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

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { marketSocialApi } = await import('@/lib/api/market-social');
        const next = await marketSocialApi.listFollowingIds();
        if (!cancelled) setIds(next);
      } catch {
        if (!cancelled) setIds([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { marketSocialApi } = await import('@/lib/api/market-social');
        const next = await marketSocialApi.listBlockedIds();
        if (!cancelled) setIds(next);
      } catch {
        if (!cancelled) setIds([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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
    let cancelled = false;

    (async () => {
      try {
        const { marketSocialApi } = await import('@/lib/api/market-social');
        const next = await marketSocialApi.isFollowing(followed);
        if (!cancelled) setIsFollowing(next);
      } catch {
        if (!cancelled) setIsFollowing(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [followerId, followedId]);

  return { isFollowing, loading };
}

export async function toggleFollow(
  _followerId: string,
  followedId: string,
  isCurrentlyFollowing: boolean
) {
  const { marketSocialApi } = await import('@/lib/api/market-social');
  if (isCurrentlyFollowing) {
    await marketSocialApi.unfollowUser(followedId);
  } else {
    await marketSocialApi.followUser(followedId);
  }
}

function saveDocId(userId: string, postId: string) {
  return `${userId}_${postId}`;
}

export function useUserSavedPostIds(userId: string | null) {
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setIds([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { marketSocialApi } = await import('@/lib/api/market-social');
        const saved = await marketSocialApi.listSaved();
        if (!cancelled) setIds(saved.ids);
      } catch {
        if (!cancelled) setIds([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const idSet = useMemo(() => new Set(ids), [ids]);
  return { ids, idSet, loading };
}

export function useIsSaved(userId: string | null, postId: string | null) {
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = String(userId || '').trim();
    const post = String(postId || '').trim();
    if (!user || !post) {
      setIsSaved(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const { marketSocialApi } = await import('@/lib/api/market-social');
        const saved = await marketSocialApi.listSaved();
        if (!cancelled) setIsSaved(saved.ids.includes(post));
      } catch {
        if (!cancelled) setIsSaved(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, postId]);

  return { isSaved, loading };
}

export async function toggleMarketSave(_userId: string, postId: string) {
  const { marketSocialApi } = await import('@/lib/api/market-social');
  const saved = await marketSocialApi.listSaved();
  if (saved.ids.includes(postId)) {
    await marketSocialApi.unsavePost(postId);
  } else {
    await marketSocialApi.savePost(postId);
  }
}
