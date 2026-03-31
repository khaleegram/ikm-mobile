// Order API endpoints - Uses Cloud Functions
// 
// NOTE: Firestore rules require order status to be 'Processing' (capital P) for new orders.
// All status values must match exactly: 'Processing', 'Sent', 'Received', 'Completed', 'Cancelled', 'Disputed'
//
import { coreCloudClient } from './core-cloud-client';
import { Order, OrderStatus } from '@/types';

const ORDER_FUNCTIONS = {
  updateOrderStatus: 'https://updateorderstatus-q3rjv54uka-uc.a.run.app',
  markOrderAsSent: 'https://markorderassent-q3rjv54uka-uc.a.run.app',
  markOrderAsReceived: 'https://markorderasreceived-q3rjv54uka-uc.a.run.app',
  getOrdersByCustomer: 'https://getordersbycustomer-q3rjv54uka-uc.a.run.app',
  getOrdersBySeller: 'https://getordersbyseller-q3rjv54uka-uc.a.run.app',
  markOrderAsNotAvailable: 'https://markorderasnotavailable-q3rjv54uka-uc.a.run.app',
  respondToAvailabilityCheck: 'https://respondtoavailabilitycheck-q3rjv54uka-uc.a.run.app',
};

export const orderApi = {
  // Update order status
  updateStatus: async (
    orderId: string,
    status: OrderStatus
  ): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.updateOrderStatus, {
      method: 'POST',
      body: { orderId, status },
      requiresAuth: true,
    });
  },

  // Mark order as sent with optional photo
  markAsSent: async (
    orderId: string,
    photoUrl?: string,
    waybillParkId?: string,
    waybillParkName?: string
  ): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.markOrderAsSent, {
      method: 'POST',
      body: { orderId, photoUrl, waybillParkId, waybillParkName },
      requiresAuth: true,
    });
  },

  // Mark order as received
  markAsReceived: async (
    orderId: string
  ): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.markOrderAsReceived, {
      method: 'POST',
      body: { orderId },
      requiresAuth: true,
    });
  },

  // Mark order as not available
  markAsNotAvailable: async (data: {
    orderId: string;
    reason?: string;
    waitTimeDays?: number;
  }): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.markOrderAsNotAvailable, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  },

  // Respond to availability check
  respondToAvailability: async (data: {
    orderId: string;
    response: 'wait' | 'cancel';
  }): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.respondToAvailabilityCheck, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  },

  // Get orders by seller
  getOrdersBySeller: async (): Promise<Order[]> => {
    return coreCloudClient.request<Order[]>(ORDER_FUNCTIONS.getOrdersBySeller, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  },

  // Get orders by customer
  getOrdersByCustomer: async (): Promise<Order[]> => {
    return coreCloudClient.request<Order[]>(ORDER_FUNCTIONS.getOrdersByCustomer, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  },
};


