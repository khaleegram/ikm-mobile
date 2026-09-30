import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import PaymentSheetModal from '@/components/market/payment-sheet-modal';
import {
  CheckoutBreakdown,
  LiveOfferChips,
  PromoCodeField,
} from '@/components/market/checkout-pricing';
import { showToast } from '@/components/toast';
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
import {
  displayNameFromProfile,
  useUsersBatch,
} from '@/lib/hooks/use-user-identity';
import {
  groupCartBySeller,
  useMarketCartStore,
} from '@/lib/stores/market-cart';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { isValidPhoneNumber } from '@/lib/utils/phone';
import { toNameCase } from '@/lib/utils/name-case';
import type { MarketPost } from '@/types';

const ACCENT = '#A67C52';

function formatAmount(value: number): string {
  return `NGN ${value.toLocaleString()}`;
}

export default function MarketCartScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { profile } = useMyMarketProfile(user?.uid || null);
  const lines = useMarketCartStore((s) => s.lines);
  const setQuantity = useMarketCartStore((s) => s.setQuantity);
  const remove = useMarketCartStore((s) => s.remove);
  const clear = useMarketCartStore((s) => s.clear);
  const totalAmount = useMarketCartStore((s) => s.totalAmount());
  const cartSessionId = useMarketCartStore((s) => s.cartSessionId);

  const groups = useMemo(() => groupCartBySeller(lines), [lines]);
  const sellerIds = useMemo(() => groups.map((g) => g.sellerId), [groups]);
  const { byId: sellersById } = useUsersBatch(sellerIds);

  const [phone, setPhone] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [footerHeight, setFooterHeight] = useState(120);

  useEffect(() => {
    if (!profile) return;
    if (!phone && profile.marketBuyerPhone) setPhone(String(profile.marketBuyerPhone));
    if (!locationLabel) {
      const label = formatBuyerLocationLabel(profile.marketBuyerLocation);
      if (label) setLocationLabel(label);
    }
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const deliveryAddress = locationLabel.trim();

  const syntheticPost = useMemo((): MarketPost | null => {
    if (!lines.length) return null;
    const first = lines[0];
    const sellerCount = groups.length;
    return {
      id: first.postId,
      posterId: first.sellerId,
      title:
        lines.length === 1
          ? first.title
          : sellerCount > 1
            ? `${lines.length} items from ${sellerCount} sellers`
            : `${lines.length} items`,
      price: first.unitPrice,
      images: first.coverUri ? [first.coverUri] : [],
      status: 'active',
    } as MarketPost;
  }, [lines, groups.length]);

  // The cart, shaped for the server. Every line is priced by the server, so the total
  // the buyer agrees to is the total the gateway takes — including any campaign.
  const cartItems: CheckoutCartItem[] = useMemo(
    () =>
      lines.map((line) => ({
        id: line.postId,
        sellerId: line.sellerId,
        name: line.title,
        price: line.unitPrice,
        quantity: line.quantity,
      })),
    [lines]
  );

  const quote = useCheckoutQuote({
    cartItems,
    code: appliedCode,
    enabled: Boolean(user) && cartItems.length > 0,
  });

  const quoteData = quote.data && quote.data.eligible ? quote.data : null;
  const payableNaira = quoteData ? quoteData.display.totalKobo / 100 : null;
  const promoError = useMemo(() => {
    if (!appliedCode) return null;
    if (quote.isFetching && !quote.data) return null;
    if (quote.data && !quote.data.eligible) {
      return quote.data.promo?.message || 'That code cannot be used on this cart';
    }
    if (quoteData && !quoteData.chargeable) {
      return quoteData.reason === 'BUDGET_EXHAUSTED'
        ? 'This offer has been fully claimed'
        : 'This offer is not available right now';
    }
    return quote.error ? 'Could not check that code. Try again.' : null;
  }, [appliedCode, quote.data, quote.isFetching, quote.error, quoteData]);

  const startCheckout = async () => {
    if (!lines.length) return;
    // Guests build a cart freely; paying is what requires an account. Handled here
    // rather than by hiding the cart, so they can see what they picked.
    if (!user) {
      haptics.light();
      router.push(getLoginRouteForVariant('market') as any);
      return;
    }
    if (!isValidPhoneNumber(phone)) {
      showToast('Enter a valid phone number.', 'error');
      return;
    }
    if (deliveryAddress.length < 5) {
      showToast('Add a delivery address.', 'error');
      return;
    }
    if (promoError) {
      showToast('Remove or fix the promo code first.', 'error');
      return;
    }
    // Charging is done from the server's total, so a cart with no price yet is held
    // back rather than guessed at.
    if (!payableNaira) {
      showToast('Still pricing your cart. Try again in a moment.', 'error');
      return;
    }
    try {
      await saveMarketBuyerProfile(user!.uid, {
        marketBuyerPhone: phone,
        marketBuyerLocation: toBuyerLocationPayload(deliveryAddress),
      });
    } catch {
      // non-blocking
    }
    haptics.medium();
    setSheetVisible(true);
  };

  const handlePaymentSuccess = (orderId: string, _dealThreadId?: string | null, orderIds?: string[]) => {
    const ids = orderIds?.length ? orderIds : orderId ? [orderId] : [];
    clear();
    setSheetVisible(false);
    if (ids.length <= 1 && ids[0]) {
      showToast('Order placed.', 'success');
      router.replace(`/(market)/orders/${ids[0]}` as any);
    } else {
      showToast(`${ids.length} orders placed — one per seller.`, 'success');
      router.replace('/(market)/orders' as any);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <IconSymbol name="chevron.left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Cart</Text>
        {lines.length > 0 ? (
          <TouchableOpacity onPress={() => clear()} hitSlop={12}>
            <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: 13 }}>Clear</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {lines.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="cart" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Your cart is empty</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
            Add priced items from any sellers. One payment creates a separate order per seller.
          </Text>
        </View>
      ) : (
        <>
          <KeyboardScreen
            keyboardVerticalOffset={insets.top}
            extraScrollHeight={28}
            contentContainerStyle={{ padding: 16, paddingBottom: footerHeight + 24, gap: 14 }}>
            {groups.length > 1 ? (
              <View style={[styles.splitBanner, { backgroundColor: `${ACCENT}14`, borderColor: `${ACCENT}33` }]}>
                <IconSymbol name="info.circle" size={16} color={ACCENT} />
                <Text style={[styles.splitBannerText, { color: colors.text }]}>
                  {groups.length} sellers in cart — one payment, {groups.length} separate orders.
                </Text>
              </View>
            ) : null}

            {groups.map((group) => {
              const sellerName = toNameCase(                displayNameFromProfile(sellersById[group.sellerId] ?? null, 'Seller')
              );
              return (
                <View key={group.sellerId} style={{ gap: 8 }}>
                  <View style={styles.sellerHeader}>
                    <Text style={[styles.sellerName, { color: colors.text }]} numberOfLines={1}>
                      {sellerName}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: 12 }}>
                      {formatAmount(group.amount)}
                    </Text>
                  </View>
                  {group.lines.map((line) => (
                    <View
                      key={line.postId}
                      style={[styles.lineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      {line.coverUri ? (
                        <Image source={{ uri: line.coverUri }} style={styles.thumb} contentFit="cover" />
                      ) : (
                        <View style={[styles.thumb, { backgroundColor: `${ACCENT}22` }]} />
                      )}
                      <View style={{ flex: 1, gap: 6 }}>
                        <Text style={[styles.lineTitle, { color: colors.text }]} numberOfLines={2}>
                          {line.title}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>
                          {formatAmount(line.unitPrice)}
                        </Text>
                        <View style={styles.qtyRow}>
                          <TouchableOpacity
                            style={[styles.qtyBtn, { borderColor: colors.border }]}
                            onPress={() => setQuantity(line.postId, line.quantity - 1)}>
                            <Text style={{ color: colors.text, fontWeight: '800' }}>−</Text>
                          </TouchableOpacity>
                          <Text
                            style={{
                              color: colors.text,
                              fontWeight: '800',
                              minWidth: 20,
                              textAlign: 'center',
                            }}>
                            {line.quantity}
                          </Text>
                          <TouchableOpacity
                            style={[styles.qtyBtn, { borderColor: colors.border }]}
                            onPress={() => setQuantity(line.postId, line.quantity + 1)}>
                            <Text style={{ color: colors.text, fontWeight: '800' }}>+</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => remove(line.postId)} hitSlop={10}>
                            <IconSymbol name="trash" size={16} color={colors.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              );
            })}

            <View
              style={[
                styles.lineCard,
                { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'column' },
              ]}>
              <Text style={[styles.sectionLabel, { color: colors.text }]}>Delivery</Text>
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
              <TextInput
                value={locationLabel}
                onChangeText={setLocationLabel}
                placeholder="Area, city, state"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
            </View>

            <View style={[styles.lineCard, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'column' }]}>
              <Text style={[styles.sectionLabel, { color: colors.text }]}>Promo code</Text>
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
                message={quoteData?.promo?.message || null}
              />
              {!appliedCode && (
                <View style={{ marginTop: 10 }}>
                  <LiveOfferChips
                    onPick={(code) => {
                      haptics.light();
                      setAppliedCode(code);
                    }}
                  />
                </View>
              )}
            </View>

            {quoteData ? (
              <CheckoutBreakdown display={quoteData.display} quote={quote.data ?? null} itemCount={cartItems.length} />
            ) : null}
          </KeyboardScreen>

          <View
            style={[
              styles.footer,
              {
                paddingBottom: insets.bottom + 12,
                borderTopColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>
            <View>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                {groups.length > 1
                  ? `One payment · ${groups.length} seller orders`
                  : 'One payment'}
              </Text>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>
                {formatAmount(payableNaira ?? totalAmount)}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { backgroundColor: ACCENT, opacity: user && (!payableNaira || promoError) ? 0.5 : 1 },
              ]}
              onPress={() => void startCheckout()}>
              <Text style={styles.primaryBtnText}>{user ? 'Checkout' : 'Sign in to checkout'}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {syntheticPost && user ? (
        <PaymentSheetModal
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          post={syntheticPost}
          unitPrice={lines[0]?.unitPrice || 0}
          quantity={1}
          // The server's total for the whole cart, and the cart itself so the charge
          // is priced and re-priced server-side.
          pricedTotalNaira={payableNaira ?? undefined}
          cartItems={cartItems}
          promoCode={appliedCode}
          deliveryAddress={deliveryAddress}
          deliveryState=""
          deliveryCity=""
          addressLine={deliveryAddress}
          buyerPhone={phone}
          buyerEmail={user.email || ''}
          buyerName={String(user.displayName || 'Buyer')}
          buyerId={user.uid}
          cartLines={lines}
          cartSessionId={cartSessionId}
          onSuccess={handlePaymentSuccess}
        />
      ) : null}
    </View>
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  splitBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  splitBannerText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  sellerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 4,
  },
  sellerName: { fontSize: 15, fontWeight: '800', flex: 1, marginRight: 8 },
  lineCard: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  lineTitle: { fontSize: 14, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 8,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 18 },
  primaryBtnText: { color: '#FFF', fontWeight: '800' },
});
