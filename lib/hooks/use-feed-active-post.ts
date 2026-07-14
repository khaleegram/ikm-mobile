import { useEffect, useState } from 'react';
import { Image } from 'expo-image';

import type { MarketPost } from '@/types';
import { getMarketPostPrimaryImage } from '@/lib/utils/market-media';

let activePostId: string | null = null;
let activeIndex = 0;
const listeners = new Set<() => void>();

/** Keep at most active ± MEDIA_WINDOW video players mounted at once. */
const MEDIA_WINDOW = 1;

function emit() {
  listeners.forEach((listener) => listener());
}

export function setFeedActive(id: string | null, index?: number) {
  let changed = false;
  if (activePostId !== id) {
    activePostId = id;
    changed = true;
  }
  if (typeof index === 'number' && Number.isFinite(index) && activeIndex !== index) {
    activeIndex = Math.max(0, index);
    changed = true;
  }
  if (changed) emit();
}

/** Backwards-compatible alias. */
export function setFeedActivePostId(id: string | null, index?: number) {
  setFeedActive(id, index);
}

export function getFeedActivePostId() {
  return activePostId;
}

export function getFeedActiveIndex() {
  return activeIndex;
}

export function subscribeFeedActive(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Warms the cache for the posters/images just ahead of (and behind) the active
 * card, so the next post renders instantly instead of fetching on snap.
 */
export function useFeedMediaPrefetch(posts: MarketPost[]) {
  useEffect(() => {
    if (!posts.length) return undefined;
    let lastIndex = -1;

    const run = () => {
      const index = getFeedActiveIndex();
      if (index === lastIndex) return;
      lastIndex = index;

      const neighbors = [posts[index + 1], posts[index + 2], posts[index - 1]];
      const uris = Array.from(
        new Set(
          neighbors
            .filter(Boolean)
            .flatMap((post) => {
              const poster = getMarketPostPrimaryImage(post);
              const videoPoster = String(post.coverImageUrl || post.images?.[0] || '').trim();
              return [poster, videoPoster].filter(Boolean);
            })
        )
      );

      if (uris.length) {
        Image.prefetch(uris, { cachePolicy: 'memory-disk' }).catch(() => {});
      }
    };

    const unsubscribe = subscribeFeedActive(run);
    run();
    return unsubscribe;
  }, [posts]);
}

/** Only re-renders cards whose active state actually changed. */
export function useIsFeedItemActive(postId: string | undefined | null): boolean {
  const [isActive, setIsActive] = useState(() => Boolean(postId && postId === activePostId));

  useEffect(() => {
    const sync = () => setIsActive(Boolean(postId && postId === activePostId));
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, [postId]);

  return isActive;
}

/**
 * Returns true when this card is close enough to the active card that its
 * heavy media (video player) should stay mounted. Far-off cards render a
 * lightweight poster image instead, keeping only ~3 players alive.
 */
export function useShouldMountMedia(index: number | undefined | null): boolean {
  const [shouldMount, setShouldMount] = useState(() =>
    typeof index === 'number' ? Math.abs(index - activeIndex) <= MEDIA_WINDOW : true
  );

  useEffect(() => {
    const sync = () =>
      setShouldMount(
        typeof index === 'number' ? Math.abs(index - activeIndex) <= MEDIA_WINDOW : true
      );
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, [index]);

  return shouldMount;
}
