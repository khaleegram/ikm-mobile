import { coreCloudClient } from './core-cloud-client';

const SUPPORT_FUNCTIONS = {
  contactSupport: 'https://contactsupport-q3rjv54uka-uc.a.run.app',
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
