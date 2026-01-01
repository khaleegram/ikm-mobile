// Shipping API endpoints
import { apiClient } from './client';
import { ShippingZone } from '@/types';

export interface CreateShippingZoneData {
  name: string;
  rate: number;
  freeThreshold?: number;
  states?: string[];
}

export const shippingApi = {
  createShippingZone: async (sellerId: string, data: CreateShippingZoneData): Promise<ShippingZone> => {
    return apiClient.post<ShippingZone>(`/sellers/${sellerId}/shipping-zones`, data);
  },

  updateShippingZone: async (sellerId: string, zoneId: string, data: Partial<ShippingZone>): Promise<ShippingZone> => {
    return apiClient.put<ShippingZone>(`/sellers/${sellerId}/shipping-zones/${zoneId}`, data);
  },

  deleteShippingZone: async (sellerId: string, zoneId: string): Promise<void> => {
    return apiClient.delete(`/sellers/${sellerId}/shipping-zones/${zoneId}`);
  },
};

