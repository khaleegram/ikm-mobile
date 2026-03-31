import { coreCloudClient } from './core-cloud-client';
import { OrderMessage } from '@/types';

const CHAT_FUNCTIONS = {
  sendOrderMessage: 'https://sendordermessage-q3rjv54uka-uc.a.run.app',
  markOrderMessagesAsRead: 'https://markordermessagesasread-q3rjv54uka-uc.a.run.app',
};

export interface SendMessageData {
  orderId: string;
  message: string;
}

export const orderChatApi = {
  // Send a message in order chat
  sendMessage: async (data: SendMessageData): Promise<OrderMessage> => {
    return coreCloudClient.request<OrderMessage>(CHAT_FUNCTIONS.sendOrderMessage, {
      method: 'POST',
      body: {
        orderId: data.orderId,
        message: data.message,
      },
      requiresAuth: true,
    });
  },

  // Mark messages as read
  markAsRead: async (orderId: string, messageIds: string[]): Promise<void> => {
    await coreCloudClient.request(CHAT_FUNCTIONS.markOrderMessagesAsRead, {
      method: 'POST',
      body: { orderId, messageIds },
      requiresAuth: true,
    });
  },
};


