// Client-side authentication hook
import { useEffect, useState, useRef } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, firestore } from '../config';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = '@ikm_session';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isSeller: boolean; // User has seller setup (storeName or products)
  idToken: string | null;
}

export function useUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const isInitialMount = useRef(true);
  const lastUserId = useRef<string | null>(null);
  const hasLoadedFromCache = useRef(false);
  const currentUserRef = useRef<AuthUser | null>(null); // Track current user to avoid state reads

  useEffect(() => {
    // Load cached session on initial mount for instant UI
    const loadCachedSession = async () => {
      if (isInitialMount.current) {
        try {
          const cached = await AsyncStorage.getItem(SESSION_KEY);
          if (cached) {
            const session = JSON.parse(cached);
            // Only use cache if Firebase user matches
            const currentUser = auth.currentUser;
            if (currentUser && currentUser.uid === session.uid) {
              // Set cached user immediately for instant UI (prevents admin flash)
              const cachedUser = {
                uid: session.uid,
                email: session.email,
                displayName: session.displayName,
                isAdmin: session.isAdmin || false,
                isSeller: session.isSeller || false, // Use cached seller status
                idToken: null, // Will be fetched below
              };
              currentUserRef.current = cachedUser;
              setUser(cachedUser);
              setLoading(false);
              // Mark that we have a cached user to avoid unnecessary Firestore call
              lastUserId.current = session.uid;
              hasLoadedFromCache.current = true;
            }
          }
        } catch (error) {
          console.error('Error loading cached session:', error);
        }
        isInitialMount.current = false;
      }
    };

    loadCachedSession();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        // Check if this is the same user we already processed
        const isSameUser = lastUserId.current === firebaseUser.uid;
        
        try {
          // Only skip if same user and we loaded from cache (avoid unnecessary refreshes)
          if (isSameUser && hasLoadedFromCache.current) {
            // Try to update token without full refresh
            try {
              const idToken = await firebaseUser.getIdToken(false); // Don't force refresh
              const idTokenResult = await firebaseUser.getIdTokenResult();
              const isAdmin = idTokenResult.claims.isAdmin === true;
              
              // Update user with fresh token but keep seller status from cache
              const updatedUser = currentUserRef.current && currentUserRef.current.uid === firebaseUser.uid
                ? {
                    ...currentUserRef.current,
                    isAdmin,
                    idToken,
                  }
                : currentUserRef.current;
              if (updatedUser && updatedUser !== currentUserRef.current) {
                currentUserRef.current = updatedUser;
                setUser(updatedUser);
              }
              setLoading(false);
              return;
            } catch (error: any) {
              // Handle quota exceeded errors gracefully
              if (error?.code === 'auth/quota-exceeded') {
                console.warn('Firebase Auth quota exceeded. Skipping token refresh.');
                setLoading(false);
                return;
              }
              // Continue with full flow if token refresh fails
            }
          }

          // New user or need full refresh
          lastUserId.current = firebaseUser.uid;
          
          // Don't force refresh token - use cached when possible
          const idToken = await firebaseUser.getIdToken(false);
          const idTokenResult = await firebaseUser.getIdTokenResult();
          
          // Check admin claim from custom claims
          const isAdmin = idTokenResult.claims.isAdmin === true;
          
          // Check seller status - use cached value if available, otherwise fetch from Firestore
          let isSeller = false;
          
          // If same user and we have cached data, use cached seller status
          if (isSameUser && hasLoadedFromCache.current && currentUserRef.current) {
            isSeller = currentUserRef.current.isSeller;
          } else {
            // New user - check Firestore
            try {
              const userDoc = await getDoc(doc(firestore, 'users', firebaseUser.uid));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                // Be permissive: older data may use different role names or sellerType flags.
                const role = typeof userData.role === 'string' ? userData.role : '';
                const sellerType = typeof userData.sellerType === 'string' ? userData.sellerType : '';
                isSeller =
                  role === 'seller' ||
                  role === 'street' ||
                  role === 'business' ||
                  sellerType === 'street' ||
                  sellerType === 'business' ||
                  sellerType === 'both' ||
                  !!userData.storeName;
              }
            } catch (error) {
              console.error('Error checking seller status:', error);
              // Default to false if error
            }
          }
          
          const authUser: AuthUser = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            isAdmin,
            isSeller,
            idToken,
          };

          // Store session
          await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({
            uid: authUser.uid,
            email: authUser.email,
            displayName: authUser.displayName,
            isAdmin: authUser.isAdmin,
            isSeller: authUser.isSeller,
          }));

          currentUserRef.current = authUser;
          setUser(authUser);
          hasLoadedFromCache.current = true;
        } catch (error: any) {
          // Handle quota exceeded errors gracefully
          if (error?.code === 'auth/quota-exceeded') {
            console.warn('Firebase Auth quota exceeded. Using cached session.');
            // Try to use cached session
            try {
              const cached = await AsyncStorage.getItem(SESSION_KEY);
              if (cached) {
                const session = JSON.parse(cached);
                if (session.uid === firebaseUser.uid) {
                  const cachedUser = {
                    uid: session.uid,
                    email: session.email,
                    displayName: session.displayName,
                    isAdmin: session.isAdmin || false,
                    isSeller: session.isSeller || false,
                    idToken: null,
                  };
                  currentUserRef.current = cachedUser;
                  setUser(cachedUser);
                  setLoading(false);
                  return;
                }
              }
            } catch (cacheError) {
              console.error('Error loading cached session:', cacheError);
            }
          }
          console.error('Error getting user token:', error);
          currentUserRef.current = null;
          setUser(null);
          await AsyncStorage.removeItem(SESSION_KEY);
        }
      } else {
        lastUserId.current = null;
        hasLoadedFromCache.current = false;
        currentUserRef.current = null;
        await AsyncStorage.removeItem(SESSION_KEY);
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []); // Empty dependency array - only run once on mount

  const signOut = async () => {
    try {
      lastUserId.current = null;
      hasLoadedFromCache.current = false;
      currentUserRef.current = null;
      await firebaseSignOut(auth);
      await AsyncStorage.removeItem(SESSION_KEY);
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return { user, loading, signOut };
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

