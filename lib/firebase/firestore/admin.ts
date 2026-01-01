// Admin Firestore hooks for fetching platform-wide data
import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { firestore } from '../config';
import { User, Order, Product } from '@/types';

// Get all users for admin
export function useAllUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Query without orderBy to avoid index requirement
    // We'll sort in memory if needed
    const q = query(collection(firestore, 'users'));

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const usersList: User[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          usersList.push({
            id: doc.id,
            displayName: data.displayName || '',
            email: data.email || '',
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            whatsappNumber: data.whatsappNumber,
            isAdmin: data.isAdmin || false,
            storeName: data.storeName,
            storeDescription: data.storeDescription,
            storeLogoUrl: data.storeLogoUrl,
            storeBannerUrl: data.storeBannerUrl,
            storeLocation: data.storeLocation,
            businessType: data.businessType,
            storePolicies: data.storePolicies,
            payoutDetails: data.payoutDetails,
            onboardingCompleted: data.onboardingCompleted,
            isGuest: data.isGuest,
            role: data.role || (data.isAdmin ? 'admin' : 'customer'), // Include role field
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          } as User & { role?: string });
        });
        // Sort by createdAt descending in memory
        usersList.sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });
        setUsers(usersList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching users:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { users, loading, error };
}

// Get all orders for admin
export function useAllOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(
      collection(firestore, 'orders'),
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
        console.error('Error fetching orders:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { orders, loading, error };
}

// Get all products for admin
export function useAllProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(
      collection(firestore, 'products'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const productsList: Product[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          productsList.push({
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          } as Product);
        });
        setProducts(productsList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching products:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { products, loading, error };
}

// Get platform statistics
export function usePlatformStats() {
  const { users } = useAllUsers();
  const { orders } = useAllOrders();
  const { products } = useAllProducts();

  const stats = {
    totalUsers: users.length,
    totalSellers: users.filter(u => u.role === 'seller').length,
    totalCustomers: users.filter(u => u.role === 'customer' || !u.role).length,
    totalOrders: orders.length,
    totalProducts: products.length,
    totalRevenue: orders
      .filter(o => o.status !== 'Cancelled' && o.status !== 'Disputed')
      .reduce((sum, order) => sum + (order.total || 0), 0),
    activeProducts: products.filter(p => p.status === 'active').length,
    processingOrders: orders.filter(o => o.status === 'Processing').length,
    completedOrders: orders.filter(o => o.status === 'Completed' || o.status === 'Received').length,
  };

  return stats;
}

