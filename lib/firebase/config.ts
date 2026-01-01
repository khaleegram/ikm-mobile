// Firebase configuration and initialization
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
  
  // Initialize Auth - use getAuth for compatibility with Expo Go and dev builds
  // getAuth works in both environments and handles persistence automatically
  // initializeAuth with getReactNativePersistence is optional and may not work in Expo Go
  if (Platform.OS === 'web') {
    auth = getAuth(app);
  } else {
    // For React Native, try initializeAuth first for better persistence support
    // Fall back to getAuth if it fails (e.g., in Expo Go)
    try {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage)
      });
    } catch (error: any) {
      // If auth is already initialized or initializeAuth fails, use getAuth
      if (error.code === 'auth/already-initialized' || error.message?.includes('already initialized')) {
        auth = getAuth(app);
      } else {
        // Fallback to getAuth - works in Expo Go and dev builds
        // Note: getAuth also persists auth state, just not explicitly configured
        console.warn('initializeAuth failed, using getAuth (this is normal in Expo Go):', error.message);
        auth = getAuth(app);
      }
    }
  }
  
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

