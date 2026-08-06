import { pool, ensureUser } from './db.mjs';
import { invalidateFeedCache } from './redis.mjs';
import {
  ACTION_WEIGHTS,
  computeDecayedScore,
  deriveWatchActions,
  normalizeHashtags,
  pointsForActions,
} from './scoring.mjs';

async function resolvePostContext(postId) {
  const { getPostById } = await import('./posts-repo.mjs');
  const post = await getPostById(postId);
  if (!post) {
    const err = new Error('Post not found');
    err.statusCode = 404;
    throw err;
  }
  return {
    postData: post,
    posterId: String(post.posterId || '').trim(),
    hashtags: normalizeHashtags(post.hashtags),
    status: String(post.status || 'active'),
  };
}

async function logInteraction(userId, postId, action, extra = {}) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO interactions (user_id, post_id, action, dwell_sec, media_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, postId, action, extra.dwellSec ?? null, extra.mediaType ?? null]
  );
}

async function applyScoreDeltaPostgres(postId, actions, { incrementViews = 0, postData } = {}) {
  if (!pool) return null;
  const delta = pointsForActions(actions);
  const existing = await pool.query(
    `SELECT total_points, created_at, breakdown FROM post_scores WHERE post_id = $1`,
    [postId]
  );
  const createdAt =
    existing.rows[0]?.created_at ||
    postData?.createdAt?.toDate?.() ||
    new Date(postData?.createdAt || Date.now());
  const totalPoints = Number(existing.rows[0]?.total_points || 0) + delta;
  const score = computeDecayedScore(totalPoints, createdAt);

  const prevBreakdown = existing.rows[0]?.breakdown || {};
  const breakdown = { ...prevBreakdown };
  for (const [action, count] of Object.entries(actions)) {
    const n = Number(count || 0);
    if (!n) continue;
    const key = { full_completion: 'fullCompletion', loop: 'loops', dwell: 'dwell', chat: 'chat', like: 'likes', favorite: 'favorites', immediate_skip: 'skips' }[action];
    if (key) breakdown[key] = Math.max(0, Number(breakdown[key] || 0) + n);
  }

  const posterId = String(postData?.posterId || postData?.poster_id || '').trim();
  const { rows } = await pool.query(
    `INSERT INTO post_scores (post_id, poster_id, hashtags, media_type, status, total_points, score, breakdown, views_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (post_id) DO UPDATE SET
       total_points = EXCLUDED.total_points,
       score = EXCLUDED.score,
       breakdown = EXCLUDED.breakdown,
       views_count = post_scores.views_count + EXCLUDED.views_count,
       updated_at = now()
     RETURNING total_points, score`,
    [
      postId,
      posterId || 'unknown',
      normalizeHashtags(postData?.hashtags),
      postData?.mediaType || null,
      postData?.status || 'active',
      totalPoints,
      score,
      JSON.stringify(breakdown),
      incrementViews,
      createdAt,
    ]
  );

  if (incrementViews > 0) {
    await pool.query(
      `UPDATE posts SET views_count = views_count + $2, updated_at = now() WHERE id = $1`,
      [postId, incrementViews]
    ).catch(() => {});
  }

  return rows[0] || null;
}

export async function recordWatchSession(userId, body) {
  const postId = String(body.postId || '').trim();
  if (!postId) {
    const err = new Error('Post ID is required');
    err.statusCode = 400;
    throw err;
  }

  const { posterId, status, postData } = await resolvePostContext(postId);
  if (status !== 'active') return { success: true, skipped: true };
  if (posterId === userId) return { success: true, skipped: true, reason: 'own_post' };

  await ensureUser(userId);

  const watchPayload = {
    postId,
    watchTimeSec: Number(body.watchTimeSec || 0),
    videoDurationSec: Number(body.videoDurationSec || 0),
    mediaType: String(body.mediaType || 'video').trim(),
  };

  const derivedActions = deriveWatchActions(watchPayload);
  const hasEngagement = Object.keys(derivedActions).length > 0;

  await logInteraction(userId, postId, 'watch_session', {
    dwellSec: watchPayload.watchTimeSec,
    mediaType: watchPayload.mediaType,
  });

  if (hasEngagement) {
    for (const [action, count] of Object.entries(derivedActions)) {
      if (!count) continue;
      await logInteraction(userId, postId, action);
    }
  }

  const pgResult = await applyScoreDeltaPostgres(postId, derivedActions, {
    incrementViews: 1,
    postData,
  });

  return {
    success: true,
    actions: derivedActions,
    totalPoints: pgResult?.total_points,
    score: pgResult?.score,
  };
}

