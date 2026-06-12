import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
  requireAuth,
  sendError,
  sendResponse,
} from './utils';
import { notifyNewMessage } from './notifications';

const corsHandler = cors({ origin: true });

const SYSTEM_MESSAGES: Record<string, string> = {
  order_paid: 'Order confirmed. Payment received.',
  seller_accepted: 'Seller accepted the order.',
  seller_preparing: 'Seller is preparing your order.',
  order_shipped: 'Seller marked order as shipped.',
  order_delivered: 'Order delivered.',
  buyer_confirmed: 'Buyer confirmed receipt. Order completed.',
  order_cancelled: 'Order cancelled.',
  dispute_opened: 'A dispute has been opened for this order.',
  dispute_resolved: 'Dispute resolved.',
  escrow_released: 'Payment released to seller.',
  refund_processed: 'Refund processed.',
};

export async function createSystemMessage(input: {
  orderId: string;
  event: string;
  customText?: string;
}): Promise<void> {
  const firestore = admin.firestore();
  const text = input.customText || SYSTEM_MESSAGES[input.event] || `Order status: ${input.event}`;

  const messageRef = firestore
    .collection('orders')
    .doc(input.orderId)
    .collection('messages')
    .doc();

  await messageRef.set({
    orderId: input.orderId,
    senderId: 'system',
    senderRole: 'system',
    type: 'system',
    text,
    systemEvent: input.event,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  await firestore.collection('orders').doc(input.orderId).update({
    lastMessage: {
      text,
      senderRole: 'system',
      createdAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function incrementUnread(orderId: string, role: 'buyer' | 'seller'): Promise<void> {
  const firestore = admin.firestore();
  const field = role === 'buyer' ? 'buyerUnreadCount' : 'sellerUnreadCount';
  await firestore.collection('orders').doc(orderId).update({
    [field]: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function resetUnread(orderId: string, role: 'buyer' | 'seller'): Promise<void> {
  const firestore = admin.firestore();
  const field = role === 'buyer' ? 'buyerUnreadCount' : 'sellerUnreadCount';
  await firestore.collection('orders').doc(orderId).update({
    [field]: 0,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export const sendOrderChatMessage = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId, text, type, mediaUrl, mediaType, proofCategory } = request.body;

      if (!orderId) return sendError(response, 'Order ID is required', 400);
      if (!text && !mediaUrl) return sendError(response, 'Message text or media is required', 400);

      const firestore = admin.firestore();
      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);

      const order = orderDoc.data()!;
      const isBuyer = order.customerId === auth.uid;
      const isSeller = order.sellerId === auth.uid;

      if (!isBuyer && !isSeller) {
        return sendError(response, 'Unauthorized: You are not a participant in this order', 403);
      }

      const senderRole = isBuyer ? 'buyer' : 'seller';
      const recipientId = isBuyer ? order.sellerId : order.customerId;

      const messageRef = firestore
        .collection('orders')
        .doc(orderId)
        .collection('messages')
        .doc();

      const messageData: Record<string, any> = {
        orderId,
        senderId: auth.uid,
        senderRole,
        type: type || 'text',
        text: text || null,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        proofCategory: proofCategory || null,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      };

      await messageRef.set(messageData);

      const preview = text
        ? text.slice(0, 80)
        : mediaUrl
          ? '📎 Attachment'
          : 'New message';

      await orderRef.update({
        lastMessage: {
          text: preview,
          senderRole,
          createdAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      await incrementUnread(orderId, isBuyer ? 'seller' : 'buyer');

      const orderSummary = (order.items?.[0]?.name || 'item') + (order.items?.length > 1 ? ` +${order.items.length - 1}` : '');

      notifyNewMessage({
        recipientId,
        senderName: senderRole === 'buyer' ? 'Buyer' : 'Seller',
        orderId,
        orderSummary,
        messagePreview: preview,
      }).catch((err) => console.error('Failed to send message notification:', err));

      return sendResponse(response, {
        success: true,
        messageId: messageRef.id,
      });
    } catch (error: any) {
      console.error('Error sending order message:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const markOrderMessagesRead = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { orderId } = request.body;

      if (!orderId) return sendError(response, 'Order ID is required', 400);

      const firestore = admin.firestore();
      const orderDoc = await firestore.collection('orders').doc(orderId).get();

      if (!orderDoc.exists) return sendError(response, 'Order not found', 404);

      const order = orderDoc.data()!;
      const isBuyer = order.customerId === auth.uid;
      const isSeller = order.sellerId === auth.uid;

      if (!isBuyer && !isSeller && !auth.isAdmin) {
        return sendError(response, 'Unauthorized', 403);
      }

      const unreadSnap = await firestore
        .collection('orders')
        .doc(orderId)
        .collection('messages')
        .where('senderId', '!=', auth.uid)
        .where('read', '==', false)
        .get();

      if (unreadSnap.empty) {
        return sendResponse(response, { success: true, marked: 0 });
      }

      const batch = firestore.batch();
      unreadSnap.docs.forEach((doc) => {
        batch.update(doc.ref, {
          read: true,
          readAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();

      await resetUnread(orderId, isBuyer ? 'buyer' : 'seller');

      return sendResponse(response, { success: true, marked: unreadSnap.size });
    } catch (error: any) {
      console.error('Error marking order messages read:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const createOrderTimelineEvent = async (input: {
  orderId: string;
  event: string;
  status: string;
  text: string;
  actorId?: string;
  actorRole?: 'buyer' | 'seller' | 'system';
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  const firestore = admin.firestore();

  await firestore
    .collection('orders')
    .doc(input.orderId)
    .collection('timeline')
    .add({
      orderId: input.orderId,
      event: input.event,
      status: input.status,
      text: input.text,
      actorId: input.actorId || null,
      actorRole: input.actorRole || null,
      metadata: input.metadata || null,
      createdAt: FieldValue.serverTimestamp(),
    });
};
