// Market Message API endpoints - Uses Cloud Functions
import { MarketMessage } from '@/types';
import { cloudFunctions } from './cloud-functions';

export const marketMessagesApi = {
  // Create chat (uses Cloud Function)
  createChat: async (
    buyerId: string,
    posterId: string,
    postId: string
  ): Promise<{ chatId: string; chat: any }> => {
    const response = await cloudFunctions.createMarketChat({
      buyerId,
      posterId,
      postId,
    });

    return {
      chatId: response.chatId,
      chat: response.chat,
    };
  },

  // Send message (uses Cloud Function)
  sendMessage: async (
    chatId: string,
    message: string,
    imageUrl?: string,
    paymentLink?: string
  ): Promise<{ messageId: string }> => {
    if (!message.trim() && !imageUrl) {
      throw new Error('Message or image is required');
    }

    const response = await cloudFunctions.sendMarketMessage({
      chatId,
      message: message.trim() || '',
      imageUrl,
      paymentLink,
    });

    return {
      messageId: response.messageId,
    };
  },

  // Mark messages as read (uses Cloud Function)
  markAsRead: async (chatId: string, messageIds: string[]): Promise<void> => {
    // TODO: Implement when backend function is available
    // For now, this can be handled client-side by updating Firestore directly
    // or through a Cloud Function
    console.log('Mark as read:', chatId, messageIds);
  },
};
