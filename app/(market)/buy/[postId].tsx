import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import { PaystackCheckout } from '@/components/market/paystack-checkout';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { NIGERIA_LOCATION_OPTIONS } from '@/lib/constants/nigeria-locations';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPost } from '@/lib/firebase/firestore/market-posts';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { getMarketBranding } from '@/lib/market-branding';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import {
  savePendingEscrowCheckout,
} from '@/lib/utils/pending-escrow-checkout';

const lightBrown = '#A67C52';
const NIGERIA_STATES = [...new Set(NIGERIA_LOCATION_OPTIONS.map((item) => item.state))].sort((a, b) =>
  a.localeCompare(b)
);

function formatAmount(value: number): string {
  return `NGN ${value.toLocaleString()}`;
}

function buildDefaultReference(): string {
  return `ikm_escrow_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveDisplayName(profile: any, fallback: string): string {
  const first = String(profile?.firstName || '').trim();
  const last = String(profile?.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const display = String(profile?.displayName || '').trim();
  if (display) return display;
  const store = String(profile?.storeName || '').trim();
  if (store) return store;
  return fallback;
}

function extractPaymentReference(url: string): string {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return '';

  try {
    const parsed = Linking.parse(normalizedUrl);
    const reference =
      String(parsed.queryParams?.reference || '').trim() ||
      String(parsed.queryParams?.trxref || '').trim() ||
      String(parsed.queryParams?.ref || '').trim();
    if (reference) return reference;
  } catch {
    // Fallback to raw parsing below.
  }

  const match = normalizedUrl.match(/[?&](reference|trxref|ref)=([^&#]+)/i);
  if (!match?.[2]) return '';
  try {
    return decodeURIComponent(match[2]).trim();
  } catch {
    return String(match[2]).trim();
  }
}

function CheckoutSkeleton({ colors }: { colors: any }) {
  const SKELETON_COLOR = colors.border;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ height: 60, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 16, paddingTop: 10, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: SKELETON_COLOR, opacity: 0.5 }} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ width: 120, height: 16, backgroundColor: SKELETON_COLOR, opacity: 0.4, borderRadius: 4, marginBottom: 4 }} />
          <View style={{ width: 140, height: 12, backgroundColor: SKELETON_COLOR, opacity: 0.2, borderRadius: 4 }} />
        </View>
        <View style={{ width: 40, height: 20, borderRadius: 10, backgroundColor: SKELETON_COLOR, opacity: 0.5 }} />
      </View>
      <View style={{ padding: 16, gap: 16 }}>
        <View style={{ height: 200, borderRadius: 16, backgroundColor: SKELETON_COLOR, opacity: 0.4 }} />
        <View style={{ height: 150, borderRadius: 16, backgroundColor: SKELETON_COLOR, opacity: 0.3 }} />
        <View style={{ height: 300, borderRadius: 16, backgroundColor: SKELETON_COLOR, opacity: 0.3 }} />
      </View>
    </View>
  );
}

export default function MarketBuyScreen() {
  const marketBrand = getMarketBranding();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { user: profile } = useUserProfile(user?.uid || null);

  const params = useLocalSearchParams<{
    postId?: string;
    offerPrice?: string;
    chatId?: string;
    sellerId?: string;
  }>();
  const postId = Array.isArray(params.postId) ? params.postId[0] : params.postId;
  const chatId = Array.isArray(params.chatId) ? params.chatId[0] : params.chatId;
  const offerSellerId = Array.isArray(params.sellerId) ? params.sellerId[0] : params.sellerId;
  const offeredPrice = Number(
    Array.isArray(params.offerPrice) ? params.offerPrice[0] : params.offerPrice || ''
  );

  const { post, loading: postLoading } = useMarketPost(postId || null);
  const { user: sellerProfile } = useUserProfile(post?.posterId || null);
  const [submitting, setSubmitting] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [addressLine, setAddressLine] = useState('');
  const [deliveryState, setDeliveryState] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');
  const [paymentReference, setPaymentReference] = useState(() => buildDefaultReference());
  const [paystackVisible, setPaystackVisible] = useState(false);

  const PAYSTACK_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
  const savedBuyerPhone = useMemo(
    () =>
      String((profile as any)?.marketBuyerPhone || profile?.phone || '')
        .trim(),
    [profile]
  );
  const savedBuyerLocation = useMemo(() => {
    const raw = (profile as any)?.marketBuyerLocation || {};
    return {
      state: String(raw.state || '').trim(),
      city: String(raw.city || '').trim(),
      address: String(raw.address || '').trim(),
    };
  }, [profile]);
  const buyerPhone = useMemo(() => String(savedBuyerPhone || '').trim(), [savedBuyerPhone]);

  React.useEffect(() => {
    if (!savedBuyerLocation.state && !savedBuyerLocation.city && !savedBuyerLocation.address) return;
    setDeliveryState((prev) => prev || savedBuyerLocation.state);
    setDeliveryCity((prev) => prev || savedBuyerLocation.city);
    setAddressLine((prev) => prev || savedBuyerLocation.address);
  }, [savedBuyerLocation]);

  const lockedPrice = useMemo(() => {
    const hasValidOffer = Number.isFinite(offeredPrice) && offeredPrice > 0;
    const offerMatchesSeller =
      !offerSellerId || (post?.posterId ? post.posterId === offerSellerId : true);
    if (hasValidOffer && offerMatchesSeller) return offeredPrice;
    if (post?.price && post.price > 0) return post.price;
    return 0;
  }, [offerSellerId, offeredPrice, post?.posterId, post?.price]);

  const hasLockedPrice = lockedPrice > 0;
  const numericQuantity = Math.max(1, Number(quantity) || 1);
  const total = hasLockedPrice ? lockedPrice * numericQuantity : 0;
  const selectedStateLabel = deliveryState || 'Select delivery state';
  const selectedCityLabel = deliveryCity || 'Select delivery city';
  const trimmedAddressLine = addressLine.trim();
  const builtDeliveryAddress = [trimmedAddressLine, deliveryCity, deliveryState].filter(Boolean).join(', ');

  const ALL_LOCATIONS = useMemo(() => {
    const list: Array<{ city: string; state: string; label: string }> = [];
    NIGERIA_LOCATION_OPTIONS.forEach(opt => {
      list.push({ city: opt.city, state: opt.state, label: `${opt.city}, ${opt.state}` });
    });
    const unique = new Map<string, typeof list[0]>();
    list.forEach(i => unique.set(i.label, i));
    return [...unique.values()].sort((a,b) => a.label.localeCompare(b.label));
  }, []);

  const filteredLocations = useMemo(() => {
    const queryValue = locationSearch.trim().toLowerCase();
    if (!queryValue) return ALL_LOCATIONS;
    return ALL_LOCATIONS.filter((loc) => loc.label.toLowerCase().includes(queryValue));
  }, [ALL_LOCATIONS, locationSearch]);

  const canSubmit =
    !!user &&
    !!post &&
    !submitting &&
    hasLockedPrice &&
    numericQuantity > 0 &&
    trimmedAddressLine.length >= 5 &&
    !!deliveryState &&
    !!deliveryCity &&
    buyerPhone.length >= 10;

  const missingChecks: string[] = [];
  if (!hasLockedPrice) missingChecks.push('seller final price');
  if (!buyerPhone) missingChecks.push('phone');
  if (!deliveryState) missingChecks.push('state');
  if (!deliveryCity) missingChecks.push('city');
  if (trimmedAddressLine.length < 5) missingChecks.push('address');
  if (numericQuantity <= 0) missingChecks.push('quantity');
  const requirementsHint = missingChecks.length
    ? `Complete: ${missingChecks.join(', ')}`
    : 'Ready to place escrow order';
  const footerHeight = insets.bottom + 86;
  const sellerName = useMemo(() => {
    const fallback = post?.posterId ? `Seller ${post.posterId.slice(0, 8)}` : 'Market Seller';
    return resolveDisplayName(sellerProfile, fallback);
  }, [post?.posterId, sellerProfile]);
  const hasValidOffer = Number.isFinite(offeredPrice) && offeredPrice > 0;
  const priceSourceLabel = hasValidOffer ? 'Seller offer accepted' : 'Post listed price';
  const subtotal = hasLockedPrice ? lockedPrice * numericQuantity : 0;

  const handleOpenDeliverySettings = () => {
    haptics.light();
    router.push('/(market)/delivery-settings' as any);
  };

  const handleSubmit = async () => {
    if (!user) {
      router.push(getLoginRouteForVariant('market') as any);
      return;
    }
    if (!post) return;
    if (!hasLockedPrice) {
      showToast('Seller must set a final price before escrow payment.', 'error');
      return;
    }
    if (!buyerPhone) {
      showToast('Verify your phone to continue.', 'error');
      haptics.light();
      router.push('/complete-phone' as any);
      return;
    }
    if (!deliveryState) {
      showToast('Select delivery state.', 'error');
      return;
    }
    if (!deliveryCity) {
      showToast('Select delivery city.', 'error');
      return;
    }
    if (trimmedAddressLine.length < 5) {
      showToast('Enter a valid delivery address.', 'error');
      return;
    }
    if (numericQuantity <= 0) {
      showToast('Quantity must be at least 1.', 'error');
      return;
    }

    if (post.posterId === user.uid) {
      showToast('You cannot buy your own post.', 'error');
      return;
    }

    const buyerEmail = String(user.email || '').trim();
    if (!buyerEmail) {
      showToast('A valid account email is required for payment.', 'error');
      return;
    }

    try {
      setSubmitting(true);
      haptics.medium();

      const paymentReference = buildDefaultReference();

      // Save pending checkout so the callback screen can finalize the order
      await savePendingEscrowCheckout({
        reference: paymentReference,
        amount: total,
        buyerId: user.uid,
        buyerName: profile?.displayName || user.displayName || user.email || 'Market Buyer',
        buyerEmail,
        buyerPhone,
        post,
        quantity: numericQuantity,
        finalPrice: lockedPrice,
        deliveryAddress: builtDeliveryAddress,
        fromChatId: chatId || null,
        deliveryState,
        deliveryCity,
        addressLine: trimmedAddressLine,
        createdAtMs: Date.now(),
      });

      // Launch custom Paystack checkout
      setPaystackVisible(true);
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to process payment right now.', 'error');
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sign in to continue</Text>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: lightBrown }]}
          onPress={() => router.push(getLoginRouteForVariant('market') as any)}>
          <Text style={styles.primaryButtonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (postLoading || !post) {
    return <CheckoutSkeleton colors={colors} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 10,
            borderBottomColor: colors.border,
          },
        ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
          <IconSymbol name="arrow.left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Secure Checkout</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Escrow protected payment</Text>
        </View>
        <View style={[styles.headerTag, { backgroundColor: `${lightBrown}20` }]}>
          <IconSymbol name="lock.fill" size={13} color={lightBrown} />
          <Text style={[styles.headerTagText, { color: lightBrown }]}>Safe</Text>
        </View>
      </View>

      <KeyboardScreen
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={28}
        contentContainerStyle={[styles.content, { paddingBottom: footerHeight + 20 }]}>
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.heroTopRow}>
            <View style={[styles.heroTrustPill, { backgroundColor: `${lightBrown}16` }]}>
              <IconSymbol name="lock.fill" size={13} color={lightBrown} />
              <Text style={[styles.heroTrustText, { color: lightBrown }]}>Escrow Protection</Text>
            </View>
            <View style={[styles.heroSourcePill, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.heroSourceText, { color: colors.textSecondary }]}>{priceSourceLabel}</Text>
            </View>
          </View>

          <Image source={{ uri: post.images?.[0] || '' }} style={styles.image} contentFit="cover" />

          <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>
            {post.description?.trim() || marketBrand.genericItemLower}
          </Text>
          <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>Seller: {sellerName}</Text>
          <Text style={[styles.heroAmount, { color: colors.text }]}>
            {Number.isFinite(total) && total > 0 ? formatAmount(total) : 'NGN 0'}
          </Text>
          <Text style={[styles.heroAmountHint, { color: colors.textSecondary }]}>
            You pay now, seller gets paid after you confirm receipt.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Breakdown</Text>
          <View
            style={[
              styles.summaryLine,
              {
                borderBottomColor: colors.border,
              },
            ]}>
            <Text style={[styles.summaryLineLabel, { color: colors.textSecondary }]}>Final unit price</Text>
            <Text style={[styles.summaryLineValue, { color: hasLockedPrice ? colors.text : colors.textSecondary }]}>
              {hasLockedPrice ? formatAmount(lockedPrice) : 'Waiting for seller final offer'}
            </Text>
          </View>
          <View style={[styles.summaryLine, { borderBottomColor: colors.border }]}>
            <Text style={[styles.summaryLineLabel, { color: colors.textSecondary }]}>Quantity</Text>
            <Text style={[styles.summaryLineValue, { color: colors.text }]}>{numericQuantity}</Text>
          </View>
          <View style={[styles.summaryLine, { borderBottomColor: colors.border }]}>
            <Text style={[styles.summaryLineLabel, { color: colors.textSecondary }]}>Subtotal</Text>
            <Text style={[styles.summaryLineValue, { color: colors.text }]}>
              {Number.isFinite(subtotal) && subtotal > 0 ? formatAmount(subtotal) : 'NGN 0'}
            </Text>
          </View>
          <View style={styles.summaryLine}>
            <Text style={[styles.summaryLineLabel, { color: colors.textSecondary }]}>Escrow fee</Text>
            <Text style={[styles.summaryLineValue, { color: '#10B981' }]}>Included</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Delivery Details</Text>

          <Text style={[styles.label, { color: colors.text }]}>Quantity</Text>
          <View
            style={[
              styles.quantityRow,
              {
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}>
            <TouchableOpacity
              style={styles.quantityAction}
              onPress={() => {
                const next = Math.max(1, numericQuantity - 1);
                setQuantity(String(next));
              }}>
              <IconSymbol name="minus" size={18} color={colors.text} />
            </TouchableOpacity>
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
              placeholder="1"
              placeholderTextColor={colors.textSecondary}
              style={[styles.quantityInput, { color: colors.text }]}
            />
            <TouchableOpacity
              style={styles.quantityAction}
              onPress={() => {
                const next = numericQuantity + 1;
                setQuantity(String(next));
              }}>
              <IconSymbol name="plus" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, styles.spacingTop, { color: colors.text }]}>Phone Number</Text>
          {buyerPhone ? (
            <View
              style={[
                styles.readonlyField,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}>
              <Text style={[styles.readonlyValue, { color: colors.text }]}>{buyerPhone}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.verifyPhoneAction,
                {
                  borderColor: lightBrown,
                  backgroundColor: `${lightBrown}0A`,
                },
              ]}
              onPress={() => {
                haptics.light();
                router.push('/complete-phone' as any);
              }}>
              <IconSymbol name="plus.circle.fill" size={18} color={lightBrown} />
              <Text style={[styles.verifyPhoneText, { color: lightBrown }]}>Add & Verify Phone</Text>
            </TouchableOpacity>
          )}

          <Text style={[styles.label, styles.spacingTop, { color: colors.text }]}>Delivery Location</Text>
          <TouchableOpacity
            style={[
              styles.locationPicker,
              {
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            onPress={() => setLocationPickerVisible(true)}>
            <IconSymbol name="location.fill" size={16} color={lightBrown} />
            <Text
              style={[
                styles.locationPickerText,
                { color: deliveryCity ? colors.text : colors.textSecondary },
              ]}>
              {deliveryCity && deliveryState ? `${deliveryCity}, ${deliveryState}` : 'Search city or area'}
            </Text>
            <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} />
          </TouchableOpacity>

          <Text style={[styles.label, styles.spacingTop, { color: colors.text }]}>Delivery Address</Text>
          <TextInput
            value={addressLine}
            onChangeText={setAddressLine}
            placeholder="House, street, area, nearest landmark"
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[
              styles.input,
              styles.multiline,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>How Escrow Works</Text>
          <View style={styles.escrowStepRow}>
            <View style={[styles.escrowStepDot, { backgroundColor: `${lightBrown}20` }]}>
              <Text style={[styles.escrowStepDotText, { color: lightBrown }]}>1</Text>
            </View>
            <Text style={[styles.escrowStepText, { color: colors.textSecondary }]}>
              You pay securely into escrow.
            </Text>
          </View>
          <View style={styles.escrowStepRow}>
            <View style={[styles.escrowStepDot, { backgroundColor: `${lightBrown}20` }]}>
              <Text style={[styles.escrowStepDotText, { color: lightBrown }]}>2</Text>
            </View>
            <Text style={[styles.escrowStepText, { color: colors.textSecondary }]}>
              Seller ships and marks order as sent.
            </Text>
          </View>
          <View style={styles.escrowStepRow}>
            <View style={[styles.escrowStepDot, { backgroundColor: `${lightBrown}20` }]}>
              <Text style={[styles.escrowStepDotText, { color: lightBrown }]}>3</Text>
            </View>
            <Text style={[styles.escrowStepText, { color: colors.textSecondary }]}>
              You confirm receipt, then seller is paid.
            </Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Order total</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              {Number.isFinite(total) && total > 0 ? formatAmount(total) : 'NGN 0'}
            </Text>
          </View>
        </View>

        <Text
          style={[
            styles.requirementHint,
            {
              color: canSubmit ? '#10B981' : colors.textSecondary,
            },
          ]}>
          {requirementsHint}
        </Text>

        <TouchableOpacity
          style={styles.cancelAction}
          onPress={() => {
            Alert.alert('Cancel order setup?', 'You can always come back and complete this later.', [
              { text: 'Keep editing', style: 'cancel' },
              { text: 'Cancel setup', style: 'destructive', onPress: () => router.back() },
            ]);
          }}>
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
      </KeyboardScreen>

      <View
        style={[
          styles.payFooter,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 10,
          },
        ]}>
        <View style={styles.payFooterRow}>
          <View>
            <Text style={[styles.payFooterLabel, { color: colors.textSecondary }]}>Total payable</Text>
            <Text style={[styles.payFooterValue, { color: colors.text }]}>
              {Number.isFinite(total) && total > 0 ? formatAmount(total) : 'NGN 0'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.payButton,
              {
                backgroundColor: canSubmit ? lightBrown : colors.backgroundSecondary,
                opacity: submitting ? 0.7 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={submitting}>
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.payButtonText}>Pay to Escrow</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={locationPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationPickerVisible(false)}>
        <Pressable style={styles.stateModalBackdrop} onPress={() => setLocationPickerVisible(false)}>
          <Pressable
            style={[
              styles.stateModalSheet,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
            onPress={(event) => event.stopPropagation()}>
            <View style={styles.stateModalHeader}>
              <Text style={[styles.stateModalTitle, { color: colors.text }]}>Select Location</Text>
              <TouchableOpacity onPress={() => setLocationPickerVisible(false)}>
                <IconSymbol name="xmark" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.stateSearchWrap,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}>
              <IconSymbol name="magnifyingglass" size={15} color={colors.textSecondary} />
              <TextInput
                value={locationSearch}
                onChangeText={setLocationSearch}
                placeholder="Search your city or area..."
                placeholderTextColor={colors.textSecondary}
                style={[styles.stateSearchInput, { color: colors.text }]}
                autoCapitalize="words"
              />
            </View>

            <FlatList
              data={filteredLocations}
              keyExtractor={(item) => item.label}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
              contentContainerStyle={styles.stateListContent}
              ListEmptyComponent={
                <View style={styles.emptyCityWrap}>
                  <Text style={[styles.emptyCityText, { color: colors.textSecondary }]}>
                    No location matches this search.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.stateRowItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    haptics.light();
                    setDeliveryState(item.state);
                    setDeliveryCity(item.city);
                    setLocationSearch('');
                    setLocationPickerVisible(false);
                  }}>
                  <Text style={[styles.stateRowText, { color: colors.text }]}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <PaystackCheckout
        visible={paystackVisible}
        paystackKey={PAYSTACK_KEY}
        amount={total}
        billingEmail={user.email || ''}
        billingName={profile?.displayName || user?.displayName || user?.email || 'Buyer'}
        refNumber={paymentReference}
        onCancel={() => {
          setPaystackVisible(false);
          showToast('Payment not completed.', 'info');
          setSubmitting(false);
          setPaymentReference(buildDefaultReference());
        }}
        onSuccess={(res: any) => {
          setPaystackVisible(false);
          const finalReference = res.transactionRef?.reference || res.reference || paymentReference;
          showToast('Payment submitted. Confirming now...', 'info');
          router.replace({
            pathname: '/paystack-callback',
            params: { reference: finalReference },
          } as any);
        }}
        onError={(err: any) => {
          setPaystackVisible(false);
          haptics.error();
          showToast(err?.message || 'Unable to process payment right now.', 'error');
          setSubmitting(false);
          setPaymentReference(buildDefaultReference());
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 22 },
  header: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  headerTag: {
    minWidth: 58,
    height: 28,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  headerTagText: {
    fontSize: 11,
    fontWeight: '800',
  },
  content: {
    gap: 12,
    paddingHorizontal: 16,
  },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  heroTrustPill: {
    minHeight: 28,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroTrustText: {
    fontSize: 12,
    fontWeight: '800',
  },
  heroSourcePill: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  heroSourceText: {
    fontSize: 11,
    fontWeight: '700',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  image: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: 10,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  itemMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  heroAmount: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  heroAmountHint: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  summaryLine: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLineLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  summaryLineValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  spacingTop: {
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  quantityRow: {
    borderWidth: 1,
    borderRadius: 12,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityAction: {
    width: 46,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityInput: {
    flex: 1,
    height: '100%',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  readonlyField: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  readonlyValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  locationPicker: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  locationPickerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 10,
    height: undefined,
  },
  summaryCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  escrowStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  escrowStepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  escrowStepDotText: {
    fontSize: 11,
    fontWeight: '900',
  },
  escrowStepText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  summaryHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  requirementHint: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  payFooter: {
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  payFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  payFooterLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  payFooterValue: {
    marginTop: 2,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  payButton: {
    borderRadius: 16,
    minHeight: 54,
    minWidth: 170,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  cancelAction: {
    alignSelf: 'center',
    paddingVertical: 4,
  },
  editSettingsAction: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  verifyPhoneAction: {
    borderWidth: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  verifyPhoneText: {
    fontSize: 14,
    fontWeight: '800',
  },
  stateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  stateModalSheet: {
    maxHeight: '72%',
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  stateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stateModalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  stateSearchWrap: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  stateSearchInput: {
    flex: 1,
    fontSize: 14,
  },
  stateListContent: {
    paddingBottom: 6,
  },
  stateRowItem: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  stateRowText: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyCityWrap: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyCityText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
