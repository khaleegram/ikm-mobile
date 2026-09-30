import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';

const TRANSACTION_FUNCTIONS = {
  calculateSellerEarnings: cloudFunctionUrl('calculateSellerEarnings'),
  getSellerTransactions: cloudFunctionUrl('getSellerTransactions'),
};

export interface EarningsStats {
  /** Withdrawable now — released orders only. */
  totalEarnings: number;
  availableBalance: number;
  /** Earned but still held in escrow until delivery is confirmed. */
  pendingEscrow?: number;
  pendingPayouts: number;
  totalPayouts: number;
  commissionPaid: number;
  totalOrders: number;
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
