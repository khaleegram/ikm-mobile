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

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapSoundRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: asString(row.title) || 'Untitled sound',
    createdBy: row.created_by,
    creatorName: asString(row.creator_name) || undefined,
    sourceType: row.source_type || 'uploaded',
    sourceUri: asString(row.source_uri),
    artworkUrl: asString(row.artwork_url) || undefined,
    durationMs:
      row.duration_ms != null && Number.isFinite(Number(row.duration_ms))
        ? Number(row.duration_ms)
        : undefined,
    usageCount: Number(row.usage_count || 0),
    savedCount: Number(row.saved_count || 0),
    rightsStatus: row.rights_status || 'owned',
    status: row.status || 'active',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function countPostsForSound(db, soundId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM posts
     WHERE status = 'active'
       AND sound_meta IS NOT NULL
       AND sound_meta->>'soundId' = $1`,
    [soundId]
  );
  return Number(rows[0]?.c || 0);
}

/**
 * Upsert a sound row from denormalized post.sound_meta (or extraction results).
 * Usage count is refreshed from live posts when possible.
 */
export async function upsertSound(payload = {}) {
  const db = requirePool();
  const id = asString(payload.id || payload.soundId);
  if (!id) throw httpError('soundId is required');

  const createdBy = asString(payload.createdBy || payload.created_by);
  if (!createdBy) throw httpError('createdBy is required');
  await ensureUser(createdBy);

  const title = asString(payload.title) || 'Untitled sound';
  const sourceType = asString(payload.sourceType || payload.source_type) || 'uploaded';
  const sourceUri = asString(payload.sourceUri || payload.source_uri);
  const artworkUrl = asString(payload.artworkUrl || payload.artwork_url) || null;
  const creatorName = asString(payload.creatorName || payload.creator_name) || null;
  const durationMs =
    payload.durationMs != null && Number.isFinite(Number(payload.durationMs))
      ? Math.max(0, Math.round(Number(payload.durationMs)))
      : payload.duration_ms != null && Number.isFinite(Number(payload.duration_ms))
        ? Math.max(0, Math.round(Number(payload.duration_ms)))
        : null;
  const rightsStatus = asString(payload.rightsStatus || payload.rights_status) || 'owned';
  const status = asString(payload.status) || 'active';

  let usageCount =
    payload.usageCount != null && Number.isFinite(Number(payload.usageCount))
      ? Math.max(0, Math.round(Number(payload.usageCount)))
      : null;
  if (usageCount == null) {
    usageCount = await countPostsForSound(db, id);
  }

  const { rows } = await db.query(
    `INSERT INTO sounds (
       id, title, created_by, creator_name, source_type, source_uri, artwork_url,
       duration_ms, usage_count, rights_status, status, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, now(), now()
     )
     ON CONFLICT (id) DO UPDATE SET
       title = COALESCE(NULLIF(EXCLUDED.title, ''), sounds.title),
       creator_name = COALESCE(EXCLUDED.creator_name, sounds.creator_name),
       source_type = COALESCE(NULLIF(EXCLUDED.source_type, ''), sounds.source_type),
       source_uri = CASE
         WHEN EXCLUDED.source_uri IS NOT NULL AND EXCLUDED.source_uri <> '' THEN EXCLUDED.source_uri
         ELSE sounds.source_uri
       END,
       artwork_url = COALESCE(EXCLUDED.artwork_url, sounds.artwork_url),
       duration_ms = COALESCE(EXCLUDED.duration_ms, sounds.duration_ms),
       usage_count = GREATEST(EXCLUDED.usage_count, sounds.usage_count),
       rights_status = COALESCE(NULLIF(EXCLUDED.rights_status, ''), sounds.rights_status),
       status = COALESCE(NULLIF(EXCLUDED.status, ''), sounds.status),
       updated_at = now()
     RETURNING *`,
    [
      id,
      title,
      createdBy,
      creatorName,
      sourceType,
      sourceUri,
      artworkUrl,
      durationMs,
      usageCount,
      rightsStatus,
      status,
    ]
  );
  return mapSoundRow(rows[0]);
}

/** Materialize a sound from posts.sound_meta when the catalog row is missing. */
async function ensureSoundFromPosts(soundId) {
  const db = requirePool();
  const id = asString(soundId);
  if (!id) return null;

  const { rows } = await db.query(
    `SELECT poster_id, sound_meta, cover_url, created_at
     FROM posts
     WHERE status = 'active'
       AND sound_meta IS NOT NULL
       AND sound_meta->>'soundId' = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row?.sound_meta) return null;

  const meta = typeof row.sound_meta === 'string' ? JSON.parse(row.sound_meta) : row.sound_meta;
  return upsertSound({
    id,
    title: meta.title || 'Untitled sound',
    createdBy: row.poster_id,
    creatorName: meta.creatorName,
    sourceType: meta.sourceType || 'original',
    sourceUri: meta.sourceUri || '',
    artworkUrl: meta.artworkUrl || row.cover_url,
    durationMs: meta.durationMs,
    rightsStatus: 'owned',
    status: 'active',
  });
}

