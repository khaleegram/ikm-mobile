import { auth } from './firebase.mjs';
import { pool } from './db.mjs';

export async function requireAuth(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    const err = new Error('Unauthorized: Missing or invalid Authorization header');
    err.statusCode = 401;
    throw err;
  }

  const token = authorization.slice('Bearer '.length);
  try {
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    const err = new Error('Unauthorized: Invalid or expired token');
    err.statusCode = 401;
    throw err;
  }
}

/**
 * Staff-only gate.
 *
 * Being signed in is not the same as being staff. The role is read from the
 * database rather than trusted from the token, so revoking someone takes effect on
 * their next request instead of whenever their token expires.
 */
export async function requireAdmin(authorization) {
  const user = await requireAuth(authorization);
  const { rows } = await pool.query(`SELECT role FROM users WHERE id = $1`, [user.uid]);
  if (String(rows[0]?.role || '').toLowerCase() !== 'admin') {
    const err = new Error('Forbidden: staff only');
    err.statusCode = 403;
    throw err;
  }
  return { ...user, isAdmin: true };
}
