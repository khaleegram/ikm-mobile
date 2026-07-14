import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import type { MarketPost } from '@/types';

export interface WatchSessionMetrics {
  postId: string;
  mediaType: 'video' | 'image_gallery';
  watchTimeSec: number;
  videoDurationSec: number;
  loopCount: number;
}

export interface FeedPageParams {
  limit?: number;
  cursor?: string | null;
  sessionId?: string | null;
}

export interface FeedPageResult {
  items: MarketPost[];
  nextCursor: string | null;
  hasMore: boolean;
  sessionId: string | null;
  meta?: Record<string, unknown>;
}

const FEED_PAGE_SIZE = 12;

const pendingWatchSessions = new Map<string, WatchSessionMetrics>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWatchFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushWatchSessions();
  }, 300);
}

async function flushWatchSessions() {
  const batch = Array.from(pendingWatchSessions.values());
  pendingWatchSessions.clear();
  await Promise.all(
    batch.map((metrics) =>
      marketFeedApi.logWatchSession(metrics).catch((error) => {
        console.warn('Failed to log watch session:', error);
      })
    )
  );
}

function normalizeFeedPage(response: {
  items?: MarketPost[];
  posts?: MarketPost[];
  next_cursor?: string | null;
  nextCursor?: string | null;
  has_more?: boolean;
  hasMore?: boolean;
  session_id?: string | null;
  sessionId?: string | null;
  meta?: Record<string, unknown>;
}): FeedPageResult {
  const rawItems = Array.isArray(response.items)
    ? response.items
    : Array.isArray(response.posts)
      ? response.posts
      : [];
  const nextCursor =
    response.next_cursor != null
      ? response.next_cursor
      : response.nextCursor != null
        ? response.nextCursor
        : null;
  const hasMore =
    typeof response.has_more === 'boolean'
      ? response.has_more
      : typeof response.hasMore === 'boolean'
        ? response.hasMore
        : Boolean(nextCursor);
  const sessionId =
    response.session_id != null
      ? response.session_id
      : response.sessionId != null
        ? response.sessionId
        : null;

  return {
    items: rawItems,
    nextCursor: nextCursor ? String(nextCursor) : null,
    hasMore,
    sessionId: sessionId ? String(sessionId) : null,
    meta: response.meta,
  };
}

export const marketFeedApi = {
  pageSize: FEED_PAGE_SIZE,

  async getForYouFeed(params: FeedPageParams = {}): Promise<FeedPageResult> {
    const response = await coreCloudClient.request<{
      success: boolean;
      items?: MarketPost[];
      posts?: MarketPost[];
      next_cursor?: string | null;
      has_more?: boolean;
      session_id?: string | null;
      meta?: Record<string, unknown>;
    }>(apiUrl('/feed'), {
      method: 'POST',
      body: {
        limit: params.limit ?? FEED_PAGE_SIZE,
        cursor: params.cursor ?? null,
        session_id: params.sessionId ?? null,
      },
      requiresAuth: true,
    });
    return normalizeFeedPage(response);
  },

  async getFollowingFeed(params: FeedPageParams = {}): Promise<FeedPageResult> {
    const search = new URLSearchParams();
    search.set('limit', String(params.limit ?? FEED_PAGE_SIZE));
    if (params.cursor) search.set('cursor', params.cursor);
    const response = await coreCloudClient.request<{
      success: boolean;
      items?: MarketPost[];
      posts?: MarketPost[];
      next_cursor?: string | null;
      has_more?: boolean;
      session_id?: string | null;
    }>(`${apiUrl('/feed/following')}?${search.toString()}`, {
      method: 'GET',
      requiresAuth: true,
    });
    return normalizeFeedPage(response);
  },

  async getPublicFeed(params: FeedPageParams = {}): Promise<FeedPageResult> {
    const search = new URLSearchParams();
    search.set('limit', String(params.limit ?? FEED_PAGE_SIZE));
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.sessionId) search.set('session_id', params.sessionId);
    const response = await coreCloudClient.request<{
      success: boolean;
      items?: MarketPost[];
      posts?: MarketPost[];
      next_cursor?: string | null;
      has_more?: boolean;
      session_id?: string | null;
      meta?: Record<string, unknown>;
    }>(`${apiUrl('/feed/public')}?${search.toString()}`, {
      method: 'GET',
      requiresAuth: false,
    });
    return normalizeFeedPage(response);
  },

  /** @deprecated Prefer getForYouFeed with session pagination. */
  async getPersonalizedFeed(excludePostIds: string[] = []): Promise<{
    posts: MarketPost[];
    meta?: { total: number; buckets: { taste: number; trending: number; coldStart: number } };
  }> {
    const response = await coreCloudClient.request<{
      success: boolean;
      posts?: MarketPost[];
      items?: MarketPost[];
      meta?: { total: number; buckets: { taste: number; trending: number; coldStart: number } };
    }>(apiUrl('/feed'), {
      method: 'POST',
      body: { excludePostIds },
      requiresAuth: true,
    });

    const posts = Array.isArray(response.items)
      ? response.items
      : Array.isArray(response.posts)
        ? response.posts
        : [];
    return { posts, meta: response.meta };
  },

  async logWatchSession(metrics: WatchSessionMetrics): Promise<void> {
    await coreCloudClient.request(apiUrl('/social/watch'), {
      method: 'POST',
      body: {
        postId: metrics.postId,
        mediaType: metrics.mediaType,
        watchTimeSec: metrics.watchTimeSec,
        videoDurationSec: metrics.videoDurationSec,
        loopCount: 0,
      },
      requiresAuth: true,
    });
  },

  queueWatchSession(metrics: WatchSessionMetrics) {
    if (!metrics.postId || metrics.watchTimeSec <= 0) return;
    // Client-side minimum watch: accidental swipe-throughs don't count.
    if (metrics.watchTimeSec < 0.5) return;
    pendingWatchSessions.set(metrics.postId, metrics);
    scheduleWatchFlush();
  },

  async logAction(postId: string, actionType: 'chat' | 'favorite'): Promise<void> {
    try {
      await coreCloudClient.request(apiUrl('/social/action'), {
        method: 'POST',
        body: { postId, actionType },
        requiresAuth: true,
      });
    } catch (error) {
      console.warn(`Failed to log ${actionType} interaction:`, error);
    }
  },

  async markSeen(postIds: string[], dwellSec?: number): Promise<void> {
    try {
      await coreCloudClient.request(apiUrl('/feed/seen'), {
        method: 'POST',
        body: { postIds, dwellSec },
        requiresAuth: true,
      });
    } catch (error) {
      console.warn('Failed to mark posts seen:', error);
    }
  },
};
