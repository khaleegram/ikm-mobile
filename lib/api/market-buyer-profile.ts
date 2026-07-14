import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { usersApi } from '@/lib/api/users-api';
import { firestore } from '@/lib/firebase/config';

type BuyerLocationPatch = {
  marketBuyerLocation?: Record<string, unknown> | null;
  marketBuyerPhone?: string | null;
};

/**
 * Persist buyer delivery prefs to Postgres (market source of truth)
 * and Firestore (orders/Paystack still read users docs).
 */
export async function saveMarketBuyerProfile(userId: string, patch: BuyerLocationPatch) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('Please log in to continue.');

  await usersApi.updateMe({
    ...(patch.marketBuyerLocation !== undefined
      ? { marketBuyerLocation: patch.marketBuyerLocation }
      : {}),
    ...(patch.marketBuyerPhone !== undefined
      ? { marketBuyerPhone: patch.marketBuyerPhone }
      : {}),
  });

  const firestorePatch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.marketBuyerLocation !== undefined) {
    firestorePatch.marketBuyerLocation = patch.marketBuyerLocation;
  }
  if (patch.marketBuyerPhone !== undefined && patch.marketBuyerPhone) {
    firestorePatch.marketBuyerPhone = patch.marketBuyerPhone;
  }
  await setDoc(doc(firestore, 'users', uid), firestorePatch, { merge: true });
}
