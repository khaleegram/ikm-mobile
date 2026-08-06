import { useCallback, useEffect, useRef, useState } from 'react';

import { marketPostsApi } from '@/lib/api/market-posts';
import { queryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { haptics } from '@/lib/utils/haptics';
import { shareMarketPost } from '@/lib/utils/market-post-share';
import type { MarketPost } from '@/types';

function patchLikedPostIds(userId: string, postId: string, liked: boolean) {
  const key = queryKeys.social.liked(userId);
  const previous = queryClient.getQueryData<string[]>(key);
  if (!previous && !queryClient.getQueryState(key)) {
    // Don't invent a liked list if the screen never loaded one — invalidate so Liked tab
    // picks it up on next open rather than seeding a partial cache.
    void queryClient.invalidateQueries({ queryKey: key });
    return;
  }
  const list = previous ?? [];
  const next = liked
    ? [...new Set([...list, postId])]
    : list.filter((id) => id !== postId);
  queryClient.setQueryData(key, next);
}

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
    const uid = userRef.current?.uid;
    if (!pid || likePendingRef.current) return;
    likePendingRef.current = true;
    try {
      const result = await marketPostsApi.like(pid);
      serverLikesRef.current = result.likes;
      serverIsLikedRef.current = result.isLiked;
      setOptLikes(result.likes);
      setOptLiked(result.isLiked === targetLiked ? null : result.isLiked);
      if (uid) {
        patchLikedPostIds(uid, pid, result.isLiked);
      }
      onPatchItemRef.current?.(pid, {
        likes: result.likes,
        likedBy: result.isLiked
          ? Array.from(new Set([...(post.likedBy || []), userRef.current?.uid || ''].filter(Boolean)))
          : (post.likedBy || []).filter((id) => id !== userRef.current?.uid),
      });
    } catch {
      setOptLiked(serverIsLikedRef.current);
      setOptLikes(serverLikesRef.current);
      if (uid) {
        patchLikedPostIds(uid, pid, serverIsLikedRef.current);
      }
      haptics.error();
    } finally {
      likePendingRef.current = false;
    }
  }, [post.likedBy]);

  const toggleLike = useCallback(() => {
    const uid = userRef.current?.uid;
    const pid = postIdRef.current;
    if (!uid || !pid) return;
    const previousLiked = optLiked ?? serverIsLikedRef.current;
    const nextLiked = !previousLiked;
    const nextLikes = Math.max(0, optLikes + (nextLiked ? 1 : -1));
    setOptLiked(nextLiked);
    setOptLikes(nextLikes);
    patchLikedPostIds(uid, pid, nextLiked);
    haptics.light();
    void fireLike(nextLiked);
  }, [fireLike, optLiked, optLikes]);

  const likeIfNeeded = useCallback(() => {
    const uid = userRef.current?.uid;
    const pid = postIdRef.current;
    if (!uid || !pid) return;
    const alreadyLiked = optLiked ?? serverIsLikedRef.current;
    if (alreadyLiked) {
      haptics.light();
      return;
    }
    const nextLikes = Math.max(0, optLikes + 1);
    setOptLiked(true);
    setOptLikes(nextLikes);
    patchLikedPostIds(uid, pid, true);
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
