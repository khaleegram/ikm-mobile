import { randomUUID } from 'crypto';
import { pool, ensureUser } from './db.mjs';
import { collectMediaPathsFromPost, deleteStorageObjects } from './media.mjs';

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

function normalizeHashtags(value) {
  if (!Array.isArray(value)) return [];
  return value.map((tag) => asString(tag).toLowerCase()).filter(Boolean);
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Map Postgres post row (+ images) to client MarketPost shape. */
export function mapPostRow(row, images = []) {
  if (!row) return null;
  const imageUrls =
    images.length > 0
      ? images
      : row.cover_url
        ? [row.cover_url]
        : [];
  const videoUrl = asString(row.video_url) || undefined;
  const coverUrl = asString(row.cover_url) || imageUrls[0] || undefined;
  return {
    id: row.id,
    posterId: row.poster_id,
    mediaType: row.media_type || (videoUrl ? 'video' : 'image_gallery'),
    images: imageUrls,
    coverImageUrl: coverUrl,
    videoUrl,
    videoMeta: row.video_meta || undefined,
    soundMeta: row.sound_meta || undefined,
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    price: row.price != null && Number.isFinite(Number(row.price)) ? Number(row.price) : undefined,
    isNegotiable: Boolean(row.is_negotiable),
    title: asString(row.title) || undefined,
    description: asString(row.description) || undefined,
    location: row.location || undefined,
    contactMethod: row.contact_method || 'in-app',
    likes: Number(row.likes_count || 0),
    views: Number(row.views_count || 0),
    comments: Number(row.comments_count || 0),
    likedBy: Array.isArray(row.liked_by) ? row.liked_by : [],
    status: row.status || 'active',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    expiresAt: toIso(row.expires_at),
  };
}

export async function loadPostImages(postIds) {
  const db = requirePool();
  const ids = [...new Set(postIds.map(asString).filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT post_id, url, sort_order
     FROM post_images
     WHERE post_id = ANY($1::text[])
     ORDER BY post_id, sort_order ASC`,
    [ids]
  );
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.post_id) || [];
    list.push(row.url);
    map.set(row.post_id, list);
  }
  return map;
}

export async function hydratePosts(postIds) {
  const db = requirePool();
  const ids = [...new Set((postIds || []).map(asString).filter(Boolean))];
  if (!ids.length) return {};

  const { rows } = await db.query(`SELECT * FROM posts WHERE id = ANY($1::text[])`, [ids]);
  const imagesByPost = await loadPostImages(ids);
  const byId = {};
  for (const row of rows) {
    byId[row.id] = mapPostRow(row, imagesByPost.get(row.id) || []);
  }
  return byId;
}

export async function getPostById(postId) {
  const db = requirePool();
  const id = asString(postId);
  if (!id) return null;
  const { rows } = await db.query(`SELECT * FROM posts WHERE id = $1 LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const images = await loadPostImages([id]);
  return mapPostRow(rows[0], images.get(id) || []);
}

export async function getPostsBatch(ids) {
  const byId = await hydratePosts(ids);
  return (ids || []).map((id) => byId[asString(id)]).filter(Boolean);
}

async function replacePostImages(client, postId, imageUrls) {
  await client.query(`DELETE FROM post_images WHERE post_id = $1`, [postId]);
  const urls = (imageUrls || []).map(asString).filter(Boolean);
  for (let i = 0; i < urls.length; i += 1) {
    await client.query(
      `INSERT INTO post_images (post_id, url, sort_order) VALUES ($1, $2, $3)`,
      [postId, urls[i], i]
    );
  }
}

async function bumpTrending(client, hashtags, delta) {
  for (const tag of hashtags) {
    if (delta > 0) {
      await client.query(
        `INSERT INTO trending_hashtags (tag, count, created_at, updated_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (tag) DO UPDATE SET
           count = trending_hashtags.count + $2,
           updated_at = now()`,
        [tag, delta]
      );
    } else {
      await client.query(
        `UPDATE trending_hashtags
         SET count = GREATEST(0, count + $2), updated_at = now()
         WHERE tag = $1`,
        [tag, delta]
      );
      await client.query(`DELETE FROM trending_hashtags WHERE tag = $1 AND count <= 0`, [tag]);
    }
  }
}

export async function createPost(userId, payload = {}) {
  const db = requirePool();
  await ensureUser(userId);

  const mediaType = asString(payload.mediaType) || 'image_gallery';
  const images = Array.isArray(payload.images) ? payload.images.map(asString).filter(Boolean) : [];
  const videoUrl = asString(payload.videoUrl) || null;
  const coverUrl = asString(payload.coverImageUrl) || images[0] || null;
  const hashtags = normalizeHashtags(payload.hashtags);

  if (mediaType === 'image_gallery' && images.length === 0) {
    throw httpError('Please add at least one photo.');
  }
  if (mediaType === 'video' && !videoUrl) {
    throw httpError('Please pick a video before publishing.');
  }

  const postId = asString(payload.id) || randomUUID().replace(/-/g, '').slice(0, 20);
  const price =
    payload.price != null && Number.isFinite(Number(payload.price)) ? Number(payload.price) : null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO posts (
         id, poster_id, media_type, status, title, description, price, is_negotiable,
         hashtags, location, contact_method, cover_url, video_url, video_duration_ms,
         video_meta, sound_meta, likes_count, views_count, comments_count, liked_by,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,'active',$4,$5,$6,$7,
         $8::text[],$9::jsonb,$10,$11,$12,$13,
         $14::jsonb,$15::jsonb,0,0,0,'{}',
         now(), now()
       )`,
      [
        postId,
        userId,
        mediaType,
        asString(payload.title)?.slice(0, 80) || null,
        asString(payload.description) || null,
        price,
        Boolean(payload.isNegotiable),
        hashtags,
        payload.location ? JSON.stringify(payload.location) : null,
        asString(payload.contactMethod) || 'in-app',
        coverUrl,
        videoUrl,
        payload.videoMeta?.durationMs != null ? Number(payload.videoMeta.durationMs) : null,
        payload.videoMeta ? JSON.stringify(payload.videoMeta) : null,
        payload.soundMeta ? JSON.stringify(payload.soundMeta) : null,
      ]
    );

    await replacePostImages(client, postId, images.length ? images : coverUrl ? [coverUrl] : []);

    await client.query(
      `INSERT INTO post_scores (
         post_id, poster_id, hashtags, media_type, status, total_points, score,
         breakdown, views_count, created_at, updated_at
       ) VALUES ($1,$2,$3::text[],$4,'active',0,0,'{}'::jsonb,0,now(),now())
       ON CONFLICT (post_id) DO NOTHING`,
      [postId, userId, hashtags, mediaType]
    );

    if (hashtags.length) await bumpTrending(client, hashtags, 1);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getPostById(postId);
}

export async function updatePost(userId, postId, payload = {}) {
  const db = requirePool();
  const id = asString(postId);
  const existing = await getPostById(id);
  if (!existing) throw httpError('Post not found', 404);
  if (existing.posterId !== userId) throw httpError('Forbidden', 403);

  const hashtags =
    payload.hashtags != null ? normalizeHashtags(payload.hashtags) : existing.hashtags || [];
  const images =
    payload.images != null
      ? (Array.isArray(payload.images) ? payload.images.map(asString).filter(Boolean) : [])
      : existing.images || [];
  const coverUrl =
    payload.coverImageUrl != null
      ? asString(payload.coverImageUrl) || null
      : existing.coverImageUrl || images[0] || null;
  const videoUrl =
    payload.videoUrl != null ? asString(payload.videoUrl) || null : existing.videoUrl || null;
  const price =
    payload.price !== undefined
      ? payload.price != null && Number.isFinite(Number(payload.price))
        ? Number(payload.price)
        : null
      : existing.price ?? null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE posts SET
         title = $2,
         description = $3,
         price = $4,
         is_negotiable = $5,
         hashtags = $6::text[],
         location = $7::jsonb,
         contact_method = $8,
         cover_url = $9,
         video_url = $10,
         video_meta = COALESCE($11::jsonb, video_meta),
         sound_meta = COALESCE($12::jsonb, sound_meta),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        payload.title !== undefined
          ? asString(payload.title)?.slice(0, 80) || null
          : existing.title || null,
        payload.description !== undefined
          ? asString(payload.description) || null
          : existing.description || null,
        price,
        payload.isNegotiable !== undefined ? Boolean(payload.isNegotiable) : Boolean(existing.isNegotiable),
        hashtags,
        payload.location !== undefined
          ? payload.location
            ? JSON.stringify(payload.location)
            : null
          : existing.location
            ? JSON.stringify(existing.location)
            : null,
        payload.contactMethod != null
          ? asString(payload.contactMethod) || 'in-app'
          : existing.contactMethod || 'in-app',
        coverUrl,
        videoUrl,
        payload.videoMeta ? JSON.stringify(payload.videoMeta) : null,
        payload.soundMeta ? JSON.stringify(payload.soundMeta) : null,
      ]
    );
    if (payload.images != null || payload.coverImageUrl != null) {
      await replacePostImages(client, id, images.length ? images : coverUrl ? [coverUrl] : []);
    }
    await client.query(
      `UPDATE post_scores SET hashtags = $2::text[], updated_at = now() WHERE post_id = $1`,
      [id, hashtags]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getPostById(id);
}

export async function deletePost(userId, postId, { isAdmin = false } = {}) {
  const db = requirePool();
  const id = asString(postId);
  const { rows } = await db.query(`SELECT * FROM posts WHERE id = $1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) throw httpError('Post not found', 404);
  if (row.poster_id !== userId && !isAdmin) throw httpError('Forbidden', 403);

  const mapped = mapPostRow(row);
  const mediaPaths = collectMediaPathsFromPost({
    images: mapped.images,
    coverImageUrl: mapped.coverImageUrl,
    videoUrl: mapped.videoUrl,
    soundMeta: mapped.soundMeta,
  });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const hashtags = Array.isArray(row.hashtags) ? row.hashtags : [];
    await client.query(`DELETE FROM posts WHERE id = $1`, [id]);
    await client.query(`DELETE FROM post_scores WHERE post_id = $1`, [id]);
    await client.query(`DELETE FROM user_liked_posts WHERE post_id = $1`, [id]);
    await client.query(`DELETE FROM user_seen_posts WHERE post_id = $1`, [id]);
    if (hashtags.length) await bumpTrending(client, hashtags, -1);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await deleteStorageObjects(mediaPaths).catch(() => {});
  return { success: true, message: 'Post deleted successfully', deletedMedia: mediaPaths.length };
}

export async function fetchColdStartPostIds(limit, excludeIds) {
  const db = requirePool();
  const exclude = [...excludeIds];
  const { rows } = await db.query(
    `SELECT id FROM posts
     WHERE status = 'active'
       AND created_at >= now() - interval '72 hours'
       AND views_count < 50
       AND NOT (id = ANY($1::text[]))
     ORDER BY created_at DESC
     LIMIT $2`,
    [exclude, Math.max(limit * 4, limit)]
  );
  return rows.map((r) => r.id).slice(0, limit);
}

export async function fetchActivePostIdsByPosters(posterIds, limit = 40) {
  const db = requirePool();
  const ids = [...new Set((posterIds || []).map(asString).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT id FROM posts
     WHERE status = 'active' AND poster_id = ANY($1::text[])
     ORDER BY created_at DESC
     LIMIT $2`,
    [ids, limit]
  );
  return rows.map((r) => r.id);
}

export function postSnapshotFromPost(post) {
  if (!post) return {};
  const imageUrl =
    asString(post.coverImageUrl) ||
    (Array.isArray(post.images) ? asString(post.images[0]) : '') ||
    null;
  const title =
    asString(post.title).slice(0, 80) ||
    asString(post.description).split('\n')[0].slice(0, 80) ||
    'Listing';
  return {
    title,
    price: typeof post.price === 'number' ? post.price : null,
    currency: 'NGN',
    imageUrl,
    location: [post.location?.city, post.location?.state].filter(Boolean).join(', ') || null,
  };
}

export async function listTrendingHashtags(limit = 30) {
  const db = requirePool();
  const { rows } = await db.query(
    `SELECT tag, count
     FROM trending_hashtags
     WHERE count > 0
     ORDER BY count DESC
     LIMIT $1`,
    [Math.min(100, Math.max(1, Number(limit) || 30))]
  );
  return rows.map((row) => ({
    id: row.tag,
    tag: row.tag,
    count: Number(row.count || 0),
  }));
}

export async function searchPosts(searchQuery, limit = 50) {
  const db = requirePool();
  const raw = asString(searchQuery).toLowerCase();
  if (!raw) return [];

  const isHashtag = raw.startsWith('#');
  const tag = (isHashtag ? raw.slice(1) : raw).replace(/[^a-z0-9_]/g, '');
  const take = Math.min(100, Math.max(1, Number(limit) || 50));

  if (isHashtag && tag) {
    const { rows } = await db.query(
      `SELECT id FROM posts
       WHERE status = 'active' AND $1 = ANY(hashtags)
       ORDER BY created_at DESC
       LIMIT $2`,
      [tag, take]
    );
    return getPostsBatch(rows.map((r) => r.id));
  }

  const terms = raw.split(/\s+/).filter((t) => t.length > 0).slice(0, 8);
  if (!terms.length) return [];

  const { rows } = await db.query(
    `SELECT id FROM posts
     WHERE status = 'active'
       AND (
         lower(coalesce(description, '')) LIKE ANY($1::text[])
         OR lower(coalesce(location->>'city', '')) LIKE ANY($1::text[])
         OR lower(coalesce(location->>'state', '')) LIKE ANY($1::text[])
         OR EXISTS (
           SELECT 1 FROM unnest(hashtags) AS h
           WHERE lower(h) LIKE ANY($1::text[])
         )
       )
     ORDER BY created_at DESC
     LIMIT $2`,
    [terms.map((t) => `%${t}%`), take]
  );
  return getPostsBatch(rows.map((r) => r.id));
}
