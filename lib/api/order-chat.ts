import { coreCloudClient } from './core-cloud-client';

const ORDER_CHAT_FUNCTIONS = {
  sendOrderChatMessage: 'https://us-central1-ikm-marketplace.cloudfunctions.net/sendOrderChatMessage',
  markOrderMessagesRead: 'https://us-central1-ikm-marketplace.cloudfunctions.net/markOrderMessagesRead',
};

export const orderChatApi = {
  sendMessage: async (params: {
    orderId: string;
    text?: string;
    type?: 'text' | 'image' | 'proof';
    mediaUrl?: string;
    mediaType?: string;
    proofCategory?: 'packaging' | 'dispatch' | 'receipt' | 'damage';
  }): Promise<{ success: boolean; messageId: string }> => {
    return coreCloudClient.request(ORDER_CHAT_FUNCTIONS.sendOrderChatMessage, {
      method: 'POST',
      body: params,
      requiresAuth: true,
    });
  },

  markMessagesRead: async (orderId: string): Promise<{ success: boolean; marked: number }> => {
    return coreCloudClient.request(ORDER_CHAT_FUNCTIONS.markOrderMessagesRead, {
      method: 'POST',
      body: { orderId },
      requiresAuth: true,
    });
  },
};
