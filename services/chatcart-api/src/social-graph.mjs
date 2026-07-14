import { randomUUID } from 'crypto';
import { pool, ensureUser } from './db.mjs';

function requirePool() {
  if (!pool) {
    const err = new Error('Database is not configured');
    err.statusCode = 503;
    throw err;
  }
  return pool;
}

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function asString(value) {
  return String(value ?? '').trim();
}

export async function listFollowingIds(userId) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT followed_id FROM follows WHERE follower_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [userId]
  );
  return rows.map((r) => r.followed_id);
}

export async function listFollowerIds(userId) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT follower_id FROM follows WHERE followed_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [userId]
  );
  return rows.map((r) => r.follower_id);
}

export async function followUser(followerId, followedId) {
  const db = requirePool();
  const follower = asString(followerId);
  const followed = asString(followedId);
  if (!follower || !followed) throw httpError('Invalid user id');
  if (follower === followed) throw httpError('Cannot follow yourself');
  await ensureUser(follower);
  await ensureUser(followed);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING follower_id`,
      [follower, followed]
    );
    if (inserted.rowCount > 0) {
      await client.query(
        `UPDATE users SET following_count = following_count + 1, updated_at = now() WHERE id = $1`,
        [follower]
      );
      await client.query(
        `UPDATE users SET follower_count = follower_count + 1, updated_at = now() WHERE id = $1`,
        [followed]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { success: true, following: true };
}

export async function unfollowUser(followerId, followedId) {
  const db = requirePool();
  const follower = asString(followerId);
  const followed = asString(followedId);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      `DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2 RETURNING follower_id`,
      [follower, followed]
    );
    if (deleted.rowCount > 0) {
      await client.query(
        `UPDATE users SET following_count = GREATEST(0, following_count - 1), updated_at = now() WHERE id = $1`,
        [follower]
      );
      await client.query(
        `UPDATE users SET follower_count = GREATEST(0, follower_count - 1), updated_at = now() WHERE id = $1`,
        [followed]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { success: true, following: false };
}

export async function isFollowing(followerId, followedId) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2 LIMIT 1`,
    [followerId, followedId]
  );
  return rows.length > 0;
}

export async function savePost(userId, postId) {
  const db = requirePool();
  await ensureUser(userId);
  await db.query(
    `INSERT INTO user_saved_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, asString(postId)]
  );
  return { success: true, saved: true };
}

export async function unsavePost(userId, postId) {
  const db = requirePool();
  await db.query(`DELETE FROM user_saved_posts WHERE user_id = $1 AND post_id = $2`, [
    userId,
    asString(postId),
  ]);
  return { success: true, saved: false };
}

export async function listSavedPostIds(userId, limit = 100) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT post_id FROM user_saved_posts WHERE user_id = $1 ORDER BY saved_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => r.post_id);
}

export async function listLikedPostIds(userId, limit = 300) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT post_id FROM user_liked_posts WHERE user_id = $1 ORDER BY liked_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => r.post_id);
}

export async function blockUser(blockerId, blockedId) {
  const db = requirePool();
  const blocker = asString(blockerId);
  const blocked = asString(blockedId);
  if (!blocker || !blocked || blocker === blocked) throw httpError('Invalid block');
  await ensureUser(blocker);
  await ensureUser(blocked);
  await db.query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [blocker, blocked]
  );
  await unfollowUser(blocker, blocked).catch(() => {});
  await unfollowUser(blocked, blocker).catch(() => {});
  return { success: true, blocked: true };
}

export async function unblockUser(blockerId, blockedId) {
  const db = requirePool();
  await db.query(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [
    blockerId,
    blockedId,
  ]);
  return { success: true, blocked: false };
}

export async function listBlockedIds(blockerId) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT blocked_id FROM user_blocks WHERE blocker_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [blockerId]
  );
  return rows.map((r) => r.blocked_id);
}

export async function isBlockedEither(a, b) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT 1 FROM user_blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [a, b]
  );
  return rows.length > 0;
}

export async function listComments(postId, { limit = 50, before } = {}) {
  const db = requirePool();
  const params = [asString(postId), Math.min(100, Math.max(1, Number(limit) || 50))];
  let sql = `
    SELECT c.*, u.display_name, u.avatar_url
    FROM post_comments c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.post_id = $1
  `;
  if (before) {
    sql += ` AND c.created_at < $3::timestamptz`;
    params.push(before);
  }
  sql += ` ORDER BY c.created_at DESC LIMIT $2`;
  const { rows } = await db.query(sql, params);
  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    text: row.body,
    body: row.body,
    displayName: row.display_name || 'User',
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
  }));
}

export async function createComment(userId, postId, body) {
  const db = requirePool();
  const text = asString(body);
  if (!text) throw httpError('Comment text is required');
  await ensureUser(userId);
  const id = randomUUID();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO post_comments (id, post_id, user_id, body) VALUES ($1, $2, $3, $4)`,
      [id, asString(postId), userId, text]
    );
    await client.query(
      `UPDATE posts SET comments_count = comments_count + 1, updated_at = now() WHERE id = $1`,
      [asString(postId)]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const comments = await listComments(postId, { limit: 1 });
  return comments[0] || { id, postId, userId, text, body: text };
}

export async function deleteComment(userId, commentId) {
  const db = requirePool();
  const { rows } = await db.query(`SELECT * FROM post_comments WHERE id = $1 LIMIT 1`, [
    asString(commentId),
  ]);
  const row = rows[0];
  if (!row) throw httpError('Comment not found', 404);
  if (row.user_id !== userId) throw httpError('Forbidden', 403);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM post_comments WHERE id = $1`, [row.id]);
    await client.query(
      `UPDATE posts SET comments_count = GREATEST(0, comments_count - 1), updated_at = now() WHERE id = $1`,
      [row.post_id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { success: true };
}
