import { Redis } from '@upstash/redis';
import { config } from './config.mjs';

export const redis =
  config.upstashUrl && config.upstashToken
    ? new Redis({ url: config.upstashUrl, token: config.upstashToken })
    : null;

export function feedCacheKey(userId) {
  return `feed:user:${userId}`;
}

export function feedSessionKey(ownerKey, sessionId) {
  return `feed_session:${ownerKey}:${sessionId}`;
}

export async function invalidateFeedCache(userId) {
  if (!redis) return;
  await redis.del(feedCacheKey(userId));
}
