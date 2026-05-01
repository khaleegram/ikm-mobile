// Firebase configuration and initialization
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, initializeAuth, type Persistence } from 'firebase/auth';
import * as FirebaseAuthRuntime from '@firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

function getReactNativePersistenceFactory():
  | ((storage: typeof AsyncStorage) => Persistence)
  | null {
  // `firebase/auth/react-native` is not exported in firebase@12.
  // Use @firebase/auth runtime entry and fallback safely when unavailable.
  const runtime = FirebaseAuthRuntime as unknown as {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
  };
  return typeof runtime.getReactNativePersistence === 'function'
    ? runtime.getReactNativePersistence
    : null;
}

// Firebase config - should be in environment variables
// For now, using placeholder values - replace with actual config
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'your-api-key',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'your-auth-domain',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'your-project-id',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'your-storage-bucket',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || 'your-sender-id',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || 'your-app-id',
};

/** Web client options — must match Console & must include a real `authDomain` for phone reCAPTCHA WebView. */
export const firebaseWebOptions = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
};

export function hasValidFirebaseWebOptions(): boolean {
  const { projectId, apiKey, authDomain } = firebaseWebOptions;
  if (!projectId || !apiKey || !authDomain) return false;
  if (projectId === 'your-project-id' || apiKey === 'your-api-key' || authDomain === 'your-auth-domain') {
    return false;
  }
  return true;
}

// Initialize Firebase
let app: FirebaseApp;
let auth: Auth;
let firestore: Firestore;
let storage: FirebaseStorage;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);

  const isNative = Platform.OS === 'android' || Platform.OS === 'ios';
  const getReactNativePersistence = getReactNativePersistenceFactory();

  if (isNative && getReactNativePersistence) {
    try {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch (error: any) {
      // Reuse existing Auth instance if already initialized elsewhere.
      if (error?.code === 'auth/already-initialized') {
        auth = getAuth(app);
      } else {
        throw error;
      }
    }
  } else {
    auth = getAuth(app);
  }
  
  firestore = getFirestore(app);
  storage = getStorage(app);
} else {
  app = getApps()[0];
  // Existing app should already have Auth initialized (with persistence on native).
  auth = getAuth(app);
  firestore = getFirestore(app);
  storage = getStorage(app);
}

export { app, auth, firestore, storage };

