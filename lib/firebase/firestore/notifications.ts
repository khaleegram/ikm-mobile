/**
 * Client create helper for in-app notification docs.
 * Reads use CF + TanStack Query (`lib/hooks/use-in-app-notifications.ts`) — no Firestore listeners.
 */
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';

export type CreateNotificationInput = {
  userId: string;
  title: string;
  message?: string;
  body?: string;
  type?: string;
  chatId?: string;
  peerId?: string;
  productId?: string;
  orderId?: string;
  actionUrl?: string;
  [key: string]: unknown;
};

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const userId = String(input.userId || '').trim();
  if (!userId) return;
  const message = String(input.message || input.body || '').trim();
  await addDoc(collection(firestore, 'notifications'), {
    ...input,
    userId,
    title: String(input.title || '').trim() || 'Notification',
    message,
    body: message,
    type: String(input.type || 'general'),
    read: false,
    createdAt: serverTimestamp(),
  });
}

export {
  useNotifications,
  useInAppNotifications,
  markNotificationAsRead,
} from '@/lib/hooks/use-in-app-notifications';
