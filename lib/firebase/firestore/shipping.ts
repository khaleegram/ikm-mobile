// Client-side hooks for reading shipping data (read-only)
import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, Unsubscribe, orderBy, doc } from 'firebase/firestore';
import { firestore } from '../config';
import { ShippingZone } from '@/types';

export interface ShippingSettings {
  sellerId: string;
  defaultPackagingType?: string;
  packagingCost?: number;
}

export function useSellerShippingZones(sellerId: string | null) {
  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sellerId) {
      setZones([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'shipping_zones'),
      where('sellerId', '==', sellerId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const zonesList: ShippingZone[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          zonesList.push({
            id: doc.id,
            sellerId: data.sellerId,
            name: data.name,
            rate: data.rate || 0,
            freeThreshold: data.freeThreshold,
            states: data.states || [],
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          });
        });
        setZones(zonesList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching shipping zones:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sellerId]);

  return { zones, loading, error };
}

