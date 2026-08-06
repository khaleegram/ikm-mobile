/**
 * Firestore order listeners — LEGACY SELLER DASHBOARD ONLY.
 *
 * The market app reads orders exclusively from Neon via the Query-backed hooks in
 * `lib/hooks/use-order.ts`. This file remains only for the legacy storefront seller
 * tabs (`app/(tabs)/*`), which still listen to the Firestore `orders` collection
 * (Firestore is still the write primary for order mutations in Cloud Functions).
 * Do not add new market reads here.
 */
import { Order } from '@/types';
import {
  Unsubscribe,
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { firestore } from '../config';

function toOrder(docId: string, data: any): Order {
  return {
    id: docId,
    ...data,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
    sentAt: data.sentAt?.toDate?.(),
    receivedAt: data.receivedAt?.toDate?.(),
    autoReleaseDate: data.autoReleaseDate?.toDate?.(),
    fundsReleasedAt: data.fundsReleasedAt?.toDate?.(),
    sellerAcceptedAt: data.sellerAcceptedAt?.toDate?.(),
    preparingAt: data.preparingAt?.toDate?.(),
    paymentVerifiedAt: data.paymentVerifiedAt?.toDate?.(),
  } as Order;
}

// Get orders by seller with real-time updates (seller tabs / legacy storefront)
export function useSellerOrders(sellerId: string | null) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sellerId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'orders'),
      where('sellerId', '==', sellerId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const ordersList: Order[] = [];
        snapshot.forEach((documentSnapshot) => {
          ordersList.push(toOrder(documentSnapshot.id, documentSnapshot.data()));
        });
        setOrders(ordersList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching seller orders:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sellerId]);

  return { orders, loading, error };
}
