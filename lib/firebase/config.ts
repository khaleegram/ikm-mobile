// Firebase configuration and initialization
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

// NOTE:
// This project previously attempted to use:
//   initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
// via a deep import (`firebase/auth/react-native`).
//
// In this repo's current dependency/Metro setup, that module path isn't resolvable,
// which breaks bundling for dev-client. We intentionally fall back to `getAuth()`
// to keep the app booting reliably.

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

// Initialize Firebase
let app: FirebaseApp;
let auth: Auth;
let firestore: Firestore;
let storage: FirebaseStorage;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);

  // Keep auth init simple and bundler-safe for Expo dev-client.
  auth = getAuth(app);
  
  firestore = getFirestore(app);
  storage = getStorage(app);
} else {
  app = getApps()[0];
  // Always use getAuth for existing apps to avoid re-initialization errors
  auth = getAuth(app);
  firestore = getFirestore(app);
  storage = getStorage(app);
}

export { app, auth, firestore, storage };

