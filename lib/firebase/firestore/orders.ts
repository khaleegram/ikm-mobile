// Client-side hooks for reading order data (read-only)
import { Order } from '@/types';
import {
    Unsubscribe,
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    where,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { firestore } from '../config';

// Get orders by seller with real-time updates
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
        snapshot.forEach((doc) => {
          const data = doc.data();
          ordersList.push({
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          } as Order);
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

// Get single order with real-time updates
export function useOrder(orderId: string | null) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setLoading(false);
      return;
    }

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'orders', orderId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setOrder({
            id: snapshot.id,
            ...data,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          } as Order);
        } else {
          setOrder(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching order:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [orderId]);

  return { order, loading, error };
}

