// Client-side hooks for reading store data (read-only)
import { useEffect, useState } from 'react';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { firestore } from '../config';
import { Store } from '@/types';

// Get store by user ID with real-time updates
export function useStore(userId: string | null) {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setStore(null);
      setLoading(false);
      return;
    }

    // Set loading to false quickly if we have cached data
    let hasSetInitialLoading = false;

    // Store document ID is the same as userId
    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'stores', userId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          // Preserve ALL fields from Firestore
          const store: Store = {
            id: snapshot.id,
            userId: data.userId || '',
            storeName: data.storeName || '',
            storeDescription: data.storeDescription,
            storeLogoUrl: data.storeLogoUrl,
            storeBannerUrl: data.storeBannerUrl,
            storeLocation: data.storeLocation,
            businessType: data.businessType,
            storePolicies: data.storePolicies,
            facebookUrl: data.facebookUrl,
            instagramUrl: data.instagramUrl,
            twitterUrl: data.twitterUrl,
            tiktokUrl: data.tiktokUrl,
            storeHours: data.storeHours,
            email: data.email,
            phone: data.phone,
            website: data.website,
            pickupAddress: data.pickupAddress,
            primaryColor: data.primaryColor,
            secondaryColor: data.secondaryColor,
            fontFamily: data.fontFamily,
            storeLayout: data.storeLayout,
            metaTitle: data.metaTitle,
            metaDescription: data.metaDescription,
            metaKeywords: data.metaKeywords,
            shippingSettings: data.shippingSettings,
            payoutDetails: data.payoutDetails, // Include payout details if stored in stores collection
            onboardingCompleted: data.onboardingCompleted,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          };
          setStore(store);
        } else {
          setStore(null);
        }
        
        // Only set loading false once
        if (!hasSetInitialLoading) {
          hasSetInitialLoading = true;
          setLoading(false);
        }
        setError(null);
      },
      (err) => {
        console.error('Error fetching store:', err);
        setError(err);
        if (!hasSetInitialLoading) {
          hasSetInitialLoading = true;
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { store, loading, error };
}

