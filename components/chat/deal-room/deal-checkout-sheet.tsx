import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import PaymentSheetModal from '@/components/market/payment-sheet-modal';
import {
  CheckoutBreakdown,
  LiveOfferChips,
  PromoCodeField,
} from '@/components/market/checkout-pricing';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SmartPhoneField } from '@/components/ui/smart-phone-field';
import {
  formatBuyerLocationLabel,
  saveMarketBuyerProfile,
  toBuyerLocationPayload,
} from '@/lib/api/market-buyer-profile';
import type { CheckoutCartItem } from '@/lib/api/checkout';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useCheckoutQuote } from '@/lib/hooks/use-checkout-quote';
import { useMyMarketProfile } from '@/lib/hooks/use-my-market-profile';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { isValidPhoneNumber, normalizePhoneInput } from '@/lib/utils/phone';
import { showToast } from '@/components/toast';
import type { MarketPost } from '@/types';

const ACCENT = '#A67C52';

type DealCheckoutSheetProps = {
  visible: boolean;
  onClose: () => void;
  post: MarketPost | null;
  unitPrice: number;
  threadId: string | null;
  onPaid: (orderId: string, dealThreadId?: string | null) => void;
};

export function DealCheckoutSheet({
  visible,
  onClose,
  post,
  unitPrice,
  threadId,
  onPaid,
}: DealCheckoutSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { profile } = useMyMarketProfile(user?.uid || null);
  const [phone, setPhone] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const savedPhone = String(profile?.marketBuyerPhone || '').trim();
    const savedLoc = formatBuyerLocationLabel(profile?.marketBuyerLocation);
    if (savedPhone) setPhone((prev) => prev || savedPhone);
    if (savedLoc) setLocationLabel((prev) => prev || savedLoc);
  }, [visible, profile]);

  const buyerPhone = useMemo(() => {
    const normalized = normalizePhoneInput(phone);
    return isValidPhoneNumber(normalized) ? normalized : '';
  }, [phone]);

  const deliveryAddress = locationLabel.trim();
  const price = Math.max(0, Number(unitPrice) || 0);

  // The cart this deal is. Sent to the server, which prices it — the sheet does not
  // add up a total of its own, because a total the phone computes is a total the phone
  // can get wrong.
  const cartItems: CheckoutCartItem[] = useMemo(() => {
    if (!post?.id || !(price > 0)) return [];
    return [
      {
        id: String(post.id),
        sellerId: String(post.posterId || ''),
        name: String(post.title || post.description || 'Item').slice(0, 80),
        price,
        quantity: 1,
      },
    ];
  }, [post?.id, post?.posterId, post?.title, post?.description, price]);

  const quote = useCheckoutQuote({
    cartItems,
    code: appliedCode,
    enabled: visible && cartItems.length > 0,
  });

  const quoteData = quote.data && quote.data.eligible ? quote.data : null;
  // The charge comes from the server's total, and only from there. With no quote yet
  // the sheet will not let the buyer continue rather than guess a number.
  const payableNaira = quoteData ? quoteData.display.totalKobo / 100 : null;
  // A code that came back valid but unfundable is cleared, so the buyer is not left
  // believing a discount was applied.
  const promoError = useMemo(() => {
    if (!appliedCode) return null;
    if (quote.isFetching && !quote.data) return null;
    if (quote.data && !quote.data.eligible) {
      return quote.data.promo?.message || 'That code cannot be used on this order';
    }
    if (quoteData && !quoteData.chargeable) {
      return quoteData.reason === 'BUDGET_EXHAUSTED'
        ? 'This offer has been fully claimed'
        : 'This offer is not available right now';
    }
    return quote.error ? 'Could not check that code. Try again.' : null;
  }, [appliedCode, quote.data, quote.isFetching, quote.error, quoteData]);

  const promoMessage = quoteData?.promo?.message || null;

  const startPay = async () => {
    if (!user?.uid || !post?.id) return;
    if (!(price > 0)) {
      showToast('This offer has no price.', 'error');
      return;
    }
    if (!deliveryAddress) {
      showToast('Add a delivery location.', 'error');
      return;
    }
    if (promoError) {
      showToast('Remove or fix the promo code first.', 'error');
      return;
    }
    if (!payableNaira) {
      showToast('Still pricing your order. Try again in a moment.', 'error');
      return;
    }
    try {
      await saveMarketBuyerProfile(user.uid, {
        marketBuyerPhone: buyerPhone || null,
        marketBuyerLocation: toBuyerLocationPayload(deliveryAddress),
      });
    } catch {
      // Checkout can still proceed with the fields on this sheet.
    }
    haptics.medium();
    setPayOpen(true);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={12}>
            <IconSymbol name="xmark" size={18} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Pay securely</Text>
          <View style={styles.headerBtn} />
        </View>

        <KeyboardScreen contentContainerStyle={{ padding: 16, paddingBottom: 32 }} extraScrollHeight={48}>
          {quoteData ? (
            <CheckoutBreakdown display={quoteData.display} quote={quote.data ?? null} itemCount={1} />
          ) : (
            <Text style={[styles.price, { color: colors.text }]}>
              {`NGN ${price.toLocaleString()}`}
            </Text>
          )}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Money is held until you confirm you received the item. The seller is not paid at checkout.
          </Text>

          <Text style={[styles.label, { color: colors.text }]}>Promo code</Text>
          <PromoCodeField
            appliedCode={appliedCode}
            onApply={(code) => {
              haptics.light();
              setAppliedCode(code);
            }}
            onClear={() => {
              haptics.light();
              setAppliedCode(null);
            }}
            isChecking={quote.isFetching && Boolean(appliedCode)}
            error={appliedCode ? promoError : null}
            message={promoMessage}
          />
          {!appliedCode && (
            <View style={styles.chipsWrap}>
              <LiveOfferChips
                onPick={(code) => {
                  haptics.light();
                  setAppliedCode(code);
                }}
              />
            </View>
          )}

          <Text style={[styles.label, { color: colors.text }]}>Phone</Text>
          <SmartPhoneField
            value={phone}
            onChange={setPhone}
            colors={{
              text: colors.text,
              textSecondary: colors.textSecondary,
              border: colors.border,
              background: colors.background,
              backgroundSecondary: colors.backgroundSecondary,
              card: colors.card,
            }}
            accentColor={ACCENT}
            borderColor={colors.border}
            placeholder="801 234 5678"
          />

          <Text style={[styles.label, { color: colors.text }]}>Delivery</Text>
          <TextInput
            value={locationLabel}
            onChangeText={setLocationLabel}
            placeholder="Area, city, state"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />

          <TouchableOpacity
            style={[
              styles.cta,
              { backgroundColor: ACCENT, opacity: !payableNaira || promoError ? 0.5 : 1 },
            ]}
            disabled={!payableNaira || Boolean(promoError)}
            onPress={() => void startPay()}>
            <Text style={styles.ctaText}>
              {payableNaira
                ? `Continue to payment · ₦${(payableNaira).toLocaleString()}`
                : 'Continue to payment'}
            </Text>
          </TouchableOpacity>
        </KeyboardScreen>

        {user && post ? (
          <PaymentSheetModal
            visible={payOpen}
            onClose={() => setPayOpen(false)}
            post={post}
            unitPrice={price}
            quantity={1}
            // The server's price for this cart, not a figure this screen derived.
            pricedTotalNaira={payableNaira ?? undefined}
            cartItems={cartItems}
            promoCode={appliedCode}
            deliveryAddress={deliveryAddress}
            deliveryState=""
            deliveryCity=""
            addressLine={deliveryAddress}
            buyerPhone={buyerPhone || 'Not provided'}
            buyerEmail={user.email || ''}
            buyerName={String(profile?.displayName || user.displayName || 'Buyer')}
            buyerId={user.uid}
            fromChatId={threadId}
            onSuccess={(orderId, dealThreadId) => {
              setPayOpen(false);
              onPaid(orderId, dealThreadId);
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  price: { fontSize: 28, fontWeight: '800', marginBottom: 8 },
  hint: { fontSize: 13, fontWeight: '600', lineHeight: 18, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '800', marginBottom: 8, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 8,
    fontWeight: '600',
  },
  cta: { marginTop: 16, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  chipsWrap: { marginTop: 10 },
});
