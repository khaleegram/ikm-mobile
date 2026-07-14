import { useCallback, useEffect, useRef, useState } from 'react';

import { marketPostsApi } from '@/lib/api/market-posts';
import { haptics } from '@/lib/utils/haptics';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import type { MarketPost } from '@/types';

export interface UseClipEngagementOptions {
  post: MarketPost;
  user: { uid: string } | null | undefined;
  onPatchItem?: (clipId: string, patch: Partial<MarketPost>) => void;
}

export interface UseClipEngagementResult {
  liked: boolean;
  likes: number;
  toggleLike: () => void;
  likeIfNeeded: () => void;
  share: () => Promise<void>;
}

/**
 * Optimistic like/share engagement seeded from the feed card payload.
 */
export function useClipEngagement({
  post,
  user,
  onPatchItem,
}: UseClipEngagementOptions): UseClipEngagementResult {
  const [optLiked, setOptLiked] = useState<boolean | null>(null);
  const [optLikes, setOptLikes] = useState<number>(post.likes ?? 0);

  const likePendingRef = useRef(false);
  const sharePendingRef = useRef(false);
  const serverLikesRef = useRef(post.likes ?? 0);
  const serverIsLikedRef = useRef(user?.uid ? (post.likedBy ?? []).includes(user.uid) : false);
  const userRef = useRef(user);
  userRef.current = user;
  const postIdRef = useRef(post.id);
  postIdRef.current = post.id;
  const onPatchItemRef = useRef(onPatchItem);
  onPatchItemRef.current = onPatchItem;

  useEffect(() => {
    serverLikesRef.current = post.likes ?? 0;
    serverIsLikedRef.current = user?.uid ? (post.likedBy ?? []).includes(user.uid) : false;
    setOptLikes(post.likes ?? 0);
    setOptLiked(null);
  }, [post.id, post.likes, post.likedBy, user?.uid]);

  const liked = optLiked ?? serverIsLikedRef.current;
  const likes = optLikes;

  const fireLike = useCallback(async (targetLiked: boolean) => {
    const pid = postIdRef.current;
    if (!pid || likePendingRef.current) return;
    likePendingRef.current = true;
    try {
      const result = await marketPostsApi.like(pid);
      serverLikesRef.current = result.likes;
      serverIsLikedRef.current = result.isLiked;
      setOptLikes(result.likes);
      setOptLiked(result.isLiked === targetLiked ? null : result.isLiked);
      onPatchItemRef.current?.(pid, {
        likes: result.likes,
        likedBy: result.isLiked
          ? Array.from(new Set([...(post.likedBy || []), userRef.current?.uid || ''].filter(Boolean)))
          : (post.likedBy || []).filter((id) => id !== userRef.current?.uid),
      });
    } catch {
      setOptLiked(serverIsLikedRef.current);
      setOptLikes(serverLikesRef.current);
      haptics.error();
    } finally {
      likePendingRef.current = false;
    }
  }, [post.likedBy]);

  const toggleLike = useCallback(() => {
    if (!userRef.current) return;
    const previousLiked = optLiked ?? serverIsLikedRef.current;
    const nextLiked = !previousLiked;
    const nextLikes = Math.max(0, optLikes + (nextLiked ? 1 : -1));
    setOptLiked(nextLiked);
    setOptLikes(nextLikes);
    haptics.light();
    void fireLike(nextLiked);
  }, [fireLike, optLiked, optLikes]);

  const likeIfNeeded = useCallback(() => {
    if (!userRef.current) return;
    const alreadyLiked = optLiked ?? serverIsLikedRef.current;
    if (alreadyLiked) {
      haptics.light();
      return;
    }
    const nextLikes = Math.max(0, optLikes + 1);
    setOptLiked(true);
    setOptLikes(nextLikes);
    haptics.medium();
    void fireLike(true);
  }, [fireLike, optLiked, optLikes]);

  const share = useCallback(async () => {
    const pid = postIdRef.current;
    if (!pid || sharePendingRef.current) return;
    sharePendingRef.current = true;
    try {
      await shareMarketPost(post);
    } catch {
      // Share dismiss/fail — silent
    } finally {
      sharePendingRef.current = false;
    }
  }, [post]);

  return {
    liked,
    likes,
    toggleLike,
    likeIfNeeded,
    share,
  };
}
