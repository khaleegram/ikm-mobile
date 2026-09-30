// Client-side authentication session.
//
// ONE session for the whole app. Every component reads the same store, so mounting a
// screen (or a list item) never starts another Firebase auth listener or token fetch.
//
// The cached session is read synchronously from MMKV so `loading` is already `false` on
// the first paint — screens render the real UI immediately instead of flashing a spinner
// and then swapping to content.
import { useSyncExternalStore } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, firestore } from '../config';
import { appStorage } from '@/lib/storage/mmkv';

const SESSION_KEY = 'ikm_session';
const LEGACY_SESSION_KEY = '@ikm_session';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  isAdmin: boolean;
  isSeller: boolean; // User has seller setup (storeName or products)
  idToken: string | null;
}

type SessionState = {
  user: AuthUser | null;
  /** True only while we have no cached session and are waiting on Firebase's first answer. */
  loading: boolean;
};

type PersistedSession = Pick<AuthUser, 'uid' | 'email' | 'displayName' | 'isAdmin' | 'isSeller'>;

function isOfflineFirestoreError(error: any): boolean {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'unavailable' || message.includes('client is offline');
}

function parsePersisted(raw: string | null | undefined): AuthUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed?.uid) return null;
    return {
      uid: String(parsed.uid),
      email: parsed.email ?? null,
      displayName: parsed.displayName ?? null,
      phoneNumber: null,
      isAdmin: Boolean(parsed.isAdmin),
      isSeller: Boolean(parsed.isSeller),
      idToken: null,
    };
  } catch {
    return null;
  }
}

function readCachedSession(): AuthUser | null {
  try {
    return parsePersisted(appStorage.getString(SESSION_KEY));
  } catch {
    return null;
  }
}

function persistSession(user: AuthUser) {
  try {
    const payload: PersistedSession = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      isSeller: user.isSeller,
    };
    appStorage.set(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Never let a storage hiccup break sign-in.
  }
}

function clearPersistedSession() {
  try {
    appStorage.remove(SESSION_KEY);
  } catch {
    // ignore
  }
  void AsyncStorage.removeItem(LEGACY_SESSION_KEY).catch(() => {});
}

// Seed synchronously: a cached session means we can paint real UI on the very first render.
const cachedSession = readCachedSession();
let state: SessionState = {
  user: cachedSession,
  loading: cachedSession === null,
};

const listeners = new Set<() => void>();

function setState(next: Partial<SessionState>) {
  const merged: SessionState = { ...state, ...next };
  if (merged.user === state.user && merged.loading === state.loading) return;
  state = merged;
  for (const listener of listeners) listener();
}

let started = false;
/** Firebase has given us its first answer — don't let a late legacy-cache read override it. */
let authResolved = false;
let unsubscribeAuth: (() => void) | null = null;

async function resolveSellerStatus(
  firebaseUser: FirebaseUser,
  previous: AuthUser | null
): Promise<boolean> {
  // Same user we already know about — keep the cached answer instead of a Firestore read.
  if (previous && previous.uid === firebaseUser.uid) return previous.isSeller;
  try {
    const userDoc = await getDoc(doc(firestore, 'users', firebaseUser.uid));
    if (!userDoc.exists()) return false;
    const userData = userDoc.data();
    // Be permissive: older data may use different role names or sellerType flags.
    const role = typeof userData.role === 'string' ? userData.role : '';
    const sellerType = typeof userData.sellerType === 'string' ? userData.sellerType : '';
    return (
      role === 'seller' ||
      role === 'street' ||
      role === 'business' ||
      sellerType === 'street' ||
      sellerType === 'business' ||
      sellerType === 'both' ||
      !!userData.storeName
    );
  } catch (error) {
    if (!isOfflineFirestoreError(error)) {
      console.warn('Could not check seller status:', error);
    }
    return false;
  }
}

async function handleAuthStateChanged(firebaseUser: FirebaseUser | null) {
  authResolved = true;

  if (!firebaseUser) {
    clearPersistedSession();
    setState({ user: null, loading: false });
    return;
  }

  const previous = state.user?.uid === firebaseUser.uid ? state.user : null;

  try {
    // Don't force refresh token - use cached when possible.
    const idToken = await firebaseUser.getIdToken(false);
    const idTokenResult = await firebaseUser.getIdTokenResult();
    const isAdmin = idTokenResult.claims.isAdmin === true;
    const isSeller = await resolveSellerStatus(firebaseUser, previous);

    const authUser: AuthUser = {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      phoneNumber: firebaseUser.phoneNumber,
      isAdmin,
      isSeller,
      idToken,
    };

    persistSession(authUser);
    setState({ user: authUser, loading: false });
  } catch (error: any) {
    // Quota / transient failure: keep the user signed in from cache rather than dumping them.
    if (previous) {
      setState({ user: previous, loading: false });
      return;
    }
    console.error('Error getting user token:', error);
    clearPersistedSession();
    setState({ user: null, loading: false });
  }
}

function ensureStarted() {
  if (started) return;
  started = true;

  // One-time migration from the old AsyncStorage key so existing installs stay signed in
  // on this cold start. Non-blocking: the auth listener corrects us either way.
  if (!state.user) {
    void AsyncStorage.getItem(LEGACY_SESSION_KEY)
      .then((raw) => {
        const migrated = parsePersisted(raw);
        if (migrated && !state.user && !authResolved) {
          persistSession(migrated);
          setState({ user: migrated, loading: false });
        }
      })
      .catch(() => {});
  }

  unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
    void handleAuthStateChanged(firebaseUser);
  });
}

function subscribe(listener: () => void) {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SessionState {
  return state;
}

export function useUser() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { user: snapshot.user, loading: snapshot.loading, signOut };
}

/** Shared sign-out — safe to call from anywhere; the single listener clears the store. */
export async function signOut() {
  try {
    await firebaseSignOut(auth);
    clearPersistedSession();
    setState({ user: null, loading: false });
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
}

/** Test/QA helper: tear the single listener down so a fresh one can start. */
export function __resetAuthSessionForTests() {
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  started = false;
  authResolved = false;
  listeners.clear();
  state = { user: null, loading: true };
}

// Get current user ID token for API calls
// Uses cached token when possible to avoid quota issues
export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    // Don't force refresh - use cached token to reduce quota usage
    // Firebase SDK will automatically refresh if token is expired
    return await user.getIdToken(false);
  } catch (error: any) {
    // Handle quota exceeded errors gracefully
    if (error?.code === 'auth/quota-exceeded') {
      console.warn('Firebase Auth quota exceeded. Using cached token if available.');
      // Try to get cached token only (don't force refresh)
      try {
        return await user.getIdToken(false);
      } catch (retryError) {
        console.error('Error getting cached token:', retryError);
      }
      return null;
    }
    console.error('Error getting ID token:', error);
    return null;
  }
}