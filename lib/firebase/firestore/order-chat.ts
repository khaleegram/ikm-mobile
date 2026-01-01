// Client-side hooks for order chat messages (read-only)
import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  Timestamp,
} from 'firebase/firestore';
import { firestore } from '../config';
import { OrderMessage } from '@/types';

// Get messages for an order with real-time updates
export function useOrderMessages(orderId: string | null) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!orderId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'order_messages'),
      where('orderId', '==', orderId),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const messagesList: OrderMessage[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          messagesList.push({
            id: doc.id,
            orderId: data.orderId,
            senderId: data.senderId,
            senderRole: data.senderRole,
            message: data.message,
            read: data.read || false,
            createdAt: data.createdAt?.toDate() || new Date(),
          });
        });
        console.log('[Chat] Fetched messages:', messagesList.length, 'for order:', orderId);
        setMessages(messagesList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[Chat] Error fetching order messages:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [orderId]);

  return { messages, loading, error };
}

