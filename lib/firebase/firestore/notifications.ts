import { useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, query, where, orderBy, limit, Unsubscribe } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { AppNotification } from '@/types';

export function useNotifications(userId: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(firestore, 'notifications'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsub: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: AppNotification[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        } as AppNotification));
        setNotifications(items);
        setUnreadCount(items.filter((n) => !n.read).length);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching notifications:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  return { notifications, unreadCount, loading };
}
