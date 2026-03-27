import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import { showToast } from '@/components/toast';
import { marketOrdersApi } from '@/lib/api/market-orders';
import { paymentsApi } from '@/lib/api/payments';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import {
  clearPendingEscrowCheckout,
  readPendingEscrowCheckout,
} from '@/lib/utils/pending-escrow-checkout';

const lightBrown = '#A67C52';
const VERIFY_POLL_MAX_ATTEMPTS = 12;
const VERIFY_POLL_DELAY_MS = 2500;
const VERIFY_FAST_MAX_ATTEMPTS = 3;
const VERIFY_FAST_DELAY_MS = 750;

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

async function findExistingOrderIdByPaymentReference(reference: string): Promise<string | null> {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) return null;

  const ordersRef = collection(firestore, 'orders');
  const paystackSnap = await getDocs(
    query(ordersRef, where('paystackReference', '==', normalizedReference), limit(1))
  );
  if (!paystackSnap.empty) {
    return paystackSnap.docs[0].id;
  }

  const paymentSnap = await getDocs(
    query(ordersRef, where('paymentReference', '==', normalizedReference), limit(1))
  );
  if (!paymentSnap.empty) {
    return paymentSnap.docs[0].id;
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePaymentState(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('not confirmed') ||
    message.includes('not successful') ||
    message.includes('abandoned') ||
    message.includes('pending') ||
    message.includes('try again')
  );
}

