// Client-side hooks for reading discount codes (read-only)
import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, Unsubscribe, orderBy } from 'firebase/firestore';
import { firestore } from '../config';
import { DiscountCode } from '@/types';

export function useSellerDiscountCodes(sellerId: string | null) {
  const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sellerId) {
      setDiscountCodes([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'discount_codes'),
      where('sellerId', '==', sellerId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const codesList: DiscountCode[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          codesList.push({
            id: doc.id,
            sellerId: data.sellerId,
            code: data.code,
            type: data.type,
            value: data.value,
            uses: data.uses || 0,
            maxUses: data.maxUses,
            minOrderAmount: data.minOrderAmount,
            validFrom: data.validFrom?.toDate() || undefined,
            validUntil: data.validUntil?.toDate() || undefined,
            status: data.status || 'active',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          });
        });
        setDiscountCodes(codesList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching discount codes:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sellerId]);

  return { discountCodes, loading, error };
}

