// Order chat API endpoints - Uses Cloud Functions
import { cloudFunctions } from './cloud-functions';
import { OrderMessage } from '@/types';

export interface SendMessageData {
  orderId: string;
  message: string;
}

export const orderChatApi = {
  // Send a message in order chat (uses Cloud Function)
  sendMessage: async (data: SendMessageData): Promise<OrderMessage> => {
    return cloudFunctions.sendOrderMessage({
      orderId: data.orderId,
      message: data.message,
    });
  },

  // Mark messages as read (still uses Firestore directly for now)
  // If you have a Cloud Function for this, we can add it
  markAsRead: async (orderId: string, messageIds: string[]): Promise<void> => {
    // For now, this can be handled client-side via Firestore update
    // If you have a Cloud Function, we can use it here
    throw new Error('Mark as read is handled via Firestore hooks. If you have a Cloud Function, let me know!');
  },
};

