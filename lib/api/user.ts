// User API endpoints
// Cloud-Functions-first: reads come from Firestore, writes go through Cloud Functions.
import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { User, StoreSettings } from '@/types';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';

/**
 * Push so the seller's new name/logo shows up everywhere that reads the shared identity
 * cache (inbox, deal-room header, feed overlay) — not just Neon for chat hydration.
 */
function syncChatProfile(
  userId: string | undefined,
  profile: { displayName?: string; storeName?: string; storeLogoUrl?: string }
) {
  const body: Record<string, string> = {};
  if (profile.displayName) body.displayName = profile.displayName;
  if (profile.storeName) body.storeName = profile.storeName;
  if (profile.storeLogoUrl && /^https?:\/\//.test(profile.storeLogoUrl)) {
    body.storeLogoUrl = profile.storeLogoUrl;
    body.avatarUrl = profile.storeLogoUrl;
  }
  if (!Object.keys(body).length) return;
  coreCloudClient
    .request(apiUrl('/users/me'), { method: 'PATCH', body, requiresAuth: true })
    .then(async (response: any) => {
      const { setUserIdentityCache, invalidateUserIdentity } = await import(
        '@/lib/hooks/use-user-identity'
      );
      if (response?.user) {
        setUserIdentityCache(response.user);
      } else if (userId) {
        invalidateUserIdentity(userId);
      }
    })
    .catch(() => {
      if (userId) {
        void import('@/lib/hooks/use-user-identity').then(({ invalidateUserIdentity }) =>
          invalidateUserIdentity(userId)
        );
      }
    });
}

const USER_FUNCTIONS = {
  getStoreSettings: cloudFunctionUrl('getStoreSettings'),
  updateStoreSettings: cloudFunctionUrl('updateStoreSettings'),
  getCustomers: cloudFunctionUrl('getCustomers'),
};

export interface UpdateUserProfileData {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  whatsappNumber?: string;
  storeName?: string;
  storeDescription?: string;
  storeLogoUrl?: string;
  storeBannerUrl?: string;
  storeLocation?: {
    state?: string;
    lga?: string;
    city?: string;
    address?: string;
  };
  businessType?: string;
  storePolicies?: {
    shipping?: string;
    returns?: string;
    refunds?: string;
    privacy?: string;
  };
  payoutDetails?: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  };
  // Store collection fields
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  tiktokUrl?: string;
  storeHours?: {
    monday?: string;
    tuesday?: string;
    wednesday?: string;
    thursday?: string;
    friday?: string;
    saturday?: string;
    sunday?: string;
  };
  email?: string;
  website?: string;
  pickupAddress?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  storeLayout?: 'grid' | 'list' | 'masonry';
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  shippingSettings?: {
    defaultPackagingType?: string;
    packagingCost?: number;
  };
}

export const userApi = {
  // Get current user profile
  getProfile: async (userId: string): Promise<User> => {
    const snap = await getDoc(doc(firestore, 'users', userId));
    if (!snap.exists()) {
      throw new Error('User profile not found');
    }
    const data: any = snap.data();
    return {
      id: snap.id,
      displayName: data.displayName || '',
      email: data.email || '',
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
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
      onboardingCompleted: data.onboardingCompleted,
      isGuest: data.isGuest,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
    };
  },

  // Update user profile
  updateProfile: async (userId: string, data: UpdateUserProfileData): Promise<User> => {
    let logoBase64: string | undefined;
    let bannerBase64: string | undefined;

    const maybeLogo = (data as any).storeLogoUrl;
    const maybeBanner = (data as any).storeBannerUrl;

    if (typeof maybeLogo === 'string' && (maybeLogo.startsWith('file://') || maybeLogo.startsWith('asset://'))) {
      try {
        logoBase64 = await convertImageToBase64(maybeLogo);
      } catch (error: any) {
        console.error('Failed to convert logo to base64:', error);
      }
    } else if (typeof maybeLogo === 'string' && maybeLogo.startsWith('data:')) {
      logoBase64 = maybeLogo;
    }

    if (typeof maybeBanner === 'string' && (maybeBanner.startsWith('file://') || maybeBanner.startsWith('asset://'))) {
      try {
        bannerBase64 = await convertImageToBase64(maybeBanner);
      } catch (error: any) {
        console.error('Failed to convert banner to base64:', error);
      }
    } else if (typeof maybeBanner === 'string' && maybeBanner.startsWith('data:')) {
      bannerBase64 = maybeBanner;
    }

    await coreCloudClient.request(USER_FUNCTIONS.updateStoreSettings, {
      method: 'POST',
      body: {
        sellerId: userId,
        updateData: {
          ...data,
          ...(logoBase64 ? { logoBase64 } : {}),
          ...(bannerBase64 ? { bannerBase64 } : {}),
        },
      },
      requiresAuth: true,
    });

    const profile = await userApi.getProfile(userId);
    syncChatProfile(userId, {
      displayName: profile.displayName,
      storeLogoUrl: profile.storeLogoUrl,
    });
    return profile;
  },

  // Update store settings
  updateStoreSettings: async (userId: string, settings: StoreSettings): Promise<User> => {
    let logoBase64: string | undefined;
    let bannerBase64: string | undefined;

    if (settings.storeLogoUrl && (settings.storeLogoUrl.startsWith('file://') || settings.storeLogoUrl.startsWith('asset://'))) {
      try {
        logoBase64 = await convertImageToBase64(settings.storeLogoUrl);
      } catch (error: any) {
        console.error('Failed to convert logo to base64:', error);
      }
    } else if (settings.storeLogoUrl && settings.storeLogoUrl.startsWith('data:')) {
      logoBase64 = settings.storeLogoUrl;
    }

    if (settings.storeBannerUrl && (settings.storeBannerUrl.startsWith('file://') || settings.storeBannerUrl.startsWith('asset://'))) {
      try {
        bannerBase64 = await convertImageToBase64(settings.storeBannerUrl);
      } catch (error: any) {
        console.error('Failed to convert banner to base64:', error);
      }
    } else if (settings.storeBannerUrl && settings.storeBannerUrl.startsWith('data:')) {
      bannerBase64 = settings.storeBannerUrl;
    }

    const { 
      storeLogoUrl, 
      storeBannerUrl, 
      storeName, 
      storeDescription, 
      phone, 
      email, 
      ...rest 
    } = settings;

    await coreCloudClient.request(USER_FUNCTIONS.updateStoreSettings, {
      method: 'POST',
      body: {
        sellerId: userId,
        updateData: {
          storeName,
          storeDescription,
          logoBase64,
          bannerBase64,
          phone,
          email,
          ...rest,
        },
      },
      requiresAuth: true,
    });

    const profile = await userApi.getProfile(userId);
    syncChatProfile(userId, {
      displayName: profile.displayName,
      storeName: profile.storeName,
      storeLogoUrl: profile.storeLogoUrl,
    });
    return profile;
  },

  // Get customers
  getCustomers: async (userId: string): Promise<any[]> => {
    const response = await coreCloudClient.request<{ success: boolean; customers: any[] }>(USER_FUNCTIONS.getCustomers, {
      method: 'POST',
      body: { sellerId: userId },
      requiresAuth: true,
    });
    return response.customers;
  },
};
