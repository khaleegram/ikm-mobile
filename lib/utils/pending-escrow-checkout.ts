import AsyncStorage from '@react-native-async-storage/async-storage';

export const PENDING_ESCROW_CHECKOUT_KEY = '@ikm_market_pending_escrow_checkout_v1';

// Keep pending checkout metadata so the Paystack callback route can finalize the order even
// if the app is opened via deep link (or the buy screen got interrupted).
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
};

const PENDING_ESCROW_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function savePendingEscrowCheckout(pending: PendingEscrowCheckout): Promise<void> {
  const reference = String(pending?.reference || '').trim();
  if (!reference) return;
  try {
    await AsyncStorage.setItem(PENDING_ESCROW_CHECKOUT_KEY, JSON.stringify(pending));
  } catch (error) {
    console.warn('Unable to persist pending escrow checkout:', error);
  }
}

export async function readPendingEscrowCheckout(): Promise<PendingEscrowCheckout | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_ESCROW_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingEscrowCheckout;
    const createdAtMs = Number(parsed?.createdAtMs || 0);
    if (!createdAtMs || Date.now() - createdAtMs > PENDING_ESCROW_TTL_MS) {
      await AsyncStorage.removeItem(PENDING_ESCROW_CHECKOUT_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Unable to read pending escrow checkout:', error);
    return null;
  }
}

export async function clearPendingEscrowCheckout(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_ESCROW_CHECKOUT_KEY);
  } catch (error) {
    console.warn('Unable to clear pending escrow checkout:', error);
  }
}

