import { randomUUID } from 'crypto';
import {
  BUCKET_A_SIZE,
  BUCKET_B_SIZE,
  BUCKET_C_SIZE,
  FEED_PAGE_SIZE,
  FEED_SESSION_SIZE,
  TASTE_INTERACTION_LIMIT,
  config,
} from './config.mjs';
import { pool } from './db.mjs';
import { feedSessionKey, redis } from './redis.mjs';
import { normalizeHashtags } from './scoring.mjs';
import {
  fetchColdStartPostIds as fetchColdStartPostIdsPg,
  hydratePosts as hydratePostsPg,
} from './posts-repo.mjs';
import { listFollowingIds } from './social-graph.mjs';

/** Process-local fallback when Redis is unavailable. */
const memorySessions = new Map();

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function interleaveBuckets(buckets) {
  const queues = buckets.map((bucket) => [...bucket]);
  const merged = [];
  while (queues.some((queue) => queue.length > 0)) {
    queues.forEach((queue) => {
      if (queue.length > 0) merged.push(queue.shift());
    });
  }
  return merged;
}

function parseLimit(raw, fallback = FEED_PAGE_SIZE) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(30, Math.max(1, Math.floor(n)));
}

function parseOffsetCursor(cursor) {
  if (cursor == null || cursor === '') return 0;
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function encodeFollowingCursor(createdAtMs, postId) {
  return `${createdAtMs}_${postId}`;
}

function parseFollowingCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  const idx = cursor.indexOf('_');
  if (idx <= 0) return null;
  const ms = Number(cursor.slice(0, idx));
  const postId = cursor.slice(idx + 1).trim();
  if (!Number.isFinite(ms) || !postId) return null;
  return { createdAtMs: ms, postId };
}

async function getUserLikedPostIds(userId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT post_id FROM user_liked_posts WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.post_id);
}

async function getUserSeenPostIds(userId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT post_id FROM user_seen_posts WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.post_id);
}

