// Order API endpoints - Uses Cloud Functions
// 
// All status values: 'Paid', 'Accepted', 'Preparing', 'Sent', 'Received', 'Completed', 'Cancelled', 'Disputed'
//
import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';
import { Order, OrderStatus } from '@/types';

const ORDER_FUNCTIONS = {
  updateOrderStatus: cloudFunctionUrl('updateOrderStatus'),
  sellerAcceptOrder: cloudFunctionUrl('sellerAcceptOrder'),
  markOrderAsSent: cloudFunctionUrl('markOrderAsSent'),
  markOrderAsReceived: cloudFunctionUrl('markOrderAsReceived'),
  getOrdersByCustomer: cloudFunctionUrl('getOrdersByCustomer'),
  getOrdersBySeller: cloudFunctionUrl('getOrdersBySeller'),
  markOrderAsNotAvailable: cloudFunctionUrl('markOrderAsNotAvailable'),
  respondToAvailabilityCheck: cloudFunctionUrl('respondToAvailabilityCheck'),
};

export const orderApi = {
  updateStatus: async (orderId: string, status: OrderStatus): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.updateOrderStatus, {
      method: 'POST',
      body: { orderId, status },
      requiresAuth: true,
    });
  },

  sellerAccept: async (orderId: string): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.sellerAcceptOrder, {
      method: 'POST',
      body: { orderId },
      requiresAuth: true,
    });
  },

  markAsSent: async (orderId: string, photoUrl?: string, waybillParkId?: string, waybillParkName?: string): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.markOrderAsSent, {
      method: 'POST',
      body: { orderId, photoUrl, waybillParkId, waybillParkName },
      requiresAuth: true,
    });
  },

  markAsReceived: async (orderId: string): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.markOrderAsReceived, {
      method: 'POST',
      body: { orderId },
      requiresAuth: true,
    });
  },

  markAsNotAvailable: async (data: { orderId: string; reason?: string; waitTimeDays?: number }): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.markOrderAsNotAvailable, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  },

  respondToAvailability: async (data: { orderId: string; response: 'wait' | 'cancel' }): Promise<Order> => {
    return coreCloudClient.request<Order>(ORDER_FUNCTIONS.respondToAvailabilityCheck, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  },

  getOrdersBySeller: async (): Promise<Order[]> => {
    return coreCloudClient.request<Order[]>(ORDER_FUNCTIONS.getOrdersBySeller, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  },

  getOrdersByCustomer: async (): Promise<Order[]> => {
    return coreCloudClient.request<Order[]>(ORDER_FUNCTIONS.getOrdersByCustomer, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
  },
};
