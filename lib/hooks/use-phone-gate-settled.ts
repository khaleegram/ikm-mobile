import { useEffect, useState } from 'react';

/**
 * After writing `phone` to Firestore, a newly mounted `onSnapshot` can briefly
 * emit cached/stale data without those fields, which would incorrectly redirect
 * to `/complete-phone` and ping-pong with screens that already see the update.
 *
 * Returns true only after a short delay while `phoneReady` stayed false — treat
 * that as "confirmed missing phone" before redirecting.
 */
export function useConfirmedMissingMarketPhone(phoneReady: boolean): boolean {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (phoneReady) {
      setConfirmed(false);
      return;
    }

    setConfirmed(false);
    const t = setTimeout(() => setConfirmed(true), 900);
    return () => clearTimeout(t);
  }, [phoneReady]);

  return confirmed;
}
