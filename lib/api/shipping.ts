// Shipping API endpoints
// Cloud-Functions-first (no standalone REST backend configured).
import { cloudFunctions } from './cloud-functions';
import { ShippingZone } from '@/types';

export interface CreateShippingZoneData {
  name: string;
  rate: number;
  freeThreshold?: number;
  states?: string[];
}

export const shippingApi = {
  createShippingZone: async (sellerId: string, data: CreateShippingZoneData): Promise<ShippingZone> => {
    const res = await cloudFunctions.createShippingZone({
      sellerId,
      ...data,
    });

    // Firestore listeners are the source of truth; return a best-effort object.
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
    await cloudFunctions.updateShippingZone({
      sellerId,
      zoneId,
      ...data,
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
    await cloudFunctions.deleteShippingZone({ sellerId, zoneId });
  },
};

