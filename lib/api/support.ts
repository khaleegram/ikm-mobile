import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';

const SUPPORT_FUNCTIONS = {
  contactSupport: cloudFunctionUrl('contactSupport'),
};

export const supportApi = {
  /**
   * Send a support request/message
   */
  contact: async (data: {
    name: string;
    email: string;
    subject: string;
    message: string;
    userId?: string;
  }): Promise<{ success: boolean; message: string }> => {
    return coreCloudClient.request<any>(SUPPORT_FUNCTIONS.contactSupport, {
      method: 'POST',
      body: data,
      requiresAuth: !!data.userId,
    });
  },
};
