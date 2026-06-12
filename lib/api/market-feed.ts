import { coreCloudClient } from './core-cloud-client';
import type { MarketPost } from '@/types';

const MARKET_FEED_FUNCTIONS = {
  logMarketPostInteraction: 'https://logmarketpostinteraction-q3rjv54uka-uc.a.run.app',
  getPersonalizedMarketFeed: 'https://getpersonalizedmarketfeed-q3rjv54uka-uc.a.run.app',
};

export interface WatchSessionMetrics {
  postId: string;
  mediaType: 'video' | 'image_gallery';
  watchTimeSec: number;
  videoDurationSec: number;
  loopCount: number;
}

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

export const marketFeedApi = {
  async getPersonalizedFeed(excludePostIds: string[] = []): Promise<{
    posts: MarketPost[];
    meta?: { total: number; buckets: { taste: number; trending: number; coldStart: number } };
  }> {
    const response = await coreCloudClient.request<{
      success: boolean;
      posts: MarketPost[];
      meta?: { total: number; buckets: { taste: number; trending: number; coldStart: number } };
    }>(MARKET_FEED_FUNCTIONS.getPersonalizedMarketFeed, {
      method: 'POST',
      body: { excludePostIds },
      requiresAuth: true,
    });

    return {
      posts: Array.isArray(response.posts) ? response.posts : [],
      meta: response.meta,
    };
  },

  async logWatchSession(metrics: WatchSessionMetrics): Promise<void> {
    await coreCloudClient.request(MARKET_FEED_FUNCTIONS.logMarketPostInteraction, {
      method: 'POST',
      body: {
        postId: metrics.postId,
        actionType: 'watch_session',
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
    pendingWatchSessions.set(metrics.postId, metrics);
    scheduleWatchFlush();
  },

  async logAction(postId: string, actionType: 'chat' | 'favorite'): Promise<void> {
    try {
      await coreCloudClient.request(MARKET_FEED_FUNCTIONS.logMarketPostInteraction, {
        method: 'POST',
        body: { postId, actionType },
        requiresAuth: true,
      });
    } catch (error) {
      console.warn(`Failed to log ${actionType} interaction:`, error);
    }
  },
};
