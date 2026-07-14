import { pool, ensureUser } from './db.mjs';
import { redis } from './redis.mjs';

const PRESENCE_TTL_SEC = 300;

export function presenceRedisKey(userId) {
  return `presence:user:${userId}`;
}

export async function touchPresence(userId) {
  if (!userId) return;
  await ensureUser(userId);
  if (redis) {
    await redis.set(presenceRedisKey(userId), '1', { ex: PRESENCE_TTL_SEC });
  }
  if (pool) {
    await pool.query(
      `INSERT INTO user_presence (user_id, last_seen_at)
       VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
      [userId]
    );
  }
}

export async function getPresenceStatus(userId) {
  if (!userId) return 'offline';
  if (redis) {
    const live = await redis.get(presenceRedisKey(userId));
    if (live) return 'online';
  }
  if (!pool) return 'offline';
  const { rows } = await pool.query(
    `SELECT last_seen_at FROM user_presence WHERE user_id = $1`,
    [userId]
  );
  if (!rows[0]?.last_seen_at) return 'offline';
  return 'last_seen';
}

export async function getPresenceLastSeen(userId) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT last_seen_at FROM user_presence WHERE user_id = $1`,
    [userId]
  );
  return rows[0]?.last_seen_at || null;
}
