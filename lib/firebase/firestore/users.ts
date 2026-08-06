// Client-side hooks for reading user data.
//
// Public identity (avatars / names / store cards) lives in lib/hooks/use-user-identity.ts
// backed by TanStack Query + Neon. Re-exported here so existing import paths keep working.
//
// useUserProfile below is the full own-profile Firestore listener (settings, payouts, admin)
// — it still needs fields Neon does not yet store (payoutDetails, storePolicies, etc.).
// Public-facing avatar/name reads must NOT use it; use useUserIdentity / usePublicUserProfile.
import { User } from '@/types';
import { Unsubscribe, doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { firestore } from '../config';

export {
  usePublicUserProfile,
  usePublicUserProfileOnce,
} from '@/lib/hooks/use-user-identity';

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
  const { invalidateUserIdentity } = await import('@/lib/hooks/use-user-identity');
  invalidateUserIdentity(userId);
}
