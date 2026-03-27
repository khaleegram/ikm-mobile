import { addDoc, collection, getDocs, limit, query, serverTimestamp, where } from 'firebase/firestore';

import { firestore } from '@/lib/firebase/config';
import { MarketPost, Order } from '@/types';

export interface CreateMarketOrderInput {
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  post: MarketPost;
  quantity: number;
  finalPrice: number;
  deliveryAddress: string;
  fromChatId?: string;
  paymentReference?: string;
  paystackReference?: string;
}

function buildMarketItemName(post: MarketPost): string {
  const description = post.description?.trim() || '';
  if (!description) return 'Market Street Item';
  return description.length > 70 ? `${description.slice(0, 67)}...` : description;
}

function marketPostProductId(postId: string): string {
  return `market_post_${postId}`;
}

function buildIdempotencyKey(data: CreateMarketOrderInput): string {
  const raw = `${data.buyerId}_${data.post.id}_${data.quantity}_${data.finalPrice}_${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9_]/g, '');
}

async function findExistingOrderByPaymentReference(
  reference: string
): Promise<(Order & { id: string }) | null> {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) return null;

  const ordersRef = collection(firestore, 'orders');
  const paystackSnap = await getDocs(
    query(ordersRef, where('paystackReference', '==', normalizedReference), limit(1))
  );
  if (!paystackSnap.empty) {
    const docSnap = paystackSnap.docs[0];
    return { ...(docSnap.data() as Order), id: docSnap.id };
  }

  const paymentSnap = await getDocs(
    query(ordersRef, where('paymentReference', '==', normalizedReference), limit(1))
  );
  if (!paymentSnap.empty) {
    const docSnap = paymentSnap.docs[0];
    return { ...(docSnap.data() as Order), id: docSnap.id };
  }

  return null;
}

export const marketOrdersApi = {
  async createFromPost(input: CreateMarketOrderInput): Promise<Order & { id: string }> {
    if (!input.post.id) {
      throw new Error('Post id is required to create order');
    }
    if (!input.post.posterId) {
      throw new Error('Seller id is missing on this post');
    }

    const reference = String(input.paystackReference || input.paymentReference || '').trim();
    if (reference) {
      const existing = await findExistingOrderByPaymentReference(reference).catch(() => null);
      if (existing?.id) {
        return existing;
      }
    }

    const now = new Date();
    const total = Math.max(0, Number(input.finalPrice) * Math.max(1, input.quantity));
    const sellerId = input.post.posterId;

    const payload: Record<string, any> = {
      customerId: input.buyerId,
      sellerId,
      idempotencyKey: buildIdempotencyKey(input),
      items: [
        {
          productId: marketPostProductId(input.post.id),
          name: buildMarketItemName(input.post),
          price: Number(input.finalPrice),
          quantity: Math.max(1, input.quantity),
        },
      ],
      total,
      shippingPrice: 0,
      shippingType: 'pickup',
      status: 'Processing',
      deliveryAddress: input.deliveryAddress.trim(),
      customerInfo: {
        name: input.buyerName.trim(),
        email: input.buyerEmail.trim(),
        phone: input.buyerPhone.trim(),
      },
      paymentMethod: 'Paystack Escrow',
      // Firestore does not allow `undefined` values.
      paymentReference: input.paymentReference ? String(input.paymentReference).trim() : null,
      paystackReference: (input.paystackReference || input.paymentReference)
        ? String(input.paystackReference || input.paymentReference).trim()
        : null,
      escrowStatus: 'held',
      commissionRate: null,
      autoReleaseDate: null,
      marketMeta: {
        postId: input.post.id,
        source: 'market_post',
        fromChatId: input.fromChatId || null,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      localCreatedAt: now.toISOString(),
    };

    const ref = await addDoc(collection(firestore, 'orders'), payload);

    return {
      ...(payload as Order),
      id: ref.id,
      createdAt: now,
      updatedAt: now,
    };
  },
};
