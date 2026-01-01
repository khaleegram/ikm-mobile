// Client-side hooks for reading notification data (read-only)
import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  doc,
  updateDoc,
  addDoc,
  getDocs,
} from 'firebase/firestore';
import { firestore } from '../config';
import { Notification } from '@/types';

// Get notifications by user with real-time updates
export function useNotifications(userId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'notifications'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const notificationsList: Notification[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          notificationsList.push({
            id: doc.id,
            userId: data.userId,
            title: data.title,
            message: data.message,
            type: data.type,
            read: data.read || false,
            orderId: data.orderId,
            productId: data.productId,
            status: data.status,
            amount: data.amount,
            createdAt: data.createdAt?.toDate() || new Date(),
          } as Notification);
        });
        setNotifications(notificationsList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching notifications:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { notifications, loading, error };
}

// Mark notification as read
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(firestore, 'notifications', notificationId), {
      read: true,
      updatedAt: new Date(),
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

// Mark all notifications as read for a user
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  try {
    const q = query(
      collection(firestore, 'notifications'),
      where('userId', '==', userId),
      where('read', '==', false)
    );

    // Note: This requires a batch update for multiple documents
    // For now, we'll update them one by one (could be optimized with batch)
    const snapshot = await getDocs(q);
    const updatePromises = snapshot.docs.map(doc =>
      updateDoc(doc.ref, {
        read: true,
        updatedAt: new Date(),
      })
    );
    await Promise.all(updatePromises);
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
}

// Get unread notification count
export function useUnreadNotificationCount(userId: string | null) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'notifications'),
      where('userId', '==', userId),
      where('read', '==', false)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setCount(snapshot.size);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching unread count:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { count, loading };
}

/**
 * Create a notification in Firestore
 * Note: This is a client-side function. Ideally, notifications should be created via Cloud Functions,
 * but this allows immediate notification creation for client-side events.
 */
export async function createNotification(notification: Omit<Notification, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const docRef = await addDoc(collection(firestore, 'notifications'), {
      ...notification,
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

