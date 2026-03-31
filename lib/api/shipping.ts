// Shipping API endpoints
// Cloud-Functions-first (no standalone REST backend configured).
import { coreCloudClient } from './core-cloud-client';
import { ShippingZone } from '@/types';

const SHIPPING_FUNCTIONS = {
  createShippingZone: 'https://createshippingzone-q3rjv54uka-uc.a.run.app',
  updateShippingZone: 'https://updateshippingzone-q3rjv54uka-uc.a.run.app',
  deleteShippingZone: 'https://deleteshippingzone-q3rjv54uka-uc.a.run.app',
};

export interface CreateShippingZoneData {
  name: string;
  rate: number;
  freeThreshold?: number;
  states?: string[];
}

export const shippingApi = {
  createShippingZone: async (sellerId: string, data: CreateShippingZoneData): Promise<ShippingZone> => {
    const res = await coreCloudClient.request<{
      success: boolean;
      zoneId: string;
      id: string;
    }>(SHIPPING_FUNCTIONS.createShippingZone, {
      method: 'POST',
      body: {
        sellerId,
        ...data,
      },
      requiresAuth: true,
    });

    const now = new Date();
    return {
      id: res?.zoneId || res?.id,
      sellerId,
      name: data.name,
      rate: data.rate,
      freeThreshold: data.freeThreshold,
      states: data.states,
      createdAt: now,
      updatedAt: now,
    };
  },

  updateShippingZone: async (sellerId: string, zoneId: string, data: Partial<ShippingZone>): Promise<ShippingZone> => {
    await coreCloudClient.request(SHIPPING_FUNCTIONS.updateShippingZone, {
      method: 'POST',
      body: {
        sellerId,
        zoneId,
        ...data,
      },
      requiresAuth: true,
    });

    const now = new Date();
    return {
      id: zoneId,
      sellerId,
      name: (data as any).name || '',
      rate: (data as any).rate || 0,
      freeThreshold: (data as any).freeThreshold,
      states: (data as any).states,
      createdAt: (data as any).createdAt,
      updatedAt: now,
    };
  },

  deleteShippingZone: async (sellerId: string, zoneId: string): Promise<void> => {
    await coreCloudClient.request(SHIPPING_FUNCTIONS.deleteShippingZone, {
      method: 'POST',
      body: { sellerId, zoneId },
      requiresAuth: true,
    });
  },
};


