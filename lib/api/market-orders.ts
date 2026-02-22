import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

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

export const marketOrdersApi = {
  async createFromPost(input: CreateMarketOrderInput): Promise<Order & { id: string }> {
    if (!input.post.id) {
      throw new Error('Post id is required to create order');
    }
    if (!input.post.posterId) {
      throw new Error('Seller id is missing on this post');
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
      paymentMethod: 'Escrow',
      escrowStatus: 'held',
      commissionRate: undefined,
      autoReleaseDate: undefined,
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

