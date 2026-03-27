import { useMemo } from 'react';

import { useMarketPost } from '@/lib/firebase/firestore/market-posts';
import { parseMarketOfferLink } from '@/lib/utils/market-offer-link';
import { MarketMessage } from '@/types';

const ASK_PRICE_PHRASES = [
  'ask for price',
  'best price',
  'share your best price',
  'your best price',
  'final price',
  'what is the price',
  'how much',
  'price?',
  'send offer',
];

type UseOfferLogicParams = {
  contextPostId: string | null;
  displayMessages: MarketMessage[];
  legacySellerId: string | null;
  userId: string | null;
};

type UseOfferLogicResult = {
  canSendOffer: boolean;
  sellerId: string | null;
  showInlineOfferCta: boolean;
};

export function useOfferLogic({
  contextPostId,
  displayMessages,
  legacySellerId,
  userId,
}: UseOfferLogicParams): UseOfferLogicResult {
  const { post: contextPost } = useMarketPost(contextPostId);

  const sellerId = useMemo(
    () => String(contextPost?.posterId || legacySellerId || '').trim() || null,
    [contextPost?.posterId, legacySellerId]
  );

  const canSendOffer = Boolean(userId && sellerId && userId === sellerId && contextPostId);

  const hasSellerOfferAlready = useMemo(() => {
    if (!userId) return false;
    return displayMessages.some((message) => {
      if (String(message.senderId || '') !== userId) return false;
      return Boolean(parseMarketOfferLink(message.paymentLink));
    });
  }, [displayMessages, userId]);

  const hasBuyerAskForPriceSignal = useMemo(() => {
    if (!userId) return false;

    return displayMessages.some((message) => {
      if (String(message.senderId || '') === userId) return false;
      const text = String((message as any).text || message.message || '').toLowerCase();
      return ASK_PRICE_PHRASES.some((phrase) => text.includes(phrase));
    });
  }, [displayMessages, userId]);

  return {
    canSendOffer,
    sellerId,
    showInlineOfferCta: canSendOffer && hasBuyerAskForPriceSignal && !hasSellerOfferAlready,
  };
}
