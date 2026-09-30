import { useQuery } from '@tanstack/react-query';

import {
  listLivePromoCodes,
  quoteCheckoutCart,
  type CheckoutCartItem,
  type CheckoutQuote,
} from '@/lib/api/checkout';
import { queryKeys } from '@/lib/query/keys';

/**
 * A stable signature for a cart, so the quote is cached per cart rather than per
 * render. Two carts with the same items in a different order are the same price, so
 * the signature is sorted — otherwise a re-render that reorders lines would show a
 * spinner for an identical total.
 */
export function cartSignature(cartItems: CheckoutCartItem[]): string {
  return cartItems
    .map((item) => `${item.sellerId}:${item.id}:${item.quantity}:${item.price}`)
    .sort()
    .join('|');
}

/**
 * The buyer's breakdown for a cart.
 *
 * Only fetched once a code exists or the sheet is open, because the server prices it
 * and an extra round-trip on a screen the buyer may not reach is wasted. Previous data
 * is kept while a new code is checked, so the breakdown never blinks to empty when a
 * code is mistyped.
 */
export function useCheckoutQuote({
  cartItems,
  shippingPrice = 0,
  code,
  enabled = true,
}: {
  cartItems: CheckoutCartItem[];
  shippingPrice?: number;
  code: string | null;
  enabled?: boolean;
}) {
  const signature = cartSignature(cartItems);
  return useQuery({
    queryKey: queryKeys.checkout.quote(signature, code),
    enabled: enabled && cartItems.length > 0,
    // A quote is only valid for the cart and code it was made for, so it must not be
    // reused across a change of either.
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    queryFn: (): Promise<CheckoutQuote> =>
      quoteCheckoutCart({ cartItems, shippingPrice, code }),
    retry: false,
  });
}

/** The offers that are live this minute, for showing the buyer what is available. */
export function useLivePromoCodes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.checkout.livePromos(),
    enabled,
    // Short: an operator switching a campaign off must stop advertising it quickly,
    // and this is a cheap public read.
    staleTime: 20_000,
    queryFn: () => listLivePromoCodes(),
    retry: false,
  });
}
