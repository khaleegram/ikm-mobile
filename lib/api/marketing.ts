// Marketing API endpoints
import { apiClient } from './client';
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
    return apiClient.post<DiscountCode>(`/sellers/${sellerId}/discount-codes`, data);
  },

  updateDiscountCode: async (sellerId: string, codeId: string, data: Partial<DiscountCode>): Promise<DiscountCode> => {
    return apiClient.put<DiscountCode>(`/sellers/${sellerId}/discount-codes/${codeId}`, data);
  },

  deleteDiscountCode: async (sellerId: string, codeId: string): Promise<void> => {
    return apiClient.delete(`/sellers/${sellerId}/discount-codes/${codeId}`);
  },

  // Email Campaigns
  sendEmailCampaign: async (sellerId: string, data: SendEmailCampaignData): Promise<EmailCampaign> => {
    return apiClient.post<EmailCampaign>(`/sellers/${sellerId}/email-campaigns`, data);
  },
};

