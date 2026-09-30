import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';

export type DisputeCategory =
  | 'not_received'
  | 'wrong_item'
  | 'damaged'
  | 'fake_or_not_as_described'
  | 'other';

const DISPUTE_FUNCTIONS = {
  openOrderDispute: cloudFunctionUrl('openOrderDispute'),
  getOpenDisputes: cloudFunctionUrl('getOpenDisputes'),
};

export const disputesApi = {
  open: async (params: {
    orderId: string;
    category: DisputeCategory;
    reason: string;
    evidenceUrls?: string[];
  }): Promise<{ success: boolean; disputeId: string }> => {
    return coreCloudClient.request(DISPUTE_FUNCTIONS.openOrderDispute, {
      method: 'POST',
      body: params,
      requiresAuth: true,
    });
  },

  listOpen: async (): Promise<{ orders: any[] }> => {
    return coreCloudClient.request(DISPUTE_FUNCTIONS.getOpenDisputes, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  },
};
