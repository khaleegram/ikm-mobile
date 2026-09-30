import { appStorage } from '@/lib/storage/mmkv';

/** Legacy single-slot key — migrated into per-post slots on read. */
export const PENDING_ESCROW_CHECKOUT_KEY = '@ikm_market_pending_escrow_checkout_v1';

const PENDING_ESCROW_SLOT_PREFIX = '@ikm_market_pending_escrow_v2:';
const PENDING_ESCROW_REF_INDEX_KEY = '@ikm_market_pending_escrow_ref_index_v2';

/**
 * Local recovery payload for interrupted Paystack checkouts.
 * Money-safety rule: never delete this unless
 * 1) an order was created for the reference, OR
 * 2) Paystack confirms the reference is terminal unpaid (abandoned/failed/etc).
 *
 * Isolation rule: each buyer+post pair has its own slot. Product A's pending
 * payment must never block or finalize Product B.
 */
export type PendingEscrowCheckout = {
  reference: string;
  amount: number; // NGN
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  post: any;
  quantity: number;
  finalPrice: number;
  deliveryAddress: string;
  fromChatId?: string | null;
  deliveryState?: string;
  deliveryCity?: string;
  addressLine?: string;
  createdAtMs: number;
  /**
   * `initialized` = Paystack session opened (may still become paid via bank/USSD).
   * `submitted` = gateway/callback reported success — must keep until order exists.
   */
  phase?: 'initialized' | 'submitted';
  /** Cart lines for multi-item / multi-seller recovery finalize. */
  lineItems?: Array<{
    postId: string;
    quantity: number;
    unitPrice: number;
    title?: string;
  }>;
  cartSessionId?: string | null;
  /**
   * Which backend priced this charge. A payment made through `chatcart-api` must be
   * finalized by `chatcart-api`; sending it to the Cloud Function instead would
   * create a Firestore order and leave the paid session with no order in Neon.
   */
  paymentBackend?: 'firebase' | 'chatcart';
  /** The code this charge was priced under, so a recovery finalize applies it too. */
  promoCode?: string | null;
  /** The cart, exactly as sent to `chatcart-api`, for a recovery finalize. */
  cartItems?: Array<{ id: string; sellerId: string; name: string; price: number; quantity: number }>;
};

export type PendingEscrowScope = {
  postId: string;
  buyerId: string;
};

type PendingEscrowRefIndex = Record<string, { postId: string; buyerId: string }>;

/** Soft stale hint only — we do NOT auto-delete money-related pending rows. */
const PENDING_ESCROW_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function asNonEmpty(value: unknown): string {
  return String(value ?? '').trim();
}

function scopeFromPending(pending: PendingEscrowCheckout): PendingEscrowScope | null {
  const postId = asNonEmpty(pending?.post?.id);
  const buyerId = asNonEmpty(pending?.buyerId);
  if (!postId || !buyerId) return null;
  return { postId, buyerId };
}

function slotKey(scope: PendingEscrowScope): string {
  // Encode so buyer/post ids cannot collide across separators.
  return `${PENDING_ESCROW_SLOT_PREFIX}${encodeURIComponent(scope.buyerId)}:${encodeURIComponent(scope.postId)}`;
}