export async function recordAction(userId, postId, actionType) {
  const id = String(postId || '').trim();
  if (!id) {
    const err = new Error('Post ID is required');
    err.statusCode = 400;
    throw err;
  }
  if (!(actionType in ACTION_WEIGHTS)) {
    const err = new Error('Unsupported action type');
    err.statusCode = 400;
    throw err;
  }

  const { posterId, status, postData } = await resolvePostContext(id);
  if (status !== 'active') return { success: true, skipped: true };
  if (posterId === userId) return { success: true, skipped: true, reason: 'own_post' };

  await ensureUser(userId);
  await logInteraction(userId, id, actionType);
  const pgResult = await applyScoreDeltaPostgres(id, { [actionType]: 1 }, { postData });

  return {
    success: true,
    action: actionType,
    totalPoints: pgResult?.total_points,
    score: pgResult?.score,
  };
}

export async function likePost(userId, postId) {
  const id = String(postId || '').trim();
  if (!id) {
    const err = new Error('Post ID is required');
    err.statusCode = 400;
    throw err;
  }
  if (!pool) {
    const err = new Error('Database is not configured');
    err.statusCode = 503;
    throw err;
  }

  await ensureUser(userId);
  const { getPostById } = await import('./posts-repo.mjs');
  const postData = await getPostById(id);
  if (!postData) {
    const err = new Error('Post not found');
    err.statusCode = 404;
    throw err;
  }

  const posterId = String(postData.posterId || '').trim();
  const existing = await pool.query(
    `SELECT 1 FROM user_liked_posts WHERE user_id = $1 AND post_id = $2 LIMIT 1`,
    [userId, id]
  );
  let isLiked = false;
  let likes = Number(postData.likes || 0);

  if (existing.rows.length) {
    await pool.query(`DELETE FROM user_liked_posts WHERE user_id = $1 AND post_id = $2`, [
      userId,
      id,
    ]);
    const { rows } = await pool.query(
      `UPDATE posts
       SET likes_count = GREATEST(0, likes_count - 1),
           liked_by = array_remove(liked_by, $2),
           updated_at = now()
       WHERE id = $1
       RETURNING likes_count`,
      [id, userId]
    );
    likes = Number(rows[0]?.likes_count || 0);
    isLiked = false;
    if (posterId && posterId !== userId) {
      await logInteraction(userId, id, 'unlike');
      await applyScoreDeltaPostgres(id, { like: -1 }, { postData });
    }
  } else {
    await pool.query(
      `INSERT INTO user_liked_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, id]
    );
    const { rows } = await pool.query(
      `UPDATE posts
       SET likes_count = likes_count + 1,
           liked_by = CASE
             WHEN $2 = ANY(liked_by) THEN liked_by
             ELSE array_append(liked_by, $2)
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING likes_count`,
      [id, userId]
    );
    likes = Number(rows[0]?.likes_count || likes + 1);
    isLiked = true;
    if (posterId && posterId !== userId) {
      await logInteraction(userId, id, 'like');
      await applyScoreDeltaPostgres(id, { like: 1 }, { postData });
    }
  }

  await invalidateFeedCache(userId);
  return { success: true, likes, isLiked, postId: id, posterId };
}

export async function unlikePost(userId, postId) {
  const id = String(postId || '').trim();
  if (!id) {
    const err = new Error('Post ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (pool) {
    await pool.query(`DELETE FROM user_liked_posts WHERE user_id = $1 AND post_id = $2`, [
      userId,
      id,
    ]);
    await pool.query(
      `UPDATE posts
       SET likes_count = GREATEST(0, likes_count - 1),
           liked_by = array_remove(liked_by, $2),
           updated_at = now()
       WHERE id = $1`,
      [id, userId]
    );
  }

  await invalidateFeedCache(userId);
  return { success: true, postId: id };
}

export async function markPostsSeen(userId, postIds, dwellSec) {
  const ids = (Array.isArray(postIds) ? postIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (ids.length === 0) return { success: true, count: 0 };

  // Ignore flicker / fast-scroll marks — require real dwell when provided.
  const dwell = dwellSec == null ? null : Number(dwellSec);
  if (dwell != null && Number.isFinite(dwell) && dwell < 1.2) {
    return { success: true, count: 0, skipped: true, reason: 'dwell_too_short' };
  }

  await ensureUser(userId);

  if (pool) {
    for (const postId of ids) {
      await pool.query(
        `INSERT INTO user_seen_posts (user_id, post_id, dwell_sec)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, post_id) DO UPDATE SET seen_at = now(), dwell_sec = COALESCE($3, user_seen_posts.dwell_sec)`,
        [userId, postId, dwell ?? null]
      );
    }
  }

  await invalidateFeedCache(userId);
  return { success: true, count: ids.length };
}

export async function refreshScoreDecay(limit = 200) {
  if (!pool) return 0;

  const { rows } = await pool.query(
    `UPDATE post_scores SET
       score = (total_points / (POW(
         COALESCE(EXTRACT(EPOCH FROM (now() - created_at)) / 3600, 0) + 2, 1.5
       ))::numeric),
       updated_at = now()
     WHERE status = 'active'
     RETURNING post_id`,
    []
  );

  return rows.length;
}
