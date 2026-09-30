import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import PaymentSheetModal from '@/components/market/payment-sheet-modal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SmartPhoneField } from '@/components/ui/smart-phone-field';
import {
  formatBuyerLocationLabel,
  saveMarketBuyerProfile,
  toBuyerLocationPayload,
} from '@/lib/api/market-buyer-profile';
import { useUser } from '@/lib/firebase/auth/use-user';
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
          <Text style={[styles.price, { color: colors.text }]}>
            NGN {price.toLocaleString()}
          </Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Money is held until you confirm you received the item. The seller is not paid at checkout.
          </Text>

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
            style={[styles.cta, { backgroundColor: ACCENT }]}
            onPress={() => void startPay()}>
            <Text style={styles.ctaText}>Continue to payment</Text>
          </TouchableOpacity>
        </KeyboardScreen>

        {user && post ? (
          <PaymentSheetModal
            visible={payOpen}
            onClose={() => setPayOpen(false)}
            post={post}
            unitPrice={price}
            quantity={1}
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
});
