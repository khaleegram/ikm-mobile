// Marketing API endpoints
// This app is currently Cloud-Functions-first. Until a standalone REST backend exists,
// keep seller write operations routed through Cloud Functions.
import { cloudFunctions } from './cloud-functions';
import { DiscountCode, EmailCampaign } from '@/types';

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
    const res = await cloudFunctions.createDiscountCode({
      sellerId,
      code: data.code,
      type: data.type,
      value: data.value,
      maxUses: data.maxUses,
      minOrderAmount: data.minOrderAmount,
      validFrom: data.validFrom ? data.validFrom.toISOString() : undefined,
      validUntil: data.validUntil ? data.validUntil.toISOString() : undefined,
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
    await cloudFunctions.updateDiscountCode({
      discountCodeId: codeId,
      status: data.status as any,
      maxUses: data.maxUses,
      validUntil: data.validUntil
        ? (data.validUntil instanceof Date ? data.validUntil.toISOString() : new Date(data.validUntil as any).toISOString())
        : undefined,
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
    await cloudFunctions.deleteDiscountCode(codeId);
  },

  // Email Campaigns
  sendEmailCampaign: async (sellerId: string, data: SendEmailCampaignData): Promise<EmailCampaign> => {
    // No REST backend is configured yet, and there is no Cloud Function wired for campaigns.
    // Keep this explicit so the UI can show a clear error if someone enables it.
    throw new Error('Email campaigns require a backend endpoint (not set up yet).');
  },
};

