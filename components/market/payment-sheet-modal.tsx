import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { PaystackCheckout } from '@/components/market/paystack-checkout';
import { canStartNewEscrowPayment, paymentsApi } from '@/lib/api/payments';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { haptics } from '@/lib/utils/haptics';
import {
  clearPendingEscrowCheckout,
  markPendingEscrowCheckoutSubmitted,
  readPendingEscrowCheckout,
  savePendingEscrowCheckout,
} from '@/lib/utils/pending-escrow-checkout';
import type { MarketPost } from '@/types';
import type { MarketCartLine } from '@/lib/stores/market-cart';
import { Alert } from '@/components/app-alert';

const ACCENT = '#A67C52';
const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
const FINALIZE_PENDING_MAX_ATTEMPTS = 4;
const FINALIZE_PENDING_DELAY_MS = 1200;

function formatNgn(value: number): string {
  return `NGN ${value.toLocaleString()}`;
}

function buildDefaultReference(): string {
  return `ikm_escrow_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalFailedPaymentMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('abandoned') ||
    normalized.includes('failed') ||
    normalized.includes('reversed') ||
    normalized.includes('cancelled') ||
    normalized.includes('canceled') ||
    normalized.includes('declined')
  );
}

function isRetryablePendingPaymentMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  if (isTerminalFailedPaymentMessage(normalized)) return false;
  return (
    normalized.includes('pending') ||
    normalized.includes('not successful') ||
    normalized.includes('not confirmed') ||
    normalized.includes('try again') ||
    normalized.includes('could not be verified')
  );
}

type PaymentState =
  | 'REVIEW'
  | 'INITIALIZING'
  | 'GATEWAY'
  | 'CONFIRMING'
  | 'SUCCESS'
  | 'ERROR';

interface PaymentSheetModalProps {
  visible: boolean;
  onClose: () => void;
  post: MarketPost;
  /** Agreed unit price (accepted offer or listed). Must match what the buyer pays. */
  unitPrice: number;
  quantity: number;
  deliveryAddress: string;
  deliveryState: string;
  deliveryCity: string;
  addressLine: string;
  buyerPhone: string;
  buyerEmail: string;
  buyerName: string;
  buyerId: string;
  fromChatId?: string | null;
  /** Multi-item cart (any sellers) — amount = sum(line.unitPrice * qty); server splits into N seller orders. */
  cartLines?: MarketCartLine[] | null;
  cartSessionId?: string | null;
  onSuccess: (
    orderId: string,
    dealThreadId?: string | null,
    orderIds?: string[]
  ) => void;
}

export default function PaymentSheetModal({
  visible,
  onClose,
  post,
  unitPrice,
  quantity,
  deliveryAddress,
  deliveryState,
  deliveryCity,
  addressLine,
  buyerPhone,
  buyerEmail,
  buyerName,
  buyerId,
  fromChatId = null,
  cartLines = null,
  cartSessionId = null,
  onSuccess,
}: PaymentSheetModalProps) {
  const { colors } = useTheme();
  const [paymentState, setPaymentState] = useState<PaymentState>('REVIEW');
  const [errorMessage, setErrorMessage] = useState('');
  const [reference, setReference] = useState('');
  const [createdOrderId, setCreatedOrderId] = useState('');
  const [createdOrderIds, setCreatedOrderIds] = useState<string[]>([]);
  const [createdDealThreadId, setCreatedDealThreadId] = useState<string | null>(null);
  const [verifyingText, setVerifyingText] = useState('Verifying escrow transaction...');
  const [paystackRetryKey, setPaystackRetryKey] = useState(0);

  const safeUnitPrice = Math.max(0, Number(unitPrice) || 0);
  const activeCartLines =
    Array.isArray(cartLines) && cartLines.length > 0
      ? cartLines.filter((line) => line.postId && line.unitPrice > 0 && line.quantity > 0)
      : null;
  const isCartCheckout = Boolean(activeCartLines && activeCartLines.length > 0);
  const total = isCartCheckout
    ? activeCartLines!.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
    : safeUnitPrice * Math.max(1, Number(quantity) || 1);
  const primaryPostId = isCartCheckout
    ? String(activeCartLines![0].postId)
    : String(post.id || '').trim();
  const postId = String(cartSessionId || primaryPostId || post.id || '').trim();
  const finalizeAttemptRef = useRef(false);
  const pendingResumeCheckedRef = useRef(false);
  const triggerFinalizationRef = useRef<
    (
      verifyRef: string,
      overrideUnitPrice?: number,
      options?: { quietTerminalUnpaid?: boolean; paidInspectRetry?: boolean }
    ) => Promise<void>
  >(async () => {});

  const handleClose = () => {
    if (paymentState === 'GATEWAY' || paymentState === 'CONFIRMING') {
      Alert.alert(
        'Confirm Cancel',
        'If you already paid (or a bank/USSD charge is still processing), keep this checkout. We will verify the same payment reference — we will not throw it away.',
        [
          { text: 'Keep Checking', style: 'cancel' },
          {
            text: 'Yes, Exit',
            style: 'destructive',
            onPress: () => {
              // Money-safety: never clear pending on UI exit. Reopen will inspect Paystack first.
              setPaymentState('REVIEW');
              onClose();
            },
          },
        ]
      );
    } else {
      setPaymentState('REVIEW');
      onClose();
    }
  };

  const triggerFinalization = useCallback(async (
    verifyRef: string,
    overrideUnitPrice?: number,
    options?: { quietTerminalUnpaid?: boolean; paidInspectRetry?: boolean }
  ) => {
    if (finalizeAttemptRef.current) return;
    finalizeAttemptRef.current = true;

    const unitForFinalize =
      typeof overrideUnitPrice === 'number' && overrideUnitPrice > 0
        ? overrideUnitPrice
        : safeUnitPrice;
    const quietTerminalUnpaid = options?.quietTerminalUnpaid === true;
    const paidInspectRetry = options?.paidInspectRetry === true;
    const normalizedRef = String(verifyRef || '').trim();

    setVerifyingText('Confirming secure escrow transaction...');

    try {
      if (!normalizedRef) {
        throw new Error('Missing payment reference.');
      }

      setVerifyingText('Finalizing your order...');

      // Prefer locked pending checkout values so a UI qty/price edit cannot desync Paystack.
      const pendingForFinalize = await readPendingEscrowCheckout({ postId, buyerId });
      const pendingQty = Number(pendingForFinalize?.quantity || 0);
      const finalizeQuantity =
        Number.isFinite(pendingQty) && pendingQty > 0
          ? Math.max(1, Math.floor(pendingQty))
          : quantity;
      const finalizeUnitPrice =
        pendingForFinalize && Number(pendingForFinalize.finalPrice) > 0
          ? Number(pendingForFinalize.finalPrice)
          : unitForFinalize;
      const finalizeDelivery =
        String(pendingForFinalize?.deliveryAddress || deliveryAddress || '').trim() ||
        deliveryAddress;
      const finalizePhone =
        String(pendingForFinalize?.buyerPhone || buyerPhone || '').trim() || buyerPhone;
      const finalizeDealThread =
        pendingForFinalize?.fromChatId || fromChatId;

      let response: Awaited<ReturnType<typeof paymentsApi.finalizeMarketEscrowPayment>> | null = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < FINALIZE_PENDING_MAX_ATTEMPTS; attempt += 1) {
        try {
          response = await paymentsApi.finalizeMarketEscrowPayment({
            reference: normalizedRef,
            postId: primaryPostId || post.id || '',
            quantity: isCartCheckout
              ? activeCartLines!.reduce((sum, line) => sum + line.quantity, 0)
              : finalizeQuantity,
            deliveryAddress: finalizeDelivery,
            buyerPhone: finalizePhone,
            dealThreadId: finalizeDealThread,
            chatId: finalizeDealThread,
            agreedUnitPrice: isCartCheckout ? undefined : finalizeUnitPrice,
            sellerId: post.posterId || activeCartLines?.[0]?.sellerId,
            itemTitle: isCartCheckout
              ? `${activeCartLines!.length} items`
              : String(post.title || post.description || 'Marketplace Item').slice(0, 80),
            lineItems: isCartCheckout
              ? activeCartLines!.map((line) => ({
                  postId: line.postId,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  title: line.title,
                }))
              : undefined,
            cartSessionId: cartSessionId || undefined,
          });
          lastError = null;
          break;
        } catch (attemptError) {
          lastError = attemptError;
          const attemptMessage = String((attemptError as any)?.message || '');
          if (isTerminalFailedPaymentMessage(attemptMessage)) {
            throw attemptError;
          }
          if (
            !isRetryablePendingPaymentMessage(attemptMessage) ||
            attempt === FINALIZE_PENDING_MAX_ATTEMPTS - 1
          ) {
            throw attemptError;
          }
          setVerifyingText('Payment is still confirming…');
          await sleep((attempt + 1) * FINALIZE_PENDING_DELAY_MS);
        }
      }

      if (lastError) throw lastError;

      if (response && (response.success || response.alreadyExists) && response.orderId) {
        haptics.success();
        setCreatedOrderId(response.orderId);
        setCreatedOrderIds(
          Array.isArray(response.orderIds) && response.orderIds.length
            ? response.orderIds
            : [response.orderId]
        );
        setCreatedDealThreadId(response.dealThreadId || fromChatId || null);
        setPaymentState('SUCCESS');
        // Only safe clear: order exists for this payment.
        await clearPendingEscrowCheckout({ postId, buyerId });
        finalizeAttemptRef.current = false;
        return;
      }

      throw new Error(response?.message || 'Order creation failed');
    } catch (err: any) {
      finalizeAttemptRef.current = false;
      const msg = String(err?.message || '');

      if (isTerminalFailedPaymentMessage(msg)) {
        // Never trust a single error string — re-inspect Paystack before discarding recovery data.
        try {
          const inspected = await paymentsApi.inspectEscrowPaymentStatus({
            reference: normalizedRef,
            amount: total,
            email: buyerEmail,
          });

          if (inspected.paid) {
            if (paidInspectRetry) {
              // Paid but order create still failing — keep recovery data, never clear.
              haptics.error();
              setReference(normalizedRef);
              setErrorMessage(
                'Payment is confirmed, but order creation failed. Tap Complete order again. Do not pay again. Save this reference for support.'
              );
              setPaymentState('ERROR');
              return;
            }
            setVerifyingText('Payment found — creating your order…');
            finalizeAttemptRef.current = false;
            await triggerFinalizationRef.current(normalizedRef, unitForFinalize, {
              quietTerminalUnpaid,
              paidInspectRetry: true,
            });
            return;
          }

          if (inspected.terminalUnpaid || inspected.safeToStartNewPayment) {
            // Confirmed unpaid / never charged for THIS product reference only.
            await clearPendingEscrowCheckout({ postId, buyerId });
            setReference('');
            setErrorMessage('');
            setPaymentState('REVIEW');
            if (!quietTerminalUnpaid) {
              haptics.light();
              Alert.alert(
                'Payment not completed',
                'Paystack confirms this checkout was not charged. Tap Pay to Escrow to start a new payment.'
              );
            }
            return;
          }
        } catch (inspectError) {
          console.warn('Payment inspect after finalize failure:', inspectError);
        }

        // Ambiguous: keep pending + reference so the buyer can recover a real charge.
        haptics.error();
        setReference(normalizedRef);
        setErrorMessage(
          'We could not confirm payment status yet. If you were charged, tap Complete order — do not pay again.'
        );
        setPaymentState('ERROR');
        return;
      }

      haptics.error();
      setReference(normalizedRef);
      setErrorMessage(
        msg
          ? `${msg} If Paystack charged you, tap Complete order — do not start a new payment.`
          : 'Unable to finalize payment. If you were charged, tap Complete order.'
      );
      setPaymentState('ERROR');
    }
  }, [
    postId,
    primaryPostId,
    post.posterId,
    post.title,
    post.description,
    quantity,
    deliveryAddress,
    buyerPhone,
    fromChatId,
    safeUnitPrice,
    total,
    buyerEmail,
    buyerId,
    isCartCheckout,
    activeCartLines,
    cartSessionId,
  ]);

  triggerFinalizationRef.current = triggerFinalization;

  useEffect(() => {
    if (!visible) {
      pendingResumeCheckedRef.current = false;
      return;
    }
    if (!postId || !buyerId) return;
    if (pendingResumeCheckedRef.current) return;
    pendingResumeCheckedRef.current = true;

    const checkPendingTransaction = async () => {
      try {
        // Scoped to this product only — other posts' pending payments are ignored.
        const pending = await readPendingEscrowCheckout({ postId, buyerId });
        if (!pending) return;

        setReference(pending.reference);
        setPaymentState('CONFIRMING');
        setVerifyingText('Checking your previous payment with Paystack…');

        const inspected = await paymentsApi.inspectEscrowPaymentStatus({
          reference: pending.reference,
          amount: Number(pending.amount) || total,
          email: pending.buyerEmail || buyerEmail,
        });

        // Gateway reported success earlier — always attempt order create first.
        if (inspected.paid || pending.phase === 'submitted') {
          setVerifyingText(
            inspected.paid
              ? 'Payment found — finishing your order…'
              : 'Finishing a payment that already reported success…'
          );
          void triggerFinalizationRef.current(
            pending.reference,
            Number(pending.finalPrice) || undefined,
            { quietTerminalUnpaid: true }
          );
          return;
        }

        const gate = canStartNewEscrowPayment({
          inspected,
          phase: pending.phase,
          createdAtMs: pending.createdAtMs,
        });

        if (inspected.terminalUnpaid || (gate.allow && inspected.safeToStartNewPayment)) {
          // No charge for this product reference — clear slot so buyer can pay immediately.
          await clearPendingEscrowCheckout({ postId, buyerId });
          setReference('');
          setPaymentState('REVIEW');
          return;
        }

        // Pending/unknown (bank transfer, slow webhook): keep recovery data, let buyer choose.
        setErrorMessage(
          gate.allow
            ? `${gate.label} Tap Complete order if you paid, or Pay again if you were not charged.`
            : gate.label
        );
        setPaymentState('ERROR');
      } catch (e) {
        console.warn('Error resuming pending checkout:', e);
        // Keep pending on inspect failure — never discard recovery data because the network failed.
        try {
          const pending = await readPendingEscrowCheckout({ postId, buyerId });
          if (pending) {
            setReference(pending.reference);
            setErrorMessage(
              'Could not reach Paystack to check your last payment for this item. Tap Complete order if you paid.'
            );
            setPaymentState('ERROR');
          }
        } catch {
          // ignore
        }
      }
    };

    void checkPendingTransaction();
  }, [visible, postId, buyerId, total, buyerEmail]);

  const beginFreshPaystackSession = async () => {
    const defaultRef = buildDefaultReference();
    const mockCallbackUrl = 'https://chatcart-mobile.web.app/paystack-callback';

    const initialized = await paymentsApi.initializeEscrowPayment({
      amount: total,
      email: buyerEmail,
      callbackUrl: mockCallbackUrl,
      reference: defaultRef,
      metadata: {
        source: isCartCheckout ? 'chatcart-market-cart' : 'chatcart-market-buy',
        postId: primaryPostId || post.id,
        buyerId,
        sellerId: post.posterId || activeCartLines?.[0]?.sellerId,
        quantity: isCartCheckout
          ? activeCartLines!.reduce((sum, line) => sum + line.quantity, 0)
          : quantity,
        agreedUnitPrice: isCartCheckout ? total : safeUnitPrice,
        cartTotal: isCartCheckout ? total : undefined,
        cartSessionId: cartSessionId || undefined,
        lineItems: isCartCheckout
          ? activeCartLines!.map((line) => ({
              postId: line.postId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              title: line.title,
            }))
          : undefined,
        dealThreadId: fromChatId || null,
        firebaseUid: buyerId,
        deliveryAddress,
        buyerPhone,
        buyerEmail,
        buyerName,
        itemTitle: isCartCheckout
          ? `${activeCartLines!.length} items`
          : String(post.title || post.description || 'Marketplace Item').slice(0, 80),
      },
    });

    const finalRef = initialized.reference || defaultRef;
    setReference(finalRef);

    await savePendingEscrowCheckout({
      reference: finalRef,
      amount: total,
      buyerId,
      buyerName,
      buyerEmail,
      buyerPhone,
      post: isCartCheckout ? ({ ...post, id: postId } as typeof post) : post,
      quantity: isCartCheckout
        ? activeCartLines!.reduce((sum, line) => sum + line.quantity, 0)
        : quantity,
      finalPrice: isCartCheckout ? total : safeUnitPrice,
      deliveryAddress,
      fromChatId,
      deliveryState,
      deliveryCity,
      addressLine,
      createdAtMs: Date.now(),
      phase: 'initialized',
      lineItems: isCartCheckout
        ? activeCartLines!.map((line) => ({
            postId: line.postId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            title: line.title,
          }))
        : undefined,
      cartSessionId: cartSessionId || undefined,
    });

    setPaymentState('GATEWAY');
  };

  const handleStartPayment = async () => {
    try {
      if (!(safeUnitPrice > 0) && !isCartCheckout) {
        throw new Error('Invalid checkout price. Go back and reopen Complete purchase.');
      }
      if (isCartCheckout && !(total > 0)) {
        throw new Error('Cart total is invalid.');
      }
      haptics.light();
      setPaymentState('INITIALIZING');
      setErrorMessage('');
      finalizeAttemptRef.current = false;

      // Only inspect THIS product's pending payment — never Product B's.
      const existing = await readPendingEscrowCheckout({ postId, buyerId });
      if (existing) {
        const inspected = await paymentsApi.inspectEscrowPaymentStatus({
          reference: existing.reference,
          amount: Number(existing.amount) || total,
          email: existing.buyerEmail || buyerEmail,
        });

        // Already paid — finish that order. Never open a second charge.
        if (inspected.paid || existing.phase === 'submitted') {
          setReference(existing.reference);
          setPaymentState('CONFIRMING');
          setVerifyingText('Previous payment found — finishing your order…');
          void triggerFinalization(
            existing.reference,
            Number(existing.finalPrice) || undefined
          );
          return;
        }

        const gate = canStartNewEscrowPayment({
          inspected,
          phase: existing.phase,
          createdAtMs: existing.createdAtMs,
        });

        if (!gate.allow) {
          setReference(existing.reference);
          setPaymentState('ERROR');
          setErrorMessage(gate.label);
          Alert.alert('Unfinished payment found', gate.label, [
            {
              text: 'Complete order',
              onPress: () => {
                setPaymentState('CONFIRMING');
                void triggerFinalization(
                  existing.reference,
                  Number(existing.finalPrice) || undefined
                );
              },
            },
            {
              text: 'I was not charged — new payment',
              style: 'destructive',
              onPress: () => {
                void (async () => {
                  const again = await paymentsApi.inspectEscrowPaymentStatus({
                    reference: existing.reference,
                    amount: Number(existing.amount) || total,
                    email: existing.buyerEmail || buyerEmail,
                  });
                  if (again.paid) {
                    setReference(existing.reference);
                    setPaymentState('CONFIRMING');
                    void triggerFinalization(
                      existing.reference,
                      Number(existing.finalPrice) || undefined
                    );
                    return;
                  }
                  const againGate = canStartNewEscrowPayment({
                    inspected: again,
                    phase: existing.phase,
                    createdAtMs: existing.createdAtMs,
                  });
                  if (!againGate.allow) {
                    const mins = Math.max(1, Math.ceil(againGate.waitMsRemaining / 60000));
                    Alert.alert(
                      'Still processing',
                      `${againGate.label}\n\nYou can try a new payment in about ${mins} minute(s) if no money left your account. Keep this reference: ${existing.reference}`,
                      [{ text: 'OK' }]
                    );
                    setReference(existing.reference);
                    setPaymentState('ERROR');
                    setErrorMessage(againGate.label);
                    return;
                  }
                  await clearPendingEscrowCheckout({ postId, buyerId });
                  setPaymentState('INITIALIZING');
                  await beginFreshPaystackSession();
                })();
              },
            },
            { text: 'Cancel', style: 'cancel', onPress: () => setPaymentState('REVIEW') },
          ]);
          return;
        }

        // Safe: not found / abandoned / grace elapsed — drop this product slot and start fresh.
        await clearPendingEscrowCheckout({ postId, buyerId });
      }

      await beginFreshPaystackSession();
    } catch (error: any) {
      haptics.error();
      setErrorMessage(error?.message || 'Failed to initialize payment gateway.');
      setPaymentState('ERROR');
    }
  };

  const handlePaystackSuccess = useCallback((data: any) => {
    const sdkReference = String(data?.reference || data?.transactionRef || reference || '').trim();
    if (sdkReference) {
      setReference(sdkReference);
    }
    // Persist submitted phase BEFORE finalize so crash mid-finalize stays recoverable.
    void markPendingEscrowCheckoutSubmitted(
      { postId, buyerId },
      sdkReference || reference
    );
    setPaymentState('CONFIRMING');
    triggerFinalization(sdkReference || reference);
  }, [reference, triggerFinalization, postId, buyerId]);

  const handlePaystackCancel = useCallback(() => {
    haptics.light();
    // Keep pending — cancel UI is not proof of unpaid (bank/USSD can still settle).
    setErrorMessage(
      'Checkout closed. If money left your account, tap Complete order with the same reference — do not pay again.'
    );
    setPaymentState('ERROR');
  }, []);

  const handlePaystackError = useCallback((error: any) => {
    haptics.error();
    // Keep pending until Paystack inspect proves unpaid.
    const msg = error?.message || 'Payment failed. Please try again.';
    setErrorMessage(
      `${msg} If you were charged, tap Complete order — do not start a new payment yet.`
    );
    setPaymentState('ERROR');
  }, []);

  const handleRetryPayment = () => {
    haptics.light();
    setPaystackRetryKey((k) => k + 1);
    setErrorMessage('');
    void handleStartPayment();
  };

  const handleVerifyManualPress = () => {
    const ref = reference;
    if (!ref) {
      void (async () => {
        const pending = await readPendingEscrowCheckout({ postId, buyerId });
        if (pending?.reference) {
          setReference(pending.reference);
          setPaymentState('CONFIRMING');
          void triggerFinalization(
            pending.reference,
            Number(pending.finalPrice) || undefined
          );
          return;
        }
        Alert.alert('No payment to complete', 'Start a new payment with Pay to Escrow.');
        setPaymentState('REVIEW');
      })();
      return;
    }
    haptics.light();
    setPaymentState('CONFIRMING');
    triggerFinalization(ref);
  };

  const handleSuccessDone = () => {
    haptics.light();
    setPaymentState('REVIEW');
    onSuccess(
      createdOrderId,
      createdDealThreadId,
      createdOrderIds.length ? createdOrderIds : createdOrderId ? [createdOrderId] : []
    );
  };

  const renderContent = () => {
    switch (paymentState) {
      case 'REVIEW':
        return (
          <View style={styles.stateWrapper}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Secure Order Escrow</Text>
              <Text style={[styles.sheetSub, { color: colors.textSecondary }]}>Funds are protected in safe escrow</Text>
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              {isCartCheckout ? (
                activeCartLines!.map((line) => (
                  <View key={line.postId} style={styles.row}>
                    <Text style={[styles.label, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>
                      {line.title} ×{line.quantity}
                    </Text>
                    <Text style={[styles.value, { color: colors.text }]}>
                      {formatNgn(line.unitPrice * line.quantity)}
                    </Text>
                  </View>
                ))
              ) : (
                <>
                  <View style={styles.row}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>Item</Text>
                    <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
                      {String(post.title || post.description || 'Marketplace Post').trim()}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>Unit price</Text>
                    <Text style={[styles.value, { color: colors.text }]}>{formatNgn(safeUnitPrice)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>Quantity</Text>
                    <Text style={[styles.value, { color: colors.text }]}>{quantity}</Text>
                  </View>
                </>
              )}
              <View style={styles.row}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Escrow Protection</Text>
                <Text style={[styles.value, { color: '#10B981', fontWeight: '800' }]}>Active</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Total Payable</Text>
                <Text style={[styles.totalValue, { color: colors.text }]}>{formatNgn(total)}</Text>
              </View>
            </View>

            <View style={styles.infoBox}>
              <IconSymbol name="lock.fill" size={15} color={ACCENT} />
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                Your funds will remain securely in escrow. The seller will only be paid once you confirm that you have received the item.
              </Text>
            </View>

            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: ACCENT }]} onPress={handleStartPayment}>
              <Text style={styles.buttonText}>Pay to Escrow</Text>
            </TouchableOpacity>
          </View>
        );

      case 'INITIALIZING':
        return (
          <View style={[styles.stateWrapper, styles.center]}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={[styles.statusText, { color: colors.text, marginTop: 16 }]}>
              Contacting payment gateway...
            </Text>
            <Text style={[styles.subStatusText, { color: colors.textSecondary }]}>
              Securing transaction token
            </Text>
          </View>
        );

      case 'GATEWAY':
        return (
          <View style={[styles.stateWrapper, styles.center]}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={[styles.statusText, { color: colors.text, marginTop: 16 }]}>
              Opening Paystack Checkout...
            </Text>
            <Text style={[styles.subStatusText, { color: colors.textSecondary }]}>
              Ref: {reference.slice(0, 15)}...
            </Text>
            <PaystackCheckout
              key={paystackRetryKey}
              visible
              paystackKey={PAYSTACK_PUBLIC_KEY}
              amount={total}
              billingEmail={buyerEmail}
              billingName={buyerName}
              refNumber={reference}
              onSuccess={handlePaystackSuccess}
              onCancel={handlePaystackCancel}
              onError={handlePaystackError}
            />
          </View>
        );

      case 'CONFIRMING':
        return (
          <View style={[styles.stateWrapper, styles.center]}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={[styles.statusText, { color: colors.text, marginTop: 18 }]}>
              {verifyingText}
            </Text>
            <Text style={[styles.subStatusText, { color: colors.textSecondary }]}>
              Reserving item inventory and building escrow registry
            </Text>
          </View>
        );

      case 'SUCCESS':
        return (
          <View style={styles.stateWrapper}>
            <View style={[styles.center, { marginVertical: 24 }]}>
              <View style={styles.successIconWrapper}>
                <IconSymbol name="checkmark.circle.fill" size={68} color="#10B981" />
              </View>
              <Text style={[styles.successTitle, { color: colors.text }]}>Payment Deposited</Text>
              <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
                Escrow order successfully processed!
              </Text>
            </View>

            <View style={[styles.receiptCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              <View style={styles.receiptRow}>
                <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>Order ID</Text>
                <Text style={[styles.receiptVal, { color: colors.text }]}>#{createdOrderId.slice(0, 10)}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>Payment Ref</Text>
                <Text style={[styles.receiptVal, { color: colors.text }]}>{reference.slice(0, 12)}...</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>Status</Text>
                <Text style={[styles.receiptVal, { color: '#10B981', fontWeight: '800' }]}>Escrow Held</Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: ACCENT }]} onPress={handleSuccessDone}>
              <Text style={styles.buttonText}>View Order Details</Text>
            </TouchableOpacity>
          </View>
        );

      case 'ERROR':
        return (
          <View style={styles.stateWrapper}>
            <View style={[styles.center, { marginVertical: 18 }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={54} color={colors.error} />
              <Text style={[styles.errorTitle, { color: colors.text, marginTop: 14 }]}>Checkout Incomplete</Text>
              <Text style={[styles.errorSub, { color: colors.textSecondary }]}>
                {errorMessage || 'Unable to confirm payment status at this moment.'}
              </Text>
              <Text style={[styles.errorSub, { color: colors.textSecondary, marginTop: 8 }]}>
                If Paystack already charged you, tap Complete order first — never start a second payment until that fails with “not charged”.
              </Text>
              {!!reference && (
                <TouchableOpacity
                  onPress={() => {
                    void Share.share({ message: `ChatCart payment reference: ${reference}` });
                  }}
                >
                  <Text style={[styles.errorSub, { color: ACCENT, marginTop: 8 }]}>
                    Reference: {reference} (tap to share)
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: ACCENT, flex: 1 }]}
                onPress={handleVerifyManualPress}
              >
                <Text style={styles.buttonText}>Complete order</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.outlineButton, { borderColor: colors.border }]}
                onPress={handleRetryPayment}
              >
                <Text style={[styles.outlineButtonText, { color: colors.text }]}>Pay again</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable
          style={[
            styles.sheetContainer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.dragBarContainer}>
            <View style={[styles.dragBar, { backgroundColor: colors.border }]} />
          </View>
          {renderContent()}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    minHeight: 260,
  },
  dragBarContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dragBar: {
    width: 38,
    height: 4.5,
    borderRadius: 3,
  },
  stateWrapper: {
    gap: 16,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  sheetHeader: {
    alignItems: 'center',
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 19,
    fontWeight: '800',
  },
  sheetSub: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  detailCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  value: {
    fontSize: 13,
    fontWeight: '700',
    maxWidth: '65%',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginVertical: 4,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  infoBox: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(166, 124, 82, 0.08)',
    gap: 10,
    alignItems: 'flex-start',
  },
  infoText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    flex: 1,
  },
  primaryButton: {
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  statusText: {
    fontSize: 15,
    fontWeight: '800',
  },
  subStatusText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 4,
  },
  successIconWrapper: {
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  successSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  receiptCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    marginBottom: 10,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  receiptVal: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  errorSub: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  outlineButton: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
  },
  outlineButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
});
