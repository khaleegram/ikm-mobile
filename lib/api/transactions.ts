import { coreCloudClient } from './core-cloud-client';

const TRANSACTION_FUNCTIONS = {
  calculateSellerEarnings: 'https://calculatesellerearnings-q3rjv54uka-uc.a.run.app',
  getSellerTransactions: 'https://getsellertransactions-q3rjv54uka-uc.a.run.app',
};

export interface EarningsStats {
  totalEarnings: number;
  availableForPayout: number;
  pendingEarnings: number;
  withdrawnAmount: number;
  lastPayoutAt?: string;
}

export interface Transaction {
  id: string;
  type: 'sale' | 'payout' | 'refund' | 'adjustment' | 'fee';
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  description: string;
  orderId?: string;
  payoutId?: string;
  createdAt: string;
}

export const transactionsApi = {
  /**
   * Get seller earnings statistics
   */
  getEarnings: async (sellerId?: string): Promise<EarningsStats> => {
    const response = await coreCloudClient.request<any>(TRANSACTION_FUNCTIONS.calculateSellerEarnings, {
      method: 'POST',
      body: { sellerId },
      requiresAuth: true,
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to calculate earnings');
    }

    return response.earnings as EarningsStats;
  },

  /**
   * Get seller transaction history (paginated)
   */
  getTransactions: async (data?: {
    sellerId?: string;
    limit?: number;
    startAfter?: string;
    type?: Transaction['type'];
    status?: Transaction['status'];
  }): Promise<{ transactions: Transaction[]; hasMore: boolean }> => {
    const response = await coreCloudClient.request<any>(TRANSACTION_FUNCTIONS.getSellerTransactions, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to fetch transactions');
    }

    return {
      transactions: response.transactions as Transaction[],
      hasMore: response.hasMore || false,
    };
  },
};
