import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { firestore } from './firebase.mjs';

const NOTIFICATION_EXPIRY_DAYS = 30;

async function getFcmTokens(userId) {
  const snap = await firestore
    .collection('users')
    .doc(userId)
    .collection('fcmTokens')
    .get();
  return snap.docs.map((d) => d.data()?.token).filter(Boolean);
}

async function loadSenderName(senderId) {
  const snap = await firestore.collection('users').doc(senderId).get();
  if (!snap.exists) return 'Someone';
  const data = snap.data() || {};
  return (
    String(data.displayName || '').trim() ||
    String(data.fullName || '').trim() ||
    String(data.username || '').trim() ||
    'Someone'
  );
}

async function createInAppNotification(input) {
  const now = FieldValue.serverTimestamp();
  const expiry = new Date(Date.now() + NOTIFICATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const peerQs = input.peerId ? `?peerId=${encodeURIComponent(input.peerId)}` : '';
  const actionUrl = `/(market)/messages/${encodeURIComponent(input.threadId)}${peerQs}`;

  await firestore.collection('notifications').add({
    userId: input.recipientId,
    type: 'new_message',
    title: input.title,
    body: input.body,
    orderId: null,
    chatRoomId: input.threadId,
    chatId: input.threadId,
    peerId: input.peerId || null,
    actionUrl,
    read: false,
    readAt: null,
    deliveredVia: ['in_app'],
    priority: 'low',
    createdAt: now,
    expiresAt: expiry,
  });
}

async function sendFcmPush(tokens, title, body, data) {
  if (!tokens.length) return;
  const messaging = getMessaging();
  const messages = tokens.map((token) => ({
    token,
    notification: { title, body },
    android: {
      priority: 'high',
      notification: { channelId: 'messages', sound: 'default' },
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1 } },
    },
    data: data || {},
  }));

  try {
    const response = await messaging.sendEach(messages);
    console.log(`[chat-notify] FCM ${response.successCount}/${messages.length}`);
  } catch (error) {
    console.error('[chat-notify] FCM error:', error?.message || error);
  }
}

export async function notifyChatMessage({
  recipientId,
  senderId,
  threadId,
  peerId,
  preview,
}) {
  if (!recipientId || recipientId === senderId) return;

  const title = await loadSenderName(senderId);
  const body = String(preview || 'New message').trim().slice(0, 180);
  const data = {
    type: 'chat_message',
    chatId: String(threadId),
    threadId: String(threadId),
    peerId: String(peerId || senderId),
  };

  await Promise.allSettled([
    createInAppNotification({ recipientId, threadId, peerId: peerId || senderId, title, body }),
    sendFcmPush(await getFcmTokens(recipientId), title, body, data),
  ]);
}
