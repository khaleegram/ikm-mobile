import { useCallback, useEffect, useRef } from 'react';

import { marketFeedApi } from '@/lib/api/market-feed';

export interface FeedWatchSessionInput {
  postId?: string | null;
  active: boolean;
  mediaType?: 'video' | 'image_gallery';
  videoDurationSec?: number;
  getPlaybackPosition?: () => { currentTimeSec: number; durationSec: number };
}

export function useFeedWatchSession({
  postId,
  active,
  mediaType = 'video',
  videoDurationSec = 0,
  getPlaybackPosition,
}: FeedWatchSessionInput) {
  const sessionStartRef = useRef<number | null>(null);
  const maxPositionRef = useRef(0);
  const reportedRef = useRef(false);
  const postIdRef = useRef(postId);
  const mediaTypeRef = useRef(mediaType);
  postIdRef.current = postId;
  mediaTypeRef.current = mediaType;

  const resetSession = useCallback(() => {
    sessionStartRef.current = null;
    maxPositionRef.current = 0;
    reportedRef.current = false;
  }, []);

  const reportSession = useCallback(() => {
    const currentPostId = String(postIdRef.current || '').trim();
    if (!currentPostId || reportedRef.current) return;

    const wallClockSec =
      sessionStartRef.current != null
        ? Math.max(0, (Date.now() - sessionStartRef.current) / 1000)
        : 0;
    const playbackDurationSec = Math.max(videoDurationSec, maxPositionRef.current, 0);
    const watchTimeSec = Math.max(wallClockSec, maxPositionRef.current);

    if (watchTimeSec <= 0) return;

    reportedRef.current = true;
    marketFeedApi.queueWatchSession({
      postId: currentPostId,
      mediaType: mediaTypeRef.current,
      watchTimeSec: Number(watchTimeSec.toFixed(2)),
      videoDurationSec: Number(playbackDurationSec.toFixed(2)),
      loopCount: 0,
    });
  }, [videoDurationSec]);

  useEffect(() => {
    resetSession();
  }, [postId, resetSession]);

  useEffect(() => {
    if (!postId) return undefined;

    if (active) {
      if (sessionStartRef.current == null) {
        sessionStartRef.current = Date.now();
      }

      const interval = setInterval(() => {
        if (!getPlaybackPosition) return;
        const { currentTimeSec } = getPlaybackPosition();
        maxPositionRef.current = Math.max(maxPositionRef.current, Math.max(0, currentTimeSec));
      }, 500);

      return () => {
        clearInterval(interval);
        reportSession();
      };
    }

    reportSession();
    return undefined;
  }, [active, getPlaybackPosition, postId, reportSession, videoDurationSec]);

  useEffect(() => {
    return () => {
      reportSession();
    };
  }, [reportSession]);
}
