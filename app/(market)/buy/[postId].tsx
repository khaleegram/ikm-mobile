import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import {
  PaystackCheckoutModal,
  type PaystackCheckoutResult,
} from '@/components/market/paystack-checkout-modal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { paymentsApi } from '@/lib/api/payments';
import { NIGERIA_LOCATION_OPTIONS } from '@/lib/constants/nigeria-locations';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPost } from '@/lib/firebase/firestore/market-posts';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
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

export default function MarketBuyScreen() {
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
  const [statePickerVisible, setStatePickerVisible] = useState(false);
  const [cityPickerVisible, setCityPickerVisible] = useState(false);
  const [stateSearch, setStateSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');

  const checkoutResolverRef = useRef<((result: PaystackCheckoutResult) => void) | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [checkoutAuthorizationUrl, setCheckoutAuthorizationUrl] = useState<string | null>(null);

  const openCheckoutModal = useCallback(async (authorizationUrl: string) => {
    const normalizedUrl = String(authorizationUrl || '').trim();
    if (!normalizedUrl) {
      throw new Error('Unable to open payment checkout.');
    }

    setCheckoutAuthorizationUrl(normalizedUrl);
    setCheckoutVisible(true);

    return new Promise<PaystackCheckoutResult>((resolve) => {
      checkoutResolverRef.current = resolve;
    });
  }, []);

  const handleCheckoutResult = useCallback((result: PaystackCheckoutResult) => {
    const resolver = checkoutResolverRef.current;
    checkoutResolverRef.current = null;

    setCheckoutVisible(false);
    setCheckoutAuthorizationUrl(null);

    resolver?.(result);
  }, []);
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

  const filteredStates = useMemo(() => {
    const queryValue = stateSearch.trim().toLowerCase();
    if (!queryValue) return NIGERIA_STATES;
    return NIGERIA_STATES.filter((state) => state.toLowerCase().includes(queryValue));
  }, [stateSearch]);

  const availableCities = useMemo(() => {
    if (!deliveryState) return [];
    const cities = NIGERIA_LOCATION_OPTIONS.filter((entry) => entry.state === deliveryState).map(
      (entry) => entry.city
    );
    return [...new Set(cities)].sort((a, b) => a.localeCompare(b));
  }, [deliveryState]);

  const filteredCities = useMemo(() => {
    const queryValue = citySearch.trim().toLowerCase();
    if (!queryValue) return availableCities;
    return availableCities.filter((city) => city.toLowerCase().includes(queryValue));
  }, [availableCities, citySearch]);

  React.useEffect(() => {
    if (!deliveryCity) return;
    if (!availableCities.includes(deliveryCity)) {
      setDeliveryCity('');
    }
  }, [availableCities, deliveryCity]);

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
      showToast('Verify your phone before checkout.', 'error');
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

      const callbackUrl = Linking.createURL('/paystack-callback');
      const initializedCheckout = await paymentsApi.initializeEscrowPayment({
        amount: total,
        email: buyerEmail,
        callbackUrl,
        metadata: {
          buyerId: user.uid,
          sellerId: post.posterId,
          postId: post.id,
          chatId: chatId || null,
          quantity: numericQuantity,
        },
      });

      await savePendingEscrowCheckout({
        reference: initializedCheckout.reference,
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

      const checkoutResult = await openCheckoutModal(initializedCheckout.authorizationUrl);
      if (checkoutResult.type === 'error') {
        throw new Error('Unable to open payment checkout.');
      }

      if (checkoutResult.type !== 'success') {
        showToast('Payment not completed. You can try again when ready.', 'info');
        return;
      }

      const callbackReference = extractPaymentReference(checkoutResult.url || '');
      const paymentReference = callbackReference || initializedCheckout.reference;
      if (!paymentReference) {
        throw new Error('Unable to confirm payment reference.');
      }

      // Finalize payment + order in a dedicated processing route.
      // This gives users deterministic progress UI and retry handling.
      showToast('Payment submitted. Confirming now...', 'info');
      router.replace({
        pathname: '/paystack-callback',
        params: { reference: paymentReference },
      } as any);
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to process payment right now.', 'error');
    } finally {
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
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <PaystackCheckoutModal
        visible={checkoutVisible}
        authorizationUrl={checkoutAuthorizationUrl}
        onResult={handleCheckoutResult}
      />
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
            {post.description?.trim() || 'Market Street item'}
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
          <View
            style={[
              styles.readonlyField,
              {
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}>
            <Text style={[styles.readonlyValue, { color: buyerPhone ? colors.text : colors.textSecondary }]}>
              {buyerPhone || 'Phone not verified'}
            </Text>
          </View>
          <TouchableOpacity style={styles.editSettingsAction} onPress={handleOpenDeliverySettings}>
            <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
              Edit saved delivery settings
            </Text>
          </TouchableOpacity>

          <Text style={[styles.label, styles.spacingTop, { color: colors.text }]}>Delivery State</Text>
          <TouchableOpacity
            style={[
              styles.locationPicker,
              {
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
            onPress={() => setStatePickerVisible(true)}>
            <IconSymbol name="location.fill" size={16} color={lightBrown} />
            <Text
              style={[
                styles.locationPickerText,
                { color: deliveryState ? colors.text : colors.textSecondary },
              ]}>
              {selectedStateLabel}
            </Text>
            <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} />
          </TouchableOpacity>

          <Text style={[styles.label, styles.spacingTop, { color: colors.text }]}>Delivery City</Text>
          <TouchableOpacity
            style={[
              styles.locationPicker,
              {
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
                opacity: deliveryState ? 1 : 0.7,
              },
            ]}
            disabled={!deliveryState}
            onPress={() => setCityPickerVisible(true)}>
            <IconSymbol name="location.fill" size={15} color={lightBrown} />
            <Text
              style={[
                styles.locationPickerText,
                { color: deliveryCity ? colors.text : colors.textSecondary },
              ]}>
              {deliveryState ? selectedCityLabel : 'Select state first'}
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
        visible={statePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStatePickerVisible(false)}>
        <Pressable style={styles.stateModalBackdrop} onPress={() => setStatePickerVisible(false)}>
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
              <Text style={[styles.stateModalTitle, { color: colors.text }]}>Select Delivery State</Text>
              <TouchableOpacity onPress={() => setStatePickerVisible(false)}>
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
                value={stateSearch}
                onChangeText={setStateSearch}
                placeholder="Search state"
                placeholderTextColor={colors.textSecondary}
                style={[styles.stateSearchInput, { color: colors.text }]}
              />
            </View>

            <FlatList
              data={filteredStates}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
              contentContainerStyle={styles.stateListContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.stateRowItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    haptics.light();
                    setDeliveryState(item);
                    setStateSearch('');
                    setStatePickerVisible(false);
                  }}>
                  <Text style={[styles.stateRowText, { color: colors.text }]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={cityPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCityPickerVisible(false)}>
        <Pressable style={styles.stateModalBackdrop} onPress={() => setCityPickerVisible(false)}>
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
              <Text style={[styles.stateModalTitle, { color: colors.text }]}>Select Delivery City</Text>
              <TouchableOpacity onPress={() => setCityPickerVisible(false)}>
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
                value={citySearch}
                onChangeText={setCitySearch}
                placeholder="Search city"
                placeholderTextColor={colors.textSecondary}
                style={[styles.stateSearchInput, { color: colors.text }]}
              />
            </View>

            <FlatList
              data={filteredCities}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
              contentContainerStyle={styles.stateListContent}
              ListEmptyComponent={
                <View style={styles.emptyCityWrap}>
                  <Text style={[styles.emptyCityText, { color: colors.textSecondary }]}>
                    No city matches this search.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.stateRowItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    haptics.light();
                    setDeliveryCity(item);
                    setCitySearch('');
                    setCityPickerVisible(false);
                  }}>
                  <Text style={[styles.stateRowText, { color: colors.text }]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
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
  stateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
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
