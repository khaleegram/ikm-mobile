import { useCallback, useEffect, useRef, useState } from 'react';

import { marketFeedApi, type FeedPageParams, type FeedPageResult } from '@/lib/api/market-feed';
import { normalizeMarketPostRecord } from '@/lib/firebase/firestore/market-posts';
import type { MarketPost } from '@/types';

export type ClipFeedMode = 'initial' | 'refresh' | 'more';

export type ClipFeedFetchPage = (params: FeedPageParams) => Promise<FeedPageResult>;

export interface UseClipFeedResult {
  items: MarketPost[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  sessionId: string | null;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  removeItem: (clipId: string) => void;
  patchItem: (clipId: string, patch: Partial<MarketPost>) => void;
  markSeen: (postIds: string[], dwellSec?: number) => void;
}

function normalizeItems(raw: MarketPost[]): MarketPost[] {
  return raw
    .map((post) => normalizeMarketPostRecord(String(post.id || ''), post as any))
    .filter((post) => Boolean(post.id));
}

/**
 * Clip-style feed pagination: session-pinned pages, race-safe requests,
 * local remove/patch mutations.
 */
export function useClipFeed(fetchPage: ClipFeedFetchPage | null): UseClipFeedResult {
  const [items, setItems] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const requestIdRef = useRef(0);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const inFlightMoreRef = useRef(false);

  const clearSession = useCallback(() => {
    sessionIdRef.current = null;
    cursorRef.current = null;
    setSessionId(null);
  }, []);

  const runFetch = useCallback(
    async (mode: ClipFeedMode) => {
      const fetcher = fetchPageRef.current;
      if (!fetcher) {
        setItems([]);
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        setError(null);
        setHasMore(false);
        hasMoreRef.current = false;
        clearSession();
        return;
      }

      const requestId = ++requestIdRef.current;

      if (mode === 'initial') {
        setLoading(true);
        clearSession();
        hasMoreRef.current = true;
      } else if (mode === 'refresh') {
        setRefreshing(true);
        clearSession();
        hasMoreRef.current = true;
      } else {
        if (inFlightMoreRef.current || !hasMoreRef.current) return;
        inFlightMoreRef.current = true;
        setLoadingMore(true);
      }

      setError(null);

      try {
        const result = await fetcher({
          limit: marketFeedApi.pageSize,
          cursor: mode === 'more' ? cursorRef.current : null,
          sessionId: mode === 'more' ? sessionIdRef.current : null,
        });

        if (requestId !== requestIdRef.current) return;

        const nextItems = normalizeItems(result.items);
        if (result.sessionId) {
          sessionIdRef.current = result.sessionId;
          setSessionId(result.sessionId);
        }
        cursorRef.current = result.nextCursor;
        hasMoreRef.current = Boolean(result.hasMore);
        setHasMore(hasMoreRef.current);

        setItems((prev) => {
          if (mode === 'more') {
            const seen = new Set(prev.map((p) => p.id));
            const appended = nextItems.filter((p) => p.id && !seen.has(p.id));
            return [...prev, ...appended];
          }
          return nextItems;
        });
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error('useClipFeed fetch failed:', err);
        setError(err as Error);
        if (mode === 'initial') setItems([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
          inFlightMoreRef.current = false;
        }
      }
    },
    [clearSession]
  );

  // Reset + initial load whenever fetchPage identity changes (tab/source switch).
  useEffect(() => {
    clearSession();
    setItems([]);
    setHasMore(true);
    void runFetch('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only when fetchPage changes
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || refreshing || loadingMore) return;
    await runFetch('more');
  }, [hasMore, loading, refreshing, loadingMore, runFetch]);

  const refresh = useCallback(async () => {
    await runFetch('refresh');
  }, [runFetch]);

  const removeItem = useCallback((clipId: string) => {
    const id = String(clipId || '').trim();
    if (!id) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const patchItem = useCallback((clipId: string, patch: Partial<MarketPost>) => {
    const id = String(clipId || '').trim();
    if (!id) return;
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch, id: item.id } : item))
    );
  }, []);

  const markSeen = useCallback((postIds: string[], dwellSec?: number) => {
    if (!postIds.length) return;
    marketFeedApi.markSeen(postIds, dwellSec).catch(() => {});
  }, []);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore,
    sessionId,
    loadMore,
    refresh,
    removeItem,
    patchItem,
    markSeen,
  };
}