function readRefIndex(): PendingEscrowRefIndex {
  try {
    const raw = appStorage.getString(PENDING_ESCROW_REF_INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PendingEscrowRefIndex;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRefIndex(index: PendingEscrowRefIndex): void {
  try {
    appStorage.set(PENDING_ESCROW_REF_INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    console.warn('Unable to persist pending escrow reference index:', error);
  }
}

function indexReference(reference: string, scope: PendingEscrowScope): void {
  const ref = asNonEmpty(reference);
  if (!ref) return;
  const index = readRefIndex();
  index[ref] = { postId: scope.postId, buyerId: scope.buyerId };
  writeRefIndex(index);
}

function unindexReference(reference: string): void {
  const ref = asNonEmpty(reference);
  if (!ref) return;
  const index = readRefIndex();
  if (!index[ref]) return;
  delete index[ref];
  writeRefIndex(index);
}

function parsePending(raw: string | undefined | null): PendingEscrowCheckout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingEscrowCheckout;
    const reference = asNonEmpty(parsed?.reference);
    if (!reference) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** One-time move of the old global slot into a per-post slot. */
function migrateLegacyGlobalSlot(): void {
  try {
    const raw = appStorage.getString(PENDING_ESCROW_CHECKOUT_KEY);
    if (!raw) return;
    const legacy = parsePending(raw);
    appStorage.remove(PENDING_ESCROW_CHECKOUT_KEY);
    if (!legacy) return;
    const scope = scopeFromPending(legacy);
    if (!scope) return;
    // Do not overwrite a newer scoped slot for the same product.
    const existing = appStorage.getString(slotKey(scope));
    if (!existing) {
      appStorage.set(slotKey(scope), JSON.stringify(legacy));
      indexReference(legacy.reference, scope);
    }
  } catch (error) {
    console.warn('Unable to migrate legacy pending escrow checkout:', error);
  }
}

function readSlot(scope: PendingEscrowScope): PendingEscrowCheckout | null {
  migrateLegacyGlobalSlot();
  const postId = asNonEmpty(scope.postId);
  const buyerId = asNonEmpty(scope.buyerId);
  if (!postId || !buyerId) return null;
  return parsePending(appStorage.getString(slotKey({ postId, buyerId })));
}

export async function savePendingEscrowCheckout(pending: PendingEscrowCheckout): Promise<void> {
  const reference = asNonEmpty(pending?.reference);
  const scope = scopeFromPending(pending);
  if (!reference || !scope) return;
  try {
    migrateLegacyGlobalSlot();
    const payload: PendingEscrowCheckout = {
      ...pending,
      reference,
      buyerId: scope.buyerId,
      phase: pending.phase || 'initialized',
      createdAtMs: Number(pending.createdAtMs) || Date.now(),
    };
    // If this slot already had a different reference, drop the old index entry only.
    const previous = parsePending(appStorage.getString(slotKey(scope)));
    if (previous?.reference && previous.reference !== reference) {
      unindexReference(previous.reference);
    }
    appStorage.set(slotKey(scope), JSON.stringify(payload));
    indexReference(reference, scope);
  } catch (error) {
    console.warn('Unable to persist pending escrow checkout:', error);
  }
}

export async function readPendingEscrowCheckout(
  scope: PendingEscrowScope
): Promise<PendingEscrowCheckout | null> {
  try {
    return readSlot(scope);
  } catch (error) {
    console.warn('Unable to read pending escrow checkout:', error);
    return null;
  }
}

/** Deep-link / callback recovery: find the exact pending row for a Paystack reference. */
export async function findPendingEscrowCheckoutByReference(
  reference: string
): Promise<PendingEscrowCheckout | null> {
  const ref = asNonEmpty(reference);
  if (!ref) return null;
  try {
    migrateLegacyGlobalSlot();
    const indexed = readRefIndex()[ref];
    if (indexed?.postId && indexed?.buyerId) {
      const pending = readSlot(indexed);
      if (pending && asNonEmpty(pending.reference) === ref) return pending;
    }

    // Fallback scan of scoped slots (covers index loss after upgrades).
    const keys = typeof (appStorage as any).getAllKeys === 'function'
      ? ((appStorage as any).getAllKeys() as string[])
      : [];
    for (const key of keys) {
      if (!String(key).startsWith(PENDING_ESCROW_SLOT_PREFIX)) continue;
      const pending = parsePending(appStorage.getString(key));
      if (pending && asNonEmpty(pending.reference) === ref) {
        const scope = scopeFromPending(pending);
        if (scope) indexReference(ref, scope);
        return pending;
      }
    }
    return null;
  } catch (error) {
    console.warn('Unable to find pending escrow by reference:', error);
    return null;
  }
}

export function isPendingEscrowCheckoutStale(pending: PendingEscrowCheckout | null | undefined): boolean {
  const createdAtMs = Number(pending?.createdAtMs || 0);
  if (!createdAtMs) return true;
  return Date.now() - createdAtMs > PENDING_ESCROW_STALE_MS;
}

/** Mark that the gateway reported success — never treat as disposable abandon. */
export async function markPendingEscrowCheckoutSubmitted(
  scope: PendingEscrowScope,
  reference?: string
): Promise<void> {
  try {
    const pending = await readPendingEscrowCheckout(scope);
    if (!pending) return;
    const ref = asNonEmpty(reference || pending.reference);
    if (ref && ref !== pending.reference) {
      unindexReference(pending.reference);
      pending.reference = ref;
    }
    pending.phase = 'submitted';
    await savePendingEscrowCheckout(pending);
  } catch (error) {
    console.warn('Unable to mark pending escrow as submitted:', error);
  }
}

/**
 * Clear only the scoped product checkout (or the slot that owns a reference).
 * Never wipes unrelated product payments.
 */
export async function clearPendingEscrowCheckout(
  target: PendingEscrowScope | { reference: string }
): Promise<void> {
  try {
    migrateLegacyGlobalSlot();

    if ('reference' in target && !('postId' in target)) {
      const pending = await findPendingEscrowCheckoutByReference(target.reference);
      if (!pending) {
        unindexReference(target.reference);
        return;
      }
      const scope = scopeFromPending(pending);
      if (!scope) return;
      appStorage.remove(slotKey(scope));
      unindexReference(pending.reference);
      return;
    }

    const scope = target as PendingEscrowScope;
    const postId = asNonEmpty(scope.postId);
    const buyerId = asNonEmpty(scope.buyerId);
    if (!postId || !buyerId) return;
    const existing = readSlot({ postId, buyerId });
    appStorage.remove(slotKey({ postId, buyerId }));
    if (existing?.reference) unindexReference(existing.reference);
  } catch (error) {
    console.warn('Unable to clear pending escrow checkout:', error);
  }
}
