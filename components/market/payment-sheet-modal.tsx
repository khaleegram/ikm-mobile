import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PaystackCheckout } from '@/components/market/paystack-checkout';
import { paymentsApi } from '@/lib/api/payments';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { haptics } from '@/lib/utils/haptics';
import {
  clearPendingEscrowCheckout,
  readPendingEscrowCheckout,
  savePendingEscrowCheckout,
} from '@/lib/utils/pending-escrow-checkout';
import type { MarketPost } from '@/types';

const ACCENT = '#A67C52';
const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || '';

function formatNgn(value: number): string {
  return `NGN ${value.toLocaleString()}`;
}

function buildDefaultReference(): string {
  return `ikm_escrow_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
  onSuccess: (orderId: string, dealThreadId?: string | null) => void;
}

export default function PaymentSheetModal({
  visible,
  onClose,
  post,
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
  onSuccess,
}: PaymentSheetModalProps) {
  const { colors } = useTheme();
  const [paymentState, setPaymentState] = useState<PaymentState>('REVIEW');
  const [errorMessage, setErrorMessage] = useState('');
  const [reference, setReference] = useState('');
  const [createdOrderId, setCreatedOrderId] = useState('');
  const [createdDealThreadId, setCreatedDealThreadId] = useState<string | null>(null);
  const [verifyingText, setVerifyingText] = useState('Verifying escrow transaction...');
  const [paystackRetryKey, setPaystackRetryKey] = useState(0);

  const total = (post.price || 0) * quantity;
  const finalizeAttemptRef = useRef(false);

  const handleClose = () => {
    if (paymentState === 'GATEWAY' || paymentState === 'CONFIRMING') {
      Alert.alert(
        'Confirm Cancel',
        'Are you sure you want to exit? If you have completed payment, we will still check and verify your order.',
        [
          { text: 'Keep Checking', style: 'cancel' },
          {
            text: 'Yes, Exit',
            style: 'destructive',
            onPress: () => {
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

  useEffect(() => {
    if (!visible) return;

    const checkPendingTransaction = async () => {
      try {
        const pending = await readPendingEscrowCheckout();
        if (pending && pending.post?.id === post.id && pending.buyerId === buyerId) {
          Alert.alert(
            'Unfinished Checkout Found',
            'We found an interrupted payment. Would you like to check its completion status now?',
            [
              { text: 'Start Fresh', style: 'cancel', onPress: () => void clearPendingEscrowCheckout() },
              {
                text: 'Check Status',
                onPress: () => {
                  setReference(pending.reference);
                  setPaymentState('CONFIRMING');
                  triggerFinalization(pending.reference);
                },
              },
            ]
          );
        }
      } catch (e) {
        console.warn('Error reading pending checkout:', e);
      }
    };

    void checkPendingTransaction();
  }, [visible]);

  const triggerFinalization = useCallback(async (verifyRef: string) => {
    if (finalizeAttemptRef.current) return;
    finalizeAttemptRef.current = true;

    setVerifyingText('Confirming secure escrow transaction...');

    try {
      setVerifyingText('Finalizing your order...');

      const response = await paymentsApi.finalizeMarketEscrowPayment({
        reference: verifyRef,
        postId: post.id || '',
        quantity,
        deliveryAddress,
        buyerPhone,
        dealThreadId: fromChatId,
        chatId: fromChatId,
      });

      if (response && response.success && response.orderId) {
        haptics.success();
        setCreatedOrderId(response.orderId);
        setCreatedDealThreadId(response.dealThreadId || fromChatId || null);
        setPaymentState('SUCCESS');
        await clearPendingEscrowCheckout();
        finalizeAttemptRef.current = false;
        return;
      }

      if (response?.alreadyExists) {
        haptics.success();
        setCreatedOrderId(response.orderId);
        setCreatedDealThreadId(response.dealThreadId || fromChatId || null);
        setPaymentState('SUCCESS');
        await clearPendingEscrowCheckout();
        finalizeAttemptRef.current = false;
        return;
      }

      throw new Error(response?.message || 'Order creation failed');
    } catch (err: any) {
      finalizeAttemptRef.current = false;
      haptics.error();
      const msg = String(err?.message || '');
      setErrorMessage(msg || 'Unable to finalize payment. Please try again.');
      setPaymentState('ERROR');
    }
  }, [post.id, quantity, deliveryAddress, buyerPhone, fromChatId]);

  const handleStartPayment = async () => {
    try {
      haptics.light();
      setPaymentState('INITIALIZING');
      setErrorMessage('');
      finalizeAttemptRef.current = false;

      const defaultRef = buildDefaultReference();
      const mockCallbackUrl = 'https://chatcart-mobile.web.app/paystack-callback';

      const initialized = await paymentsApi.initializeEscrowPayment({
        amount: total,
        email: buyerEmail,
        callbackUrl: mockCallbackUrl,
        reference: defaultRef,
        metadata: {
          source: 'chatcart-market-buy',
          postId: post.id,
          buyerId,
          sellerId: post.posterId,
          quantity,
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
        post,
        quantity,
        finalPrice: post.price || 0,
        deliveryAddress,
        fromChatId,
        deliveryState,
        deliveryCity,
        addressLine,
        createdAtMs: Date.now(),
      });

      setPaymentState('GATEWAY');
    } catch (error: any) {
      haptics.error();
      setErrorMessage(error?.message || 'Failed to initialize payment gateway.');
      setPaymentState('ERROR');
    }
  };

  const handlePaystackSuccess = useCallback((data: any) => {
    const sdkReference = data?.reference || data?.transactionRef || reference;
    if (sdkReference && sdkReference !== reference) {
      setReference(sdkReference);
    }
    setPaymentState('CONFIRMING');
    triggerFinalization(sdkReference || reference);
  }, [reference, triggerFinalization]);

  const handlePaystackCancel = useCallback(() => {
    haptics.light();
    setPaymentState('REVIEW');
  }, []);

  const handlePaystackError = useCallback((error: any) => {
    haptics.error();
    const msg = error?.message || 'Payment failed. Please try again.';
    setErrorMessage(msg);
    setPaymentState('ERROR');
  }, []);

  const handleRetryPayment = () => {
    haptics.light();
    setPaystackRetryKey((k) => k + 1);
    setErrorMessage('');
    void handleStartPayment();
  };

  const handleVerifyManualPress = () => {
    haptics.light();
    setPaymentState('CONFIRMING');
    triggerFinalization(reference);
  };

  const handleSuccessDone = () => {
    haptics.light();
    setPaymentState('REVIEW');
    onSuccess(createdOrderId, createdDealThreadId);
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
              <View style={styles.row}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Item</Text>
                <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
                  {post.description?.trim() || 'Marketplace Post'}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Quantity</Text>
                <Text style={[styles.value, { color: colors.text }]}>{quantity}</Text>
              </View>
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
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.outlineButton, { borderColor: colors.border }]}
                onPress={handleRetryPayment}
              >
                <Text style={[styles.outlineButtonText, { color: colors.text }]}>Retry Payment</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: ACCENT, flex: 1 }]}
                onPress={handleVerifyManualPress}
              >
                <Text style={styles.buttonText}>Verify Payment</Text>
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