async function getUserTasteHashtags(userId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT ps.hashtags
     FROM interactions i
     JOIN post_scores ps ON ps.post_id = i.post_id
     WHERE i.user_id = $1 AND i.action IN ('full_completion', 'chat')
     ORDER BY i.created_at DESC
     LIMIT $2`,
    [userId, TASTE_INTERACTION_LIMIT]
  );
  const tags = new Set();
  rows.forEach((row) => normalizeHashtags(row.hashtags).forEach((t) => tags.add(t)));
  return Array.from(tags).slice(0, 10);
}

async function fetchScorePostIdsFromPostgres(tasteTags, limit, excludeIds) {
  if (!pool) return [];
  const params = [limit * 3];
  let sql = `SELECT post_id FROM post_scores WHERE status = 'active'`;
  if (tasteTags.length > 0) {
    params.push(tasteTags);
    sql += ` AND hashtags && $${params.length}::text[]`;
  }
  sql += ` ORDER BY score DESC LIMIT $1`;
  const { rows } = await pool.query(sql, params);
  const ids = [];
  for (const row of rows) {
    const postId = String(row.post_id || '').trim();
    if (!postId || excludeIds.has(postId)) continue;
    ids.push(postId);
    if (ids.length >= limit) break;
  }
  return ids;
}

async function fetchScorePostIds(tasteTags, limit, excludeIds) {
  const pgIds = await fetchScorePostIdsFromPostgres(tasteTags, limit, excludeIds);
  return pgIds.filter((id) => !excludeIds.has(id)).slice(0, limit);
}

async function fetchActivePostIdsFromPostgres(limit, excludeIds) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id FROM posts
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.max(limit * 2, limit)]
  );
  const ids = [];
  for (const row of rows) {
    const postId = String(row.id || '').trim();
    if (!postId || excludeIds.has(postId)) continue;
    ids.push(postId);
    if (ids.length >= limit) break;
  }
  return ids;
}

async function fetchColdStartPostIds(limit, excludeIds) {
  try {
    return await fetchColdStartPostIdsPg(limit, excludeIds);
  } catch {
    return [];
  }
}

async function hydratePosts(postIds) {
  try {
    return await hydratePostsPg(postIds);
  } catch {
    return {};
  }
}

async function saveSession(ownerKey, sessionId, orderedIds) {
  const ttl = config.feedSessionTtlSec || 7200;
  if (redis) {
    await redis.set(feedSessionKey(ownerKey, sessionId), orderedIds, { ex: ttl });
    return;
  }
  memorySessions.set(`${ownerKey}:${sessionId}`, {
    ids: orderedIds,
    expiresAt: Date.now() + ttl * 1000,
  });
}

async function loadSession(ownerKey, sessionId) {
  if (!sessionId) return null;
  if (redis) {
    const cached = await redis.get(feedSessionKey(ownerKey, sessionId));
    return Array.isArray(cached) && cached.length > 0 ? cached.map(String) : null;
  }
  const entry = memorySessions.get(`${ownerKey}:${sessionId}`);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memorySessions.delete(`${ownerKey}:${sessionId}`);
    return null;
  }
  return Array.isArray(entry.ids) ? entry.ids.map(String) : null;
}

/**
 * Rank candidate pools into an ordered ID list (no hydrate).
 * @param {string|null} userId - null = public / no taste
 */
async function rankOrderedIds(userId) {
  const excludeIds = new Set();

  let tasteTags = [];
  if (userId) {
    const [tags, likedPg, seenPg] = await Promise.all([
      getUserTasteHashtags(userId),
      getUserLikedPostIds(userId),
      getUserSeenPostIds(userId),
    ]);
    tasteTags = tags;
    [...likedPg, ...seenPg].forEach((id) => excludeIds.add(id));
  }

  const [bucketAIds, bucketBIds, bucketCIds] = await Promise.all([
    tasteTags.length
      ? fetchScorePostIds(tasteTags, BUCKET_A_SIZE, excludeIds)
      : Promise.resolve([]),
    fetchScorePostIds([], BUCKET_B_SIZE, excludeIds),
    fetchColdStartPostIds(BUCKET_C_SIZE, excludeIds),
  ]);

  const used = new Set(excludeIds);
  const takeUnique = (ids, target) => {
    const picked = [];
    ids.forEach((id) => {
      if (picked.length >= target) return;
      if (used.has(id)) return;
      used.add(id);
      picked.push(id);
    });
    return picked;
  };

  let taste = takeUnique(shuffleInPlace([...bucketAIds]), BUCKET_A_SIZE);
  let trending = takeUnique(shuffleInPlace([...bucketBIds]), BUCKET_B_SIZE);
  let coldStart = takeUnique(shuffleInPlace([...bucketCIds]), BUCKET_C_SIZE);

  const shortfall = FEED_SESSION_SIZE - (taste.length + trending.length + coldStart.length);
  if (shortfall > 0) {
    const backfill = await fetchScorePostIds([], shortfall, used);
    trending = [...trending, ...takeUnique(backfill, shortfall)];
  }

  let orderedIds = interleaveBuckets([
    shuffleInPlace(taste),
    shuffleInPlace(trending),
    shuffleInPlace(coldStart),
  ]).slice(0, FEED_SESSION_SIZE);

  if (orderedIds.length < FEED_SESSION_SIZE) {
    const fallbackIds = await fetchActivePostIdsFromPostgres(FEED_SESSION_SIZE, used);
    fallbackIds.forEach((id) => {
      if (orderedIds.length >= FEED_SESSION_SIZE) return;
      used.add(id);
      orderedIds.push(id);
    });
  }

  return {
    orderedIds,
    meta: {
      buckets: { taste: taste.length, trending: trending.length, coldStart: coldStart.length },
      tasteTags,
    },
  };
}

async function sliceSessionPage(orderedIds, offset, limit) {
  const pageIds = [];
  let cursor = offset;
  const postsById = await hydratePosts(orderedIds.slice(offset, Math.min(orderedIds.length, offset + limit * 3)));

  while (pageIds.length < limit && cursor < orderedIds.length) {
    const chunkEnd = Math.min(orderedIds.length, cursor + (limit - pageIds.length) * 2 + 10);
    const needHydrate = orderedIds.slice(cursor, chunkEnd).filter((id) => !postsById[id]);
    if (needHydrate.length) {
      Object.assign(postsById, await hydratePosts(needHydrate));
    }
    for (; cursor < chunkEnd && pageIds.length < limit; cursor += 1) {
      const post = postsById[orderedIds[cursor]];
      if (post && post.status === 'active') {
        pageIds.push(orderedIds[cursor]);
      }
    }
  }

  const items = pageIds.map((id) => postsById[id]).filter(Boolean);
  const nextOffset = cursor;
  const hasMore = nextOffset < orderedIds.length;
  return {
    items,
    next_cursor: hasMore ? String(nextOffset) : null,
    has_more: hasMore,
  };
}

/**
 * Session-pinned For You feed.
 * Body: { limit?, cursor?, session_id? }
 * Legacy: { excludePostIds } still accepted — forces a fresh session page (no pin continuity).
 */
export async function buildPersonalizedFeed(userId, options = {}) {
  const limit = parseLimit(options.limit ?? config.feedPageSize);
  const ownerKey = `user:${userId}`;
  let sessionId = String(options.session_id || options.sessionId || '').trim() || null;
  const offset = parseOffsetCursor(options.cursor);

  // Legacy excludePostIds path: one-shot ranked page (no session continuity).
  if (Array.isArray(options.excludePostIds) && options.excludePostIds.length > 0 && !sessionId) {
    const excludeIds = new Set(
      options.excludePostIds.map((id) => String(id || '').trim()).filter(Boolean)
    );
    const { orderedIds, meta } = await rankOrderedIds(userId);
    const filtered = orderedIds.filter((id) => !excludeIds.has(id)).slice(0, limit);
    const postsById = await hydratePosts(filtered);
    const posts = filtered.map((id) => postsById[id]).filter((p) => p && p.status === 'active');
    return {
      items: posts,
      posts,
      next_cursor: null,
      has_more: posts.length >= limit,
      session_id: null,
      meta: { ...meta, total: posts.length, legacy: true },
    };
  }

  let orderedIds = sessionId ? await loadSession(ownerKey, sessionId) : null;
  let meta = {};

  if (!orderedIds) {
    const ranked = await rankOrderedIds(userId);
    orderedIds = ranked.orderedIds;
    meta = ranked.meta;
    sessionId = randomUUID();
    await saveSession(ownerKey, sessionId, orderedIds);
  }

  const page = await sliceSessionPage(orderedIds, offset, limit);
  return {
    items: page.items,
    posts: page.items,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    session_id: sessionId,
    meta: { ...meta, total: orderedIds.length, offset },
  };
}

/** Public ranked feed (no auth / no taste). Session-pinned under anon owner. */
export async function buildPublicFeed(options = {}) {
  const limit = parseLimit(options.limit ?? config.feedPageSize);
  const ownerKey = 'anon';
  let sessionId = String(options.session_id || options.sessionId || '').trim() || null;
  const offset = parseOffsetCursor(options.cursor);

  let orderedIds = sessionId ? await loadSession(ownerKey, sessionId) : null;
  let meta = {};

  if (!orderedIds) {
    const ranked = await rankOrderedIds(null);
    orderedIds = ranked.orderedIds;
    meta = ranked.meta;
    sessionId = randomUUID();
    await saveSession(ownerKey, sessionId, orderedIds);
  }

  const page = await sliceSessionPage(orderedIds, offset, limit);
  return {
    items: page.items,
    posts: page.items,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    session_id: sessionId,
    meta: { ...meta, total: orderedIds.length, offset, public: true },
  };
}

async function getFollowingUserIds(userId) {
  try {
    return await listFollowingIds(userId);
  } catch {
    return [];
  }
}

function postCreatedAtMs(post) {
  const raw = post?.createdAt;
  if (!raw) return 0;
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (raw._seconds != null) return Number(raw._seconds) * 1000;
  if (raw instanceof Date) return raw.getTime();
  const n = Date.parse(String(raw));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Following feed: reverse-chron from followed accounts. No ranking, no session pin.
 */
export async function buildFollowingFeed(userId, options = {}) {
  const limit = parseLimit(options.limit ?? config.feedPageSize);
  const followingIds = await getFollowingUserIds(userId);
  if (followingIds.length === 0 || !pool) {
    return { items: [], posts: [], next_cursor: null, has_more: false, session_id: null };
  }

  const cursor = parseFollowingCursor(options.cursor);
  const params = [followingIds, limit + 1];
  let sql = `
    SELECT * FROM posts
    WHERE status = 'active' AND poster_id = ANY($1::text[])
  `;
  if (cursor) {
    sql += ` AND (created_at, id) < (to_timestamp($3::double precision / 1000.0), $4)`;
    params.push(cursor.createdAtMs, cursor.postId);
  }
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $2`;

  const { rows } = await pool.query(sql, params);
  const { hydratePosts: hydrate } = await import('./posts-repo.mjs');
  const pageRows = rows.slice(0, limit);
  const byId = await hydrate(pageRows.map((r) => r.id));
  const items = pageRows.map((r) => byId[r.id]).filter(Boolean);
  const last = pageRows[pageRows.length - 1];
  const hasMore = rows.length > limit;

  return {
    items,
    posts: items,
    next_cursor:
      hasMore && last
        ? encodeFollowingCursor(new Date(last.created_at).getTime(), last.id)
        : null,
    has_more: hasMore,
    session_id: null,
  };
}
