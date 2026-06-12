import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit, Unsubscribe } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { OrderMessage } from '@/types';

export function useOrderMessages(orderId: string | null) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const unsubRef = useRef<Unsubscribe | null>(null);

  useEffect(() => {
    if (!orderId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(firestore, 'orders', orderId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: OrderMessage[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        } as OrderMessage));
        setMessages(items);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching order messages:', err);
        setError(err as Error);
        setLoading(false);
      }
    );

    unsubRef.current = unsub;

    return () => {
      unsub();
      unsubRef.current = null;
    };
  }, [orderId]);

  return { messages, loading, error };
}

export function useOrderTimeline(orderId: string | null) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(firestore, 'orders', orderId, 'timeline'),
      orderBy('createdAt', 'asc'),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setEvents(items);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching order timeline:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [orderId]);

  return { events, loading };
}
