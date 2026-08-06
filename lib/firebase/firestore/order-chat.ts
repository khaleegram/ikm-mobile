import { useEffect, useRef, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { OrderMessage } from '@/types';

export function useOrderMessages(orderId: string | null) {
  // Seller-shell / legacy order chat only. Market order detail uses Neon timeline +
  // Postgres deal-room threads — do not add new market callers of this hook.
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

// Order timeline reads now come from Neon via `useOrder` in lib/hooks/use-order.ts
// (order + timeline in one fetch); the old dual-path useOrderTimeline was removed.