export default function PaystackCallbackScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const params = useLocalSearchParams<Record<string, string>>();
  const [runNonce, setRunNonce] = useState(0);
  const [status, setStatus] = useState<'verifying' | 'done' | 'error'>('verifying');
  const [message, setMessage] = useState<string>('Verifying payment...');

  const referenceFromParams = useMemo(() => {
    const direct = String((params as any)?.reference || '').trim();
    const trxref = String((params as any)?.trxref || '').trim();
    const ref = String((params as any)?.ref || '').trim();
    return direct || trxref || ref || '';
  }, [params]);

  const linkUrl = Linking.useURL();

  useEffect(() => {
    let cancelled = false;

    const persistBuyerCheckoutDefaults = async (input: {
      phone: string;
      state: string;
      city: string;
      address: string;
    }) => {
      if (!user?.uid) return;
      const normalized = {
        phone: String(input.phone || '').trim(),
        state: String(input.state || '').trim(),
        city: String(input.city || '').trim(),
        address: String(input.address || '').trim(),
      };
      if (!normalized.phone || !normalized.state || !normalized.city || normalized.address.length < 5) {
        return;
      }
      await setDoc(
        doc(firestore, 'users', user.uid),
        {
          marketBuyerPhone: normalized.phone,
          marketBuyerLocation: {
            state: normalized.state,
            city: normalized.city,
            address: normalized.address,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    };

    const run = async () => {
      try {
        setStatus('verifying');
        setMessage('Verifying payment...');

        const pending = await readPendingEscrowCheckout();
        const referenceFromLink = extractPaymentReference(linkUrl || '');
        const reference = referenceFromParams || referenceFromLink || pending?.reference || '';

        if (!reference) {
          throw new Error('Missing payment reference.');
        }

        const existingOrderId = await findExistingOrderIdByPaymentReference(reference).catch(() => null);
        if (existingOrderId) {
          await clearPendingEscrowCheckout();
          if (cancelled) return;
          setStatus('done');
          setMessage('Payment confirmed. Redirecting...');
          router.replace(`/(market)/orders/${existingOrderId}` as any);
          return;
        }

        if (!pending) {
          throw new Error('Missing pending checkout details. Please return to checkout and retry.');
        }

        if (!user) {
          throw new Error('Login required to finalize this payment.');
        }

        if (String(pending.reference || '').trim() !== reference) {
          // Still try verification with the reference we got, but keep pending data for order creation.
          console.warn('Paystack reference mismatch. Pending:', pending.reference, 'Link:', reference);
        }

        let verifiedReference = reference;
        let confirmed = false;

        // Fast lane: the webhook truth store may already have the transaction.
        // Try a few quick verifies before entering the slower poll loop.
        for (let fastAttempt = 1; fastAttempt <= VERIFY_FAST_MAX_ATTEMPTS; fastAttempt += 1) {
          if (cancelled) return;
          try {
            const verification = await paymentsApi.verifyEscrowPayment({
              amount: pending.amount,
              email: pending.buyerEmail,
              reference,
              maxAttempts: 1,
              attemptDelayMs: 250,
            });
            if (verification?.paid) {
              confirmed = true;
              verifiedReference = String(verification.reference || reference).trim() || reference;
              break;
            }
          } catch (fastError) {
            if (!isRetryablePaymentState(fastError)) {
              throw fastError;
            }
          }
          if (fastAttempt < VERIFY_FAST_MAX_ATTEMPTS) {
            await sleep(VERIFY_FAST_DELAY_MS);
          }
        }

        for (let attempt = 1; attempt <= VERIFY_POLL_MAX_ATTEMPTS; attempt += 1) {
          if (cancelled) return;
          if (confirmed) break;

          const existing = await findExistingOrderIdByPaymentReference(reference).catch(() => null);
          if (existing) {
            await clearPendingEscrowCheckout();
            if (cancelled) return;
            setStatus('done');
            setMessage('Payment confirmed. Redirecting...');
            router.replace(`/(market)/orders/${existing}` as any);
            return;
          }

          setMessage(
            attempt === 1
              ? 'Confirming payment with Paystack...'
              : `Still confirming payment... (${attempt}/${VERIFY_POLL_MAX_ATTEMPTS})`
          );

          try {
            const verification = await paymentsApi.verifyEscrowPayment({
              amount: pending.amount,
              email: pending.buyerEmail,
              reference,
              maxAttempts: 1,
              attemptDelayMs: 500,
            });
            if (verification?.paid) {
              confirmed = true;
              verifiedReference = String(verification.reference || reference).trim() || reference;
              break;
            }
          } catch (verifyError) {
            if (!isRetryablePaymentState(verifyError)) {
              throw verifyError;
            }
          }

          if (attempt < VERIFY_POLL_MAX_ATTEMPTS) {
            await sleep(VERIFY_POLL_DELAY_MS);
          }
        }

        if (!confirmed) {
          throw new Error(
            'Payment is still processing. Tap "Retry Confirmation" in a few seconds.'
          );
        }

        setMessage('Creating your order...');
        const created = await marketOrdersApi.createFromPost({
          buyerId: user.uid,
          buyerName: pending.buyerName,
          buyerEmail: pending.buyerEmail,
          buyerPhone: pending.buyerPhone,
          post: pending.post,
          quantity: pending.quantity,
          finalPrice: pending.finalPrice,
          deliveryAddress: pending.deliveryAddress,
          fromChatId: pending.fromChatId || undefined,
          paymentReference: verifiedReference,
          paystackReference: verifiedReference,
        });

        try {
          await persistBuyerCheckoutDefaults({
            phone: pending.buyerPhone,
            state: pending.deliveryState || '',
            city: pending.deliveryCity || '',
            address: pending.addressLine || '',
          });
        } catch (persistError) {
          console.warn('Unable to persist buyer checkout defaults:', persistError);
        }

        await clearPendingEscrowCheckout();

        if (cancelled) return;
        haptics.success();
        showToast('Order placed. Payment is held in escrow.', 'success');
        setStatus('done');
        setMessage('Payment confirmed. Redirecting...');
        router.replace(`/(market)/orders/${created.id}` as any);
      } catch (error: any) {
        console.error('Paystack callback error:', error);
        if (cancelled) return;
        haptics.error();
        setStatus('error');
        setMessage(String(error?.message || 'Unable to verify payment.'));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [linkUrl, referenceFromParams, runNonce, user]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {status === 'verifying' ? <ActivityIndicator size="large" color={lightBrown} /> : null}
      <Text style={[styles.text, { color: status === 'error' ? colors.error : colors.textSecondary }]}>
        {message}
      </Text>
      {status === 'error' ? (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.action, styles.secondaryAction, { borderColor: colors.border }]}
            onPress={() => {
              haptics.light();
              setStatus('verifying');
              setMessage('Retrying confirmation...');
              setRunNonce((value) => value + 1);
            }}>
            <Text style={[styles.secondaryActionText, { color: colors.text }]}>Retry Confirmation</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, { backgroundColor: lightBrown }]}
            onPress={() => router.replace('/(market)/orders' as any)}>
            <Text style={styles.actionText}>Go to Orders</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  action: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  secondaryAction: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  secondaryActionText: {
    fontWeight: '800',
  },
  actionText: {
    color: '#fff',
    fontWeight: '800',
  },
});