export async function getSoundById(soundId) {
  const db = requirePool();
  const id = asString(soundId);
  if (!id) return null;

  const { rows } = await db.query(`SELECT * FROM sounds WHERE id = $1 LIMIT 1`, [id]);
  if (rows[0]) {
    const usageCount = await countPostsForSound(db, id);
    if (usageCount !== Number(rows[0].usage_count || 0)) {
      const { rows: updated } = await db.query(
        `UPDATE sounds SET usage_count = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, usageCount]
      );
      return mapSoundRow(updated[0] || rows[0]);
    }
    return mapSoundRow(rows[0]);
  }

  return ensureSoundFromPosts(id);
}

export async function listSounds({ limit = 60, q = '' } = {}) {
  const db = requirePool();
  const safeLimit = Math.min(120, Math.max(1, Number(limit) || 60));
  const term = asString(q).toLowerCase();

  let rows;
  if (term) {
    const result = await db.query(
      `SELECT * FROM sounds
       WHERE status = 'active'
         AND (
           lower(title) LIKE $1
           OR lower(COALESCE(creator_name, '')) LIKE $1
         )
       ORDER BY usage_count DESC, created_at DESC
       LIMIT $2`,
      [`%${term}%`, safeLimit]
    );
    rows = result.rows;
  } else {
    const result = await db.query(
      `SELECT * FROM sounds
       WHERE status = 'active'
       ORDER BY usage_count DESC, created_at DESC
       LIMIT $1`,
      [safeLimit]
    );
    rows = result.rows;
  }
  return rows.map(mapSoundRow);
}

export async function listSavedSoundIds(userId, limit = 150) {
  const db = requirePool();
  const uid = asString(userId);
  if (!uid) return [];
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 150));
  const { rows } = await db.query(
    `SELECT sound_id FROM sound_saves
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [uid, safeLimit]
  );
  return rows.map((r) => r.sound_id);
}

export async function listSavedSounds(userId, limit = 150) {
  const db = requirePool();
  const uid = asString(userId);
  if (!uid) return [];
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 150));
  const { rows } = await db.query(
    `SELECT s.*
     FROM sound_saves ss
     JOIN sounds s ON s.id = ss.sound_id
     WHERE ss.user_id = $1 AND s.status = 'active'
     ORDER BY ss.created_at DESC
     LIMIT $2`,
    [uid, safeLimit]
  );
  return rows.map(mapSoundRow);
}

export async function isSoundSaved(userId, soundId) {
  const db = requirePool();
  const uid = asString(userId);
  const sid = asString(soundId);
  if (!uid || !sid) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM sound_saves WHERE user_id = $1 AND sound_id = $2 LIMIT 1`,
    [uid, sid]
  );
  return Boolean(rows[0]);
}

export async function saveSound(userId, soundId) {
  const db = requirePool();
  const uid = asString(userId);
  const sid = asString(soundId);
  if (!uid || !sid) throw httpError('userId and soundId are required');

  await ensureUser(uid);
  let sound = await getSoundById(sid);
  if (!sound) throw httpError('Sound not found', 404);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO sound_saves (user_id, sound_id, created_at)
       VALUES ($1, $2, now())
       ON CONFLICT DO NOTHING
       RETURNING sound_id`,
      [uid, sid]
    );
    if (inserted.rowCount > 0) {
      await client.query(
        `UPDATE sounds
         SET saved_count = GREATEST(0, saved_count + 1), updated_at = now()
         WHERE id = $1`,
        [sid]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  sound = await getSoundById(sid);
  return { success: true, sound, saved: true };
}

export async function unsaveSound(userId, soundId) {
  const db = requirePool();
  const uid = asString(userId);
  const sid = asString(soundId);
  if (!uid || !sid) throw httpError('userId and soundId are required');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      `DELETE FROM sound_saves WHERE user_id = $1 AND sound_id = $2 RETURNING sound_id`,
      [uid, sid]
    );
    if (deleted.rowCount > 0) {
      await client.query(
        `UPDATE sounds
         SET saved_count = GREATEST(0, saved_count - 1), updated_at = now()
         WHERE id = $1`,
        [sid]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const sound = await getSoundById(sid);
  return { success: true, sound, saved: false };
}
