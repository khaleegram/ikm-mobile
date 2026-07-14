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
    ]
  );
  return getUser(userId);
}

export async function getUser(userId) {
  const db = requirePool();
  const id = asString(userId);
  if (!id) return null;
  const { rows } = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
  if (rows[0] && (rows[0].display_name || rows[0].avatar_url)) {
    return mapUserRow(rows[0]);
  }

  // One-time hydrate from Firestore users doc if Postgres row is thin.
  try {
    const snap = await firestore.collection('users').doc(id).get();
    if (snap.exists) {
      const data = snap.data() || {};
      const first = asString(data.firstName);
      const last = asString(data.lastName);
      const displayName =
        asString(data.displayName) || `${first} ${last}`.trim() || asString(data.storeName) || null;
      await upsertUserFromAuth(id, {
        email: data.email,
        displayName,
        storeName: data.storeName,
        avatarUrl: data.photoURL || data.avatarUrl,
        storeLogoUrl: data.storeLogoUrl,
        role: data.role || data.marketRole,
        marketLocation: data.marketLocation || data.location || null,
        marketBuyerLocation: data.marketBuyerLocation || null,
        marketBuyerPhone: data.marketBuyerPhone || null,
      });
      const refreshed = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
      return mapUserRow(refreshed.rows[0]);
    }
  } catch {
    // ignore
  }

  return mapUserRow(rows[0]) || { id, displayName: 'User', avatarUrl: null };
}

export async function updateUser(userId, patch = {}) {
  return upsertUserFromAuth(userId, {
    displayName: patch.displayName,
    storeName: patch.storeName,
    avatarUrl: patch.avatarUrl || patch.photoURL,
    storeLogoUrl: patch.storeLogoUrl,
    marketLocation: patch.marketLocation,
    marketBuyerLocation: patch.marketBuyerLocation,
    marketBuyerPhone: patch.marketBuyerPhone,
    role: patch.role,
    email: patch.email,
  });
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
