import { usersApi } from '@/lib/api/users-api';
import { invalidateMyMarketProfile } from '@/lib/hooks/use-my-market-profile';

export type BuyerLocationValue = string | Record<string, unknown> | null;

type BuyerLocationPatch = {
  marketBuyerLocation?: BuyerLocationValue;
  marketBuyerPhone?: string | null;
};

/** Normalize any stored location shape into a single editable label. */
export function formatBuyerLocationLabel(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw !== 'object') return '';
  const obj = raw as Record<string, unknown>;
  const label = String(obj.label || obj.address || '').trim();
  if (label) return label;
  return [obj.city, obj.state].filter(Boolean).map(String).join(', ').trim();
}

export function toBuyerLocationPayload(label: string): { label: string } {
  return { label: String(label || '').trim() };
}

/**
 * Persist buyer delivery prefs to Postgres — the single source of truth.
 *
 * The old Firestore mirror was removed: Cloud Function order-creation now reads
 * buyer phone/location from Neon (`fetchNeonUserProfile`), and every screen reads
 * via `useMyMarketProfile`, so nothing depends on the Firestore users doc for
 * these fields anymore.
 */
export async function saveMarketBuyerProfile(userId: string, patch: BuyerLocationPatch) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('Please log in to continue.');

  const locationPayload =
    patch.marketBuyerLocation === undefined
      ? undefined
      : typeof patch.marketBuyerLocation === 'string'
        ? toBuyerLocationPayload(patch.marketBuyerLocation)
        : patch.marketBuyerLocation;

  await usersApi.updateMe({
    ...(locationPayload !== undefined ? { marketBuyerLocation: locationPayload } : {}),
    ...(patch.marketBuyerPhone !== undefined
      ? { marketBuyerPhone: patch.marketBuyerPhone }
      : {}),
  });

  await invalidateMyMarketProfile();
}
