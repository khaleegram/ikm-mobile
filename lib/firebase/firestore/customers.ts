// Client-side hooks for reading customer data (read-only)
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot, Unsubscribe, getDocs, doc, getDoc } from 'firebase/firestore';
import { firestore } from '../config';
import { Order, User } from '@/types';

export interface Customer {
  customerId: string;
  name: string;
  email: string;
  phone?: string;
  displayName?: string;
  whatsappNumber?: string;
  totalSpent: number;
  orderCount: number;
  lastOrderDate: Date | null;
  firstOrderDate: Date | null;
  segment: 'VIP' | 'Regular' | 'New';
}

// Get customers for seller (derived from orders)
export function useSellerCustomers(sellerId: string | null) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sellerId) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    // Listen to orders for this seller
    const ordersQuery = query(
      collection(firestore, 'orders'),
      where('sellerId', '==', sellerId)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      ordersQuery,
      async (ordersSnapshot) => {
        try {
          const customerMap = new Map<string, Customer>();

          // Process orders to build customer data
          ordersSnapshot.forEach((doc) => {
            const order = doc.data() as Order;
            const customerId = order.customerId;

            if (!customerId) return;

            if (!customerMap.has(customerId)) {
              const orderDate = order.createdAt instanceof Date 
                ? order.createdAt 
                : (order.createdAt as any)?.toDate 
                  ? (order.createdAt as any).toDate() 
                  : new Date();

              customerMap.set(customerId, {
                customerId,
                name: order.customerInfo?.name || '',
                email: order.customerInfo?.email || '',
                phone: order.customerInfo?.phone,
                totalSpent: 0,
                orderCount: 0,
                lastOrderDate: null,
                firstOrderDate: null,
                segment: 'New',
              });
            }

            const customer = customerMap.get(customerId)!;
            customer.totalSpent += order.total || 0;
            customer.orderCount += 1;

            const orderDate = order.createdAt instanceof Date
              ? order.createdAt
              : (order.createdAt as any)?.toDate
                ? (order.createdAt as any).toDate()
                : new Date();

            if (!customer.lastOrderDate || orderDate > customer.lastOrderDate) {
              customer.lastOrderDate = orderDate;
            }
            if (!customer.firstOrderDate || orderDate < customer.firstOrderDate) {
              customer.firstOrderDate = orderDate;
            }
          });

          // Fetch user profiles for additional info
          const customersList = Array.from(customerMap.values());
          const customerPromises = customersList.map(async (customer) => {
            try {
              const userDoc = await getDoc(doc(firestore, 'users', customer.customerId));
              if (userDoc.exists()) {
                const userData = userDoc.data() as User;
                customer.displayName = userData.displayName;
                customer.whatsappNumber = userData.whatsappNumber;
                if (!customer.name && userData.displayName) {
                  customer.name = userData.displayName;
                }
                if (!customer.email && userData.email) {
                  customer.email = userData.email;
                }
              }
            } catch (err) {
              console.error(`Failed to fetch user ${customer.customerId}:`, err);
            }
            return customer;
          });

          const customersWithProfiles = await Promise.all(customerPromises);

          // Segment customers
          const now = new Date();
          customersWithProfiles.forEach((customer) => {
            if (!customer.firstOrderDate) {
              customer.segment = 'New';
              return;
            }

            const daysSinceFirstOrder =
              (now.getTime() - customer.firstOrderDate.getTime()) / (1000 * 60 * 60 * 24);

            if (customer.totalSpent >= 50000 || customer.orderCount >= 10) {
              customer.segment = 'VIP';
            } else if (daysSinceFirstOrder > 30 && customer.orderCount >= 2) {
              customer.segment = 'Regular';
            } else {
              customer.segment = 'New';
            }
          });

          // Sort by total spent descending
          customersWithProfiles.sort((a, b) => b.totalSpent - a.totalSpent);

          setCustomers(customersWithProfiles);
          setLoading(false);
          setError(null);
        } catch (err) {
          console.error('Error processing customers:', err);
          setError(err as Error);
          setLoading(false);
        }
      },
      (err) => {
        console.error('Error fetching orders for customers:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sellerId]);

  return { customers, loading, error };
}

