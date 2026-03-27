// Client-side hooks for reading user data (read-only)
import { PublicUser, User } from '@/types';
import { Unsubscribe, doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { firestore } from '../config';

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
        console.error('Error fetching user profile:', err);
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
          } as PublicUser);
        } else {
          setUser(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching public user profile:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { user, loading, error };
}

