// Payouts API endpoints - Uses Cloud Functions
import { coreCloudClient } from './core-cloud-client';
import { Payout } from '@/types';

const PAYOUT_FUNCTIONS = {
  getBanksList: 'https://getbankslist-q3rjv54uka-uc.a.run.app',
  resolveAccountNumber: 'https://resolveaccountnumber-q3rjv54uka-uc.a.run.app',
  savePayoutDetails: 'https://savepayoutdetails-q3rjv54uka-uc.a.run.app',
  requestPayout: 'https://requestpayout-q3rjv54uka-uc.a.run.app',
};

export interface PayoutDetails {
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export interface ResolveAccountResponse {
  accountName: string;
  accountNumber: string;
  bankCode?: string;
}

export const payoutsApi = {
  // Get list of Nigerian banks
  getBanksList: async (): Promise<{ name: string; code: string; [key: string]: any }[]> => {
    const response = await coreCloudClient.request<{ success: boolean; banks: any[] }>(PAYOUT_FUNCTIONS.getBanksList, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
    return response.banks || [];
  },

  // Resolve bank account number to account name
  resolveAccountNumber: async (accountNumber: string, bankCode: string): Promise<ResolveAccountResponse> => {
    return coreCloudClient.request<ResolveAccountResponse>(PAYOUT_FUNCTIONS.resolveAccountNumber, {
      method: 'POST',
      body: { accountNumber, bankCode },
      requiresAuth: true,
    });
  },

  // Save payout bank account details
  savePayoutDetails: async (sellerId: string, details: PayoutDetails): Promise<void> => {
    await coreCloudClient.request(PAYOUT_FUNCTIONS.savePayoutDetails, {
      method: 'POST',
      body: {
        ...details,
        sellerId,
      },
      requiresAuth: true,
    });
  },

  // Request payout
  requestPayout: async (sellerId: string, amount: number): Promise<Payout> => {
    const response = await coreCloudClient.request<Payout>(PAYOUT_FUNCTIONS.requestPayout, {
      method: 'POST',
      body: {
        amount,
        sellerId,
      },
      requiresAuth: true,
    });
    return response;
  },
};
