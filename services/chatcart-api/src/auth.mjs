import { auth } from './firebase.mjs';

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
