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
  } as Order;
}

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
          ordersList.push(toOrder(doc.id, doc.data()));
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

// Get orders by customer with real-time updates
export function useCustomerOrders(customerId: string | null) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!customerId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'orders'),
      where('customerId', '==', customerId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const ordersList: Order[] = [];
        snapshot.forEach((item) => {
          ordersList.push(toOrder(item.id, item.data()));
        });
        setOrders(ordersList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching customer orders:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [customerId]);

  return { orders, loading, error };
}

// Get combined orders where user is either buyer or seller (market flow)
export function useUserOrders(userId: string | null) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let sellerDone = false;
    let customerDone = false;
    let sellerOrders: Order[] = [];
    let customerOrders: Order[] = [];

    const mergeAndSet = () => {
      const map = new Map<string, Order>();
      [...sellerOrders, ...customerOrders].forEach((order) => {
        if (!order.id) return;
        map.set(order.id, order);
      });
      const merged = [...map.values()].sort((a, b) => {
        const timeA =
          a.createdAt instanceof Date
            ? a.createdAt.getTime()
            : typeof (a.createdAt as any)?.toDate === 'function'
              ? (a.createdAt as any).toDate().getTime()
              : 0;
        const timeB =
          b.createdAt instanceof Date
            ? b.createdAt.getTime()
            : typeof (b.createdAt as any)?.toDate === 'function'
              ? (b.createdAt as any).toDate().getTime()
              : 0;
        return timeB - timeA;
      });
      setOrders(merged);
      if (sellerDone && customerDone) {
        setLoading(false);
      }
    };

    const sellerQuery = query(
      collection(firestore, 'orders'),
      where('sellerId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    const customerQuery = query(
      collection(firestore, 'orders'),
      where('customerId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    const unsubSeller = onSnapshot(
      sellerQuery,
      (snapshot) => {
        sellerOrders = snapshot.docs.map((docSnap) => toOrder(docSnap.id, docSnap.data()));
        sellerDone = true;
        setError(null);
        mergeAndSet();
      },
      (err) => {
        console.error('Error fetching seller-side orders:', err);
        sellerDone = true;
        setError(err);
        mergeAndSet();
      }
    );

    const unsubCustomer = onSnapshot(
      customerQuery,
      (snapshot) => {
        customerOrders = snapshot.docs.map((docSnap) => toOrder(docSnap.id, docSnap.data()));
        customerDone = true;
        setError(null);
        mergeAndSet();
      },
      (err) => {
        console.error('Error fetching buyer-side orders:', err);
        customerDone = true;
        setError(err);
        mergeAndSet();
      }
    );

    return () => {
      unsubSeller();
      unsubCustomer();
    };
  }, [userId]);

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
          setOrder(toOrder(snapshot.id, snapshot.data()));
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

