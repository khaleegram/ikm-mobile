export interface MarketOfferPayload {
  postId: string;
  sellerId: string;
  price: number;
  chatId?: string;
}

const OFFER_SCHEME = 'ikm-offer://deal';

export function buildMarketOfferLink(payload: MarketOfferPayload): string {
  const params = new URLSearchParams();
  params.set('postId', payload.postId);
  params.set('sellerId', payload.sellerId);
  params.set('price', String(payload.price));
  if (payload.chatId) params.set('chatId', payload.chatId);
  return `${OFFER_SCHEME}?${params.toString()}`;
}

export function parseMarketOfferLink(link?: string | null): MarketOfferPayload | null {
  if (!link || !link.startsWith(OFFER_SCHEME)) return null;

  try {
    const url = new URL(link);
    const postId = url.searchParams.get('postId') || '';
    const sellerId = url.searchParams.get('sellerId') || '';
    const rawPrice = Number(url.searchParams.get('price') || '');
    const chatId = url.searchParams.get('chatId') || undefined;

    if (!postId || !sellerId || !Number.isFinite(rawPrice) || rawPrice <= 0) {
      return null;
    }

    return {
      postId,
      sellerId,
      price: rawPrice,
      chatId,
    };
  } catch {
    return null;
  }
}

