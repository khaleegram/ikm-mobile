// Payouts API endpoints - Uses Cloud Functions
import { cloudFunctions } from './cloud-functions';
import { Payout } from '@/types';

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
  // Get list of Nigerian banks (uses Cloud Function)
  getBanksList: async (): Promise<Array<{ name: string; code: string; [key: string]: any }>> => {
    const response = await cloudFunctions.getBanksList();
    return response.banks || [];
  },

  // Resolve bank account number to account name (uses Cloud Function)
  resolveAccountNumber: async (accountNumber: string, bankCode: string): Promise<ResolveAccountResponse> => {
    return cloudFunctions.resolveAccountNumber({ accountNumber, bankCode });
  },

  // Save payout bank account details (uses Cloud Function)
  savePayoutDetails: async (sellerId: string, details: PayoutDetails): Promise<void> => {
    await cloudFunctions.savePayoutDetails({
      ...details,
      sellerId, // Include sellerId if your Cloud Function needs it
    });
  },

  // Request payout (if you have a Cloud Function for this, we can add it)
  requestPayout: async (sellerId: string, amount: number): Promise<Payout> => {
    // If you have a requestPayout Cloud Function, let me know and I'll add it
    throw new Error('Request payout Cloud Function not found. If you have one, please provide the URL.');
  },
};

