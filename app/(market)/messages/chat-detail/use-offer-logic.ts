import { useMemo } from 'react';

import { useMarketPost } from '@/lib/firebase/firestore/market-posts';
import { parseMarketOfferLink } from '@/lib/utils/market-offer-link';
import { MarketMessage } from '@/types';

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
      const text = String(message.message || '').toLowerCase();
      const hasAskPhrase =
        text.includes('ask for price') ||
        text.includes('best price') ||
        text.includes('share your best price') ||
        text.includes('price');
      return Boolean(message.quoteCard) || hasAskPhrase;
    });
  }, [displayMessages, userId]);

  return {
    canSendOffer,
    sellerId,
    showInlineOfferCta: canSendOffer && hasBuyerAskForPriceSignal && !hasSellerOfferAlready,
  };
}
