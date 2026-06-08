// Client-side hooks for reading user data (read-only)
import { PublicUser, User } from '@/types';
import { Unsubscribe, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { firestore } from '../config';

function isOfflineFirestoreError(error: any): boolean {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'unavailable' || message.includes('client is offline');
}

// Get user profile with real-time updates
export function useUserProfile(userId: string | null) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setUser(null);
      setLoading(false);
      return;
    }

    // Set loading to false quickly if we have cached data
    let hasSetInitialLoading = false;

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'users', userId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          // Preserve ALL fields from Firestore
          const user: User = {
            id: snapshot.id,
            displayName: data.displayName || '',
            email: data.email || '',
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            phoneVerified: data.phoneVerified,
            phoneVerifiedAt: data.phoneVerifiedAt?.toDate?.() || data.phoneVerifiedAt,
            whatsappNumber: data.whatsappNumber,
            isAdmin: data.isAdmin || false,
            storeName: data.storeName,
            storeDescription: data.storeDescription,
            storeLogoUrl: data.storeLogoUrl,
            storeBannerUrl: data.storeBannerUrl,
            storeLocation: data.storeLocation,
            businessType: data.businessType,
            storePolicies: data.storePolicies,
            payoutDetails: data.payoutDetails,
            marketBuyerPhone: data.marketBuyerPhone,
            marketBuyerLocation: data.marketBuyerLocation,
            onboardingCompleted: data.onboardingCompleted,
            isGuest: data.isGuest,
            
            // Social Identity
            bio: data.bio || '',
            followerCount: data.followerCount || 0,
            followingCount: data.followingCount || 0,
            
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          };
          setUser(user);
        } else {
          setUser(null);
        }
        
        // Only set loading false once
        if (!hasSetInitialLoading) {
          hasSetInitialLoading = true;
          setLoading(false);
        }
        setError(null);
      },
      (err) => {
        if (!isOfflineFirestoreError(err)) {
          console.error('Error fetching user profile:', err);
        }
        setError(err);
        if (!hasSetInitialLoading) {
          hasSetInitialLoading = true;
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { user, loading, error };
}

// Get public user profile (for store browsing)
export function usePublicUserProfile(userId: string | null) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setUser(null);
      setLoading(false);
      return;
    }

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'users', userId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          // Filter to only public fields
          setUser({
            id: snapshot.id,
            displayName: data.displayName,
            storeName: data.storeName,
            storeDescription: data.storeDescription,
            storeLogoUrl: data.storeLogoUrl,
            storeBannerUrl: data.storeBannerUrl,
            storeLocation: data.storeLocation
              ? {
                  state: data.storeLocation.state,
                  lga: data.storeLocation.lga,
                  city: data.storeLocation.city,
                }
              : undefined,
            businessType: data.businessType,
            storePolicies: data.storePolicies,
            bio: data.bio || '',
            followerCount: data.followerCount || 0,
            followingCount: data.followingCount || 0,
          } as PublicUser);
        } else {
          setUser(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        if (!isOfflineFirestoreError(err)) {
          console.error('Error fetching public user profile:', err);
        }
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { user, loading, error };
}

const publicProfileCache = new Map<string, PublicUser | null>();

function mapPublicUser(snapshot: { id: string; exists: () => boolean; data: () => Record<string, any> | undefined }): PublicUser | null {
  if (!snapshot.exists()) return null;
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    displayName: data.displayName,
    storeName: data.storeName,
    storeDescription: data.storeDescription,
    storeLogoUrl: data.storeLogoUrl,
    storeBannerUrl: data.storeBannerUrl,
    storeLocation: data.storeLocation
      ? {
          state: data.storeLocation.state,
          lga: data.storeLocation.lga,
          city: data.storeLocation.city,
        }
      : undefined,
    businessType: data.businessType,
    storePolicies: data.storePolicies,
    bio: data.bio || '',
    followerCount: data.followerCount || 0,
    followingCount: data.followingCount || 0,
  } as PublicUser;
}

export function usePublicUserProfileOnce(userId: string | null) {
  const cached = userId ? publicProfileCache.get(userId) : undefined;
  const [user, setUser] = useState<PublicUser | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined && Boolean(userId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setUser(null);
      setLoading(false);
      return;
    }

    if (publicProfileCache.has(userId)) {
      setUser(publicProfileCache.get(userId) ?? null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getDoc(doc(firestore, 'users', userId))
      .then((snapshot) => {
        if (cancelled) return;
        const mapped = mapPublicUser(snapshot);
        publicProfileCache.set(userId, mapped);
        setUser(mapped);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!isOfflineFirestoreError(err)) {
          console.error('Error fetching public user profile:', err);
        }
        setError(err);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [userId]);

  return { user, loading, error };
}

// Hardened Update Helper for User Profile (Identity Layer)
export async function updateUserProfile(
  userId: string, 
  data: Partial<Pick<User, 'displayName' | 'bio' | 'phone'>>
) {
  const { updateDoc, serverTimestamp } = await import('firebase/firestore');
  const ref = doc(firestore, 'users', userId);
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

