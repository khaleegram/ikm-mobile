import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
  requireAuth,
  sendError,
  sendResponse,
} from './utils';

const corsHandler = cors({ origin: true });

const NOTIFICATION_EXPIRY_DAYS = 30;

interface FcmTokenDoc {
  token: string;
  platform: 'ios' | 'android';
  createdAt: admin.firestore.Timestamp;
}

async function getFcmTokens(userId: string): Promise<FcmTokenDoc[]> {
  const firestore = admin.firestore();
  const tokensSnap = await firestore
    .collection('users')
    .doc(userId)
    .collection('fcmTokens')
    .get();

  return tokensSnap.docs
    .map((d) => d.data() as FcmTokenDoc)
    .filter((t) => t.token);
}

async function sendFcmPush(tokens: FcmTokenDoc[], title: string, body: string, data?: Record<string, string>): Promise<void> {
  if (tokens.length === 0) return;

  const messages: admin.messaging.Message[] = tokens.map((t) => ({
    token: t.token,
    notification: {
      title,
      body,
    },
    android: {
      priority: 'high' as const,
      notification: {
        channelId: 'orders',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
    data: data || {},
  }));

  try {
    const response = await admin.messaging().sendEach(messages);
    console.log(`FCM: sent ${response.successCount}/${messages.length} notifications`);
    if (response.failureCount > 0) {
      response.responses.forEach((r, i) => {
        if (!r.success) {
          console.warn(`FCM failure for token ${tokens[i].token}: ${r.error?.message}`);
        }
      });
    }
  } catch (err) {
    console.error('FCM send error:', err);
  }
}

function buildActionUrl(
  type: 'order_update' | 'new_message' | 'payment' | 'dispute' | 'system',
  orderId?: string,
  chatRoomId?: string
): string {
  switch (type) {
    case 'order_update':
    case 'payment':
      return orderId ? `/(market)/orders/${orderId}` : '/(market)/orders';
    case 'new_message':
      return orderId ? `/(market)/orders/${orderId}` : '/(market)/messages';
    case 'dispute':
      return orderId ? `/(market)/orders/${orderId}` : '/(market)/orders';
    default:
      return orderId ? `/(market)/orders/${orderId}` : '/(market)/orders';
  }
}

async function createInAppNotification(input: {
  userId: string;
  type: 'order_update' | 'new_message' | 'payment' | 'dispute' | 'system';
  title: string;
  body: string;
  orderId?: string;
  chatRoomId?: string;
  priority?: 'high' | 'medium' | 'low';
}): Promise<string> {
  const firestore = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const expiry = new Date(now.toMillis() + NOTIFICATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const doc = await firestore.collection('notifications').add({
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    orderId: input.orderId || null,
    chatRoomId: input.chatRoomId || null,
    actionUrl: buildActionUrl(input.type, input.orderId, input.chatRoomId),
    read: false,
    readAt: null,
    deliveredVia: ['in_app'],
    priority: input.priority || 'medium',
    createdAt: now,
    expiresAt: admin.firestore.Timestamp.fromDate(expiry),
  });

  return doc.id;
}

async function notifyUser(input: {
  userId: string;
  type: 'order_update' | 'new_message' | 'payment' | 'dispute' | 'system';
  title: string;
  body: string;
  orderId?: string;
  chatRoomId?: string;
  priority?: 'high' | 'medium' | 'low';
  channels?: ('push' | 'in_app' | 'email')[];
}): Promise<void> {
  const channels = input.channels || ['push', 'in_app'];

  const writes: Promise<any>[] = [];

  if (channels.includes('in_app')) {
    writes.push(
      createInAppNotification({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        orderId: input.orderId,
        chatRoomId: input.chatRoomId,
        priority: input.priority,
      })
    );
  }

  if (channels.includes('push')) {
    writes.push(
      getFcmTokens(input.userId).then((tokens) =>
        sendFcmPush(tokens, input.title, input.body, {
          type: input.type,
          orderId: input.orderId || '',
          actionUrl: buildActionUrl(input.type, input.orderId, input.chatRoomId),
        })
      )
    );
  }

  await Promise.all(writes);
}

export async function notifyBuyer(orderData: {
  buyerId: string;
  event: 'payment_success' | 'order_shipped' | 'order_delivered' | 'refund_processed' | 'order_cancelled' | 'dispute_resolved';
  orderId: string;
  orderSummary: string;
  extra?: string;
}): Promise<void> {
  const titles: Record<string, string> = {
    payment_success: 'Payment Successful',
    order_shipped: 'Order Shipped',
    order_delivered: 'Order Delivered',
    refund_processed: 'Refund Processed',
    order_cancelled: 'Order Cancelled',
    dispute_resolved: 'Dispute Resolved',
  };

  const bodies: Record<string, string> = {
    payment_success: `${orderData.orderSummary} — Payment confirmed`,
    order_shipped: `Your order is on the way — ${orderData.extra || orderData.orderSummary}`,
    order_delivered: `Your order has been delivered. Please confirm receipt.`,
    refund_processed: `Refund of ${orderData.orderSummary} has been processed.`,
    order_cancelled: `${orderData.orderSummary} has been cancelled.`,
    dispute_resolved: `Your dispute for ${orderData.orderSummary} has been resolved.`,
  };

  await notifyUser({
    userId: orderData.buyerId,
    type: orderData.event === 'payment_success' ? 'payment' : 'order_update',
    title: titles[orderData.event] || 'Order Update',
    body: bodies[orderData.event] || orderData.orderSummary,
    orderId: orderData.orderId,
    priority: 'high',
    channels: ['push', 'in_app'],
  });
}

export async function notifySeller(orderData: {
  sellerId: string;
  event: 'new_order' | 'payment_received' | 'new_message' | 'delivery_confirmed' | 'dispute_opened' | 'refund_requested' | 'escrow_released';
  orderId: string;
  orderSummary: string;
  extra?: string;
}): Promise<void> {
  const titles: Record<string, string> = {
    new_order: 'New Order Received!',
    payment_received: 'Payment Received',
    new_message: 'New Message from Buyer',
    delivery_confirmed: 'Delivery Confirmed',
    dispute_opened: 'Dispute Opened',
    refund_requested: 'Refund Requested',
    escrow_released: 'Payment Released',
  };

  const bodies: Record<string, string> = {
    new_order: `New order: ${orderData.orderSummary}`,
    payment_received: `Payment for ${orderData.orderSummary} has been received.`,
    new_message: orderData.extra || 'You have a new message about an order.',
    delivery_confirmed: `Buyer confirmed delivery for ${orderData.orderSummary}.`,
    dispute_opened: `A dispute has been opened for ${orderData.orderSummary}.`,
    refund_requested: `Refund requested for ${orderData.orderSummary}.`,
    escrow_released: `NGN ${orderData.orderSummary} released to your balance.`,
  };

  await notifyUser({
    userId: orderData.sellerId,
    type: orderData.event === 'dispute_opened' ? 'dispute' : 'order_update',
    title: titles[orderData.event] || 'Order Update',
    body: bodies[orderData.event] || orderData.orderSummary,
    orderId: orderData.orderId,
    priority: 'high',
    channels: ['push', 'in_app'],
  });
}

export async function notifyNewMessage(input: {
  recipientId: string;
  senderName: string;
  orderId: string;
  orderSummary: string;
  messagePreview: string;
}): Promise<void> {
  await notifyUser({
    userId: input.recipientId,
    type: 'new_message',
    title: input.senderName,
    body: input.messagePreview,
    orderId: input.orderId,
    priority: 'low',
    channels: ['push', 'in_app'],
  });
}

export const registerFcmToken = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { token, platform } = request.body;

      if (!token || !platform) {
        return sendError(response, 'Token and platform are required', 400);
      }

      if (!['ios', 'android'].includes(platform)) {
        return sendError(response, 'Platform must be ios or android', 400);
      }

      const firestore = admin.firestore();
      await firestore
        .collection('users')
        .doc(auth.uid)
        .collection('fcmTokens')
        .doc(token)
        .set({
          token,
          platform,
          createdAt: FieldValue.serverTimestamp(),
        });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error registering FCM token:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const unregisterFcmToken = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { token } = request.body;

      if (!token) {
        return sendError(response, 'Token is required', 400);
      }

      const firestore = admin.firestore();
      await firestore
        .collection('users')
        .doc(auth.uid)
        .collection('fcmTokens')
        .doc(token)
        .delete();

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error unregistering FCM token:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const markNotificationRead = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { notificationId } = request.body;

      if (!notificationId) {
        return sendError(response, 'Notification ID is required', 400);
      }

      const firestore = admin.firestore();
      const notifRef = firestore.collection('notifications').doc(notificationId);
      const notifDoc = await notifRef.get();

      if (!notifDoc.exists) {
        return sendError(response, 'Notification not found', 404);
      }

      if (notifDoc.data()?.userId !== auth.uid) {
        return sendError(response, 'Unauthorized', 403);
      }

      await notifRef.update({
        read: true,
        readAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true });
    } catch (error: any) {
      console.error('Error marking notification read:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const markAllNotificationsRead = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const unreadSnap = await firestore
        .collection('notifications')
        .where('userId', '==', auth.uid)
        .where('read', '==', false)
        .get();

      const batch = firestore.batch();
      unreadSnap.docs.forEach((doc) => {
        batch.update(doc.ref, {
          read: true,
          readAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();

      return sendResponse(response, { success: true, count: unreadSnap.size });
    } catch (error: any) {
      console.error('Error marking all notifications read:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const getNotifications = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const { limit: reqLimit, startAfter } = request.body || {};

      const pageLimit = Math.min(Math.max(Number(reqLimit) || 20, 1), 50);
      const firestore = admin.firestore();

      let query = firestore
        .collection('notifications')
        .where('userId', '==', auth.uid)
        .orderBy('createdAt', 'desc')
        .limit(pageLimit);

      if (startAfter) {
        const startDoc = await firestore.collection('notifications').doc(startAfter).get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      const snapshot = await query.get();
      const notifications = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return sendResponse(response, { notifications, hasMore: snapshot.docs.length === pageLimit });
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});

export const getUnreadNotificationCount = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return sendError(response, 'Method not allowed', 405);
      }

      const auth = await requireAuth(request.headers.authorization || null);
      const firestore = admin.firestore();

      const unreadSnap = await firestore
        .collection('notifications')
        .where('userId', '==', auth.uid)
        .where('read', '==', false)
        .count()
        .get();

      return sendResponse(response, { count: unreadSnap.data().count });
    } catch (error: any) {
      console.error('Error fetching unread count:', error);
      return sendError(response, error.message || 'Internal server error', 500);
    }
  });
});
