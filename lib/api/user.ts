// User API endpoints - Uses Cloud Functions for store settings
import { apiClient } from './client';
import { cloudFunctions } from './cloud-functions';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { User, StoreSettings } from '@/types';

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
    return apiClient.get<User>(`/users/${userId}`);
  },

  // Update user profile
  updateProfile: async (userId: string, data: UpdateUserProfileData): Promise<User> => {
    return apiClient.put<User>(`/users/${userId}`, data);
  },

  // Update store settings (uses Cloud Function)
  updateStoreSettings: async (userId: string, settings: StoreSettings): Promise<User> => {
    // Convert logo and banner to base64 if they are local files
    let logoBase64: string | undefined;
    let bannerBase64: string | undefined;

    if (settings.storeLogoUrl && (settings.storeLogoUrl.startsWith('file://') || settings.storeLogoUrl.startsWith('asset://'))) {
      try {
        logoBase64 = await convertImageToBase64(settings.storeLogoUrl);
      } catch (error: any) {
        console.error('Failed to convert logo to base64:', error);
        // Continue without logo if conversion fails
      }
    } else if (settings.storeLogoUrl && settings.storeLogoUrl.startsWith('data:')) {
      logoBase64 = settings.storeLogoUrl;
    }

    if (settings.storeBannerUrl && (settings.storeBannerUrl.startsWith('file://') || settings.storeBannerUrl.startsWith('asset://'))) {
      try {
        bannerBase64 = await convertImageToBase64(settings.storeBannerUrl);
      } catch (error: any) {
        console.error('Failed to convert banner to base64:', error);
        // Continue without banner if conversion fails
      }
    } else if (settings.storeBannerUrl && settings.storeBannerUrl.startsWith('data:')) {
      bannerBase64 = settings.storeBannerUrl;
    }

    await cloudFunctions.updateStoreSettings({
      sellerId: userId,
      updateData: {
        storeName: settings.storeName,
        storeDescription: settings.storeDescription,
        logoBase64,
        bannerBase64,
        phone: settings.phone,
        email: settings.email,
        // Include other store settings fields
        ...settings,
      },
    });

    // Return updated user (might need to fetch from Firestore)
    return {} as User;
  },
};

