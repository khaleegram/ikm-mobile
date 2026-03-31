// Marketing API endpoints
// This app is currently Cloud-Functions-first. Until a standalone REST backend exists,
// keep seller write operations routed through Cloud Functions.
import { coreCloudClient } from './core-cloud-client';
import { DiscountCode, EmailCampaign } from '@/types';

const MARKETING_FUNCTIONS = {
  createDiscountCode: 'https://creatediscountcode-q3rjv54uka-uc.a.run.app',
  updateDiscountCode: 'https://updatediscountcode-q3rjv54uka-uc.a.run.app',
  deleteDiscountCode: 'https://deletediscountcode-q3rjv54uka-uc.a.run.app',
  validateDiscountCode: 'https://validatediscountcode-q3rjv54uka-uc.a.run.app',
};

export interface CreateDiscountCodeData {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  maxUses?: number;
  minOrderAmount?: number;
  validFrom?: Date;
  validUntil?: Date;
}

export interface SendEmailCampaignData {
  subject: string;
  message: string;
  recipientType: 'all' | 'segment' | 'custom';
  segment?: 'VIP' | 'Regular' | 'New';
  recipientEmails?: string[];
}

export const marketingApi = {
  // Discount Codes
  createDiscountCode: async (sellerId: string, data: CreateDiscountCodeData): Promise<DiscountCode> => {
    const res = await coreCloudClient.request<{ success: boolean; discountCodeId: string }>(MARKETING_FUNCTIONS.createDiscountCode, {
      method: 'POST',
      body: {
        sellerId,
        code: data.code,
        type: data.type,
        value: data.value,
        maxUses: data.maxUses,
        minOrderAmount: data.minOrderAmount,
        validFrom: data.validFrom ? data.validFrom.toISOString() : undefined,
        validUntil: data.validUntil ? data.validUntil.toISOString() : undefined,
      },
      requiresAuth: true,
    });

    // The UI uses Firestore listeners for the source of truth; return a best-effort object.
    const now = new Date();
    return {
      id: res.discountCodeId,
      sellerId,
      code: data.code,
      type: data.type,
      value: data.value,
      uses: 0,
      maxUses: data.maxUses,
      minOrderAmount: data.minOrderAmount,
      validFrom: data.validFrom,
      validUntil: data.validUntil,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  },

  updateDiscountCode: async (sellerId: string, codeId: string, data: Partial<DiscountCode>): Promise<DiscountCode> => {
    await coreCloudClient.request(MARKETING_FUNCTIONS.updateDiscountCode, {
      method: 'POST',
      body: {
        discountCodeId: codeId,
        status: data.status as any,
        maxUses: data.maxUses,
        validUntil: data.validUntil
          ? (data.validUntil instanceof Date ? data.validUntil.toISOString() : new Date(data.validUntil as any).toISOString())
          : undefined,
      },
      requiresAuth: true,
    });

    // Source of truth comes from Firestore listeners; return a minimal object to satisfy typing.
    const now = new Date();
    return {
      id: codeId,
      sellerId,
      code: (data as any).code || '',
      type: (data as any).type || 'percentage',
      value: (data as any).value || 0,
      uses: (data as any).uses || 0,
      maxUses: data.maxUses,
      minOrderAmount: (data as any).minOrderAmount,
      validFrom: (data as any).validFrom,
      validUntil: data.validUntil as any,
      status: (data.status as any) || 'active',
      createdAt: (data as any).createdAt,
      updatedAt: now,
    };
  },

  deleteDiscountCode: async (sellerId: string, codeId: string): Promise<void> => {
    await coreCloudClient.request(MARKETING_FUNCTIONS.deleteDiscountCode, {
      method: 'POST',
      body: { codeId },
      requiresAuth: true,
    });
  },

  validateDiscountCode: async (sellerId: string, code: string, orderAmount: number): Promise<any> => {
    return coreCloudClient.request(MARKETING_FUNCTIONS.validateDiscountCode, {
      method: 'POST',
      body: { sellerId, code, orderAmount },
      requiresAuth: false,
    });
  },

  // Email Campaigns
  sendEmailCampaign: async (sellerId: string, data: SendEmailCampaignData): Promise<EmailCampaign> => {
    // No REST backend is configured yet, and there is no Cloud Function wired for campaigns.
    // Keep this explicit so the UI can show a clear error if someone enables it.
    throw new Error('Email campaigns require a backend endpoint (not set up yet).');
  },
};
