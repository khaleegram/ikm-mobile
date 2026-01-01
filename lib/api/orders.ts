// Order API endpoints - Uses Cloud Functions
// 
// NOTE: Firestore rules require order status to be 'Processing' (capital P) for new orders.
// All status values must match exactly: 'Processing', 'Sent', 'Received', 'Completed', 'Cancelled', 'Disputed'
//
import { cloudFunctions } from './cloud-functions';
import { Order, OrderStatus } from '@/types';

export const orderApi = {
  // Update order status (uses Cloud Function)
  updateStatus: async (
    orderId: string,
    status: OrderStatus
  ): Promise<Order> => {
    return cloudFunctions.updateOrderStatus({ orderId, status });
  },

  // Mark order as sent with optional photo (uses Cloud Function)
  markAsSent: async (
    orderId: string,
    photoUrl?: string
  ): Promise<Order> => {
    return cloudFunctions.markOrderAsSent({ orderId, photoUrl });
  },

  // Mark order as received with optional photo (uses Cloud Function)
  markAsReceived: async (
    orderId: string,
    photoUrl?: string
  ): Promise<Order> => {
    return cloudFunctions.markOrderAsReceived({ orderId, photoUrl });
  },

  // Get order details (still uses Firestore hook, but can use Cloud Function if needed)
  getOrder: async (orderId: string): Promise<Order> => {
    // For now, we use Firestore hooks for reading orders
    // If you have a getOrder Cloud Function, we can use it here
    throw new Error('Use useOrder hook from lib/firebase/firestore/orders.ts for reading orders');
  },

  // Get orders by seller (uses Cloud Function)
  getOrdersBySeller: async (): Promise<Order[]> => {
    return cloudFunctions.getOrdersBySeller();
  },
};

