// Platform settings Firestore hooks
import { useEffect, useState } from 'react';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { firestore } from '../config';

export interface PlatformSettings {
  commissionRate?: number;
  minPayoutAmount?: number;
  autoReleaseDays?: number;
  updatedAt?: Date;
}

export function usePlatformSettings() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'platform_settings', 'main'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          // Cloud Function returns platformCommissionRate as decimal (0.05 = 5%)
          // Convert to percentage for display
          const commissionRate = data.platformCommissionRate || data.commissionRate || 0.05;
          setSettings({
            commissionRate: typeof commissionRate === 'number' && commissionRate < 1 
              ? commissionRate * 100  // Convert decimal to percentage
              : (commissionRate || 5),
            minPayoutAmount: data.minimumPayoutAmount || data.minPayoutAmount || 10000,
            autoReleaseDays: data.autoReleaseDays || 7,
            updatedAt: data.updatedAt?.toDate() || new Date(),
          });
        } else {
          // Default values if document doesn't exist
          setSettings({
            commissionRate: 5,
            minPayoutAmount: 10000,
            autoReleaseDays: 7,
            updatedAt: new Date(),
          });
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching platform settings:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { settings, loading, error };
}

