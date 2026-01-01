// Client-side hooks for reading payout data (read-only)
import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, Unsubscribe, orderBy } from 'firebase/firestore';
import { firestore } from '../config';
import { Payout } from '@/types';

export function useSellerPayouts(sellerId: string | null) {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sellerId) {
      setPayouts([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'payouts'),
      where('sellerId', '==', sellerId),
      orderBy('requestedAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const payoutsList: Payout[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          payoutsList.push({
            id: doc.id,
            sellerId: data.sellerId,
            amount: data.amount || 0,
            bankName: data.bankName,
            bankCode: data.bankCode,
            accountNumber: data.accountNumber,
            accountName: data.accountName,
            status: data.status || 'pending',
            requestedAt: data.requestedAt?.toDate() || new Date(),
            processedAt: data.processedAt?.toDate(),
            processedBy: data.processedBy,
            transferReference: data.transferReference,
            failureReason: data.failureReason,
            createdAt: data.createdAt?.toDate() || new Date(),
          });
        });
        setPayouts(payoutsList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching payouts:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sellerId]);

  return { payouts, loading, error };
}

