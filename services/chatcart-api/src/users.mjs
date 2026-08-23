import { pool, ensureUser } from './db.mjs';
import { firestore } from './firebase.mjs';

function requirePool() {
  if (!pool) {
    const err = new Error('Database is not configured');
    err.statusCode = 503;
    throw err;
  }
  return pool;
}

function asString(value) {
  return String(value ?? '').trim();
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || null,
    displayName: row.display_name || null,
    storeName: row.store_name || null,
    bio: row.bio || null,
    avatarUrl: row.avatar_url || null,
    storeLogoUrl: row.store_logo_url || null,
    photoURL: row.avatar_url || row.store_logo_url || null,
    role: row.role || 'buyer',
    marketLocation: row.market_location || null,
    marketBuyerLocation: row.market_buyer_location || null,
    marketBuyerPhone: row.market_buyer_phone || null,
    followerCount: Number(row.follower_count || 0),
    followingCount: Number(row.following_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertUserFromAuth(userId, profile = {}) {
  const db = requirePool();
  await ensureUser(userId);
  await db.query(
    `UPDATE users SET
       email = COALESCE($2, email),
       display_name = COALESCE($3, display_name),
       store_name = COALESCE($4, store_name),
       avatar_url = COALESCE($5, avatar_url),
       store_logo_url = COALESCE($6, store_logo_url),
       role = COALESCE($7, role),
       market_location = COALESCE($8::jsonb, market_location),
       market_buyer_location = COALESCE($9::jsonb, market_buyer_location),
       market_buyer_phone = COALESCE($10, market_buyer_phone),
       bio = COALESCE($11, bio),
       updated_at = now()
     WHERE id = $1`,
    [
      userId,
      asString(profile.email) || null,
      asString(profile.displayName) || null,
      asString(profile.storeName) || null,
      asString(profile.avatarUrl || profile.photoURL) || null,
      asString(profile.storeLogoUrl) || null,
      asString(profile.role) || null,
      profile.marketLocation ? JSON.stringify(profile.marketLocation) : null,
      profile.marketBuyerLocation ? JSON.stringify(profile.marketBuyerLocation) : null,
      asString(profile.marketBuyerPhone) || null,
      asString(profile.bio) || null,
    ]
  );
  return getUser(userId);
}

async function hydrateUserFromFirestoreIfNeeded(id, row) {
  // Skip Firestore when Neon already has a usable store/display name.
  // (Do not require avatar_url — logos often live only in store_logo_url.)
  const hasName = Boolean(asString(row?.store_name) || asString(row?.display_name));
  if (row && hasName) {
    return mapUserRow(row);
  }

  // One-time hydrate from Firestore users doc if Postgres row is thin / missing store.
  try {
    const snap = await firestore.collection('users').doc(id).get();
    if (snap.exists) {
      const data = snap.data() || {};
      const first = asString(data.firstName);
      const last = asString(data.lastName);
      const storeName = asString(data.storeName);
      const personName = asString(data.displayName) || `${first} ${last}`.trim() || null;
      const safePersonName =
        personName && String(personName).includes('@') ? null : personName;
      await upsertUserFromAuth(id, {
        email: data.email,
        displayName: storeName || safePersonName,
        storeName: storeName || null,
        avatarUrl: data.storeLogoUrl || data.photoURL || data.avatarUrl,
        storeLogoUrl: data.storeLogoUrl,
        role: data.role || data.marketRole,
        marketLocation: data.marketLocation || data.location || null,
        marketBuyerLocation: data.marketBuyerLocation || null,
        marketBuyerPhone: data.marketBuyerPhone || null,
        bio: asString(data.bio) || null,
      });
      const db = requirePool();
      const refreshed = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
      return mapUserRow(refreshed.rows[0]);
    }
  } catch {
    // ignore
  }

  return mapUserRow(row) || { id, displayName: 'User', avatarUrl: null };
}

export async function searchUsers({
  q = '',
  city = '',
  state = '',
  limit = 40,
} = {}) {
  const db = requirePool();
  const query = asString(q);
  const cityFilter = asString(city);
  const stateFilter = asString(state);
  const take = Math.min(Math.max(Number(limit) || 40, 1), 80);

  if (!query && !cityFilter && !stateFilter) {
    return [];
  }

  const params = [];
  const where = [];

  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    where.push(
      `(LOWER(COALESCE(store_name, '')) LIKE $${params.length} OR LOWER(COALESCE(display_name, '')) LIKE $${params.length})`
    );
  }
  if (cityFilter) {
    params.push(cityFilter.toLowerCase());
    where.push(`LOWER(COALESCE(market_location->>'city', '')) = $${params.length}`);
  }
  if (stateFilter) {
    params.push(stateFilter.toLowerCase());
    where.push(`LOWER(COALESCE(market_location->>'state', '')) = $${params.length}`);
  }

  params.push(take);
  const { rows } = await db.query(
    `SELECT * FROM users
     WHERE ${where.join(' AND ')}
     ORDER BY follower_count DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapUserRow).filter(Boolean);
}

export async function getUser(userId) {
  const db = requirePool();
  const id = asString(userId);
  if (!id) return null;
  const { rows } = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
  return hydrateUserFromFirestoreIfNeeded(id, rows[0]);
}

/**
 * One round-trip for inbox/list screens — replaces N individual getUser / Firestore listeners.
 * Caps at 50 ids; hydrates thin rows the same way as getUser.
 */
export async function getUsersBatch(userIds = []) {
  const db = requirePool();
  const ids = [
    ...new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((id) => asString(id))
        .filter(Boolean)
    ),
  ].slice(0, 50);

  if (ids.length === 0) return [];

  const { rows } = await db.query(`SELECT * FROM users WHERE id = ANY($1::text[])`, [ids]);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const users = await Promise.all(
    ids.map(async (id) => hydrateUserFromFirestoreIfNeeded(id, byId.get(id)))
  );
  return users.filter(Boolean);
}

export async function getUserFcmTokens(userId) {
  const db = requirePool();
  const id = asString(userId);
  if (!id) return [];
  const { rows } = await db.query(`SELECT fcm_tokens FROM users WHERE id = $1 LIMIT 1`, [id]);
  const tokens = rows[0]?.fcm_tokens;
  return Array.isArray(tokens) ? tokens.map((t) => asString(t)).filter(Boolean) : [];
}

export async function updateUser(userId, patch = {}) {
  const user = await upsertUserFromAuth(userId, {
    displayName: patch.displayName,
    storeName: patch.storeName,
    avatarUrl: patch.avatarUrl || patch.photoURL,
    storeLogoUrl: patch.storeLogoUrl,
    marketLocation: patch.marketLocation,
    marketBuyerLocation: patch.marketBuyerLocation,
    marketBuyerPhone: patch.marketBuyerPhone,
    role: patch.role,
    email: patch.email,
    bio: patch.bio,
  });

  // The COALESCE upsert ignores nulls, so an explicit clear (patch key present but
  // empty/null) must be applied separately — otherwise a removed phone number would
  // silently reappear at checkout.
  const clearPhone =
    Object.prototype.hasOwnProperty.call(patch, 'marketBuyerPhone') &&
    !asString(patch.marketBuyerPhone);
  const clearLocation =
    Object.prototype.hasOwnProperty.call(patch, 'marketBuyerLocation') &&
    patch.marketBuyerLocation === null;
  const clearBio =
    Object.prototype.hasOwnProperty.call(patch, 'bio') && !asString(patch.bio);
  if (clearPhone || clearLocation || clearBio) {
    const db = requirePool();
    await db.query(
      `UPDATE users SET
         market_buyer_phone = CASE WHEN $2 THEN NULL ELSE market_buyer_phone END,
         market_buyer_location = CASE WHEN $3 THEN NULL ELSE market_buyer_location END,
         bio = CASE WHEN $4 THEN NULL ELSE bio END,
         updated_at = now()
       WHERE id = $1`,
      [userId, clearPhone, clearLocation, clearBio]
    );
    return getUser(userId);
  }

  return user;
}

export async function registerFcmToken(userId, token) {
  const db = requirePool();
  const clean = asString(token);
  if (!clean) {
    const err = new Error('token is required');
    err.statusCode = 400;
    throw err;
  }
  await ensureUser(userId);
  await db.query(
    `UPDATE users
     SET fcm_tokens = (
       SELECT ARRAY(
         SELECT DISTINCT t FROM unnest(array_append(COALESCE(fcm_tokens, '{}'), $2)) AS t
       )
     ),
     updated_at = now()
     WHERE id = $1`,
    [userId, clean]
  );
  return { success: true };
}

export async function unregisterFcmToken(userId, token) {
  const db = requirePool();
  const clean = asString(token);
  if (!clean) {
    const err = new Error('token is required');
    err.statusCode = 400;
    throw err;
  }
  await db.query(
    `UPDATE users
     SET fcm_tokens = array_remove(COALESCE(fcm_tokens, '{}'), $2),
         updated_at = now()
     WHERE id = $1`,
    [userId, clean]
  );
  return { success: true };
}
