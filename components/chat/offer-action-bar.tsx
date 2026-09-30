import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';

import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';

type OfferActionBarProps = {
  offerId: string;
  amount: number;
  currency: string;
  lowball?: boolean;
  /** True when the current user can accept / counter / decline this pending offer. */
  canRespond: boolean;
  /** Whose offer this is — drives copy for buyer vs seller proposals. */
  offerFrom: 'buyer' | 'seller';
  /** True when the current user is the buyer in this deal. */
  isBuyer: boolean;
  status: 'pending' | 'accepted' | 'declined' | 'countered';
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  onCounter: (amount: number) => Promise<void>;
  onBuy?: () => void;
};

export function OfferActionBar({
  amount,
  currency,
  lowball,
  canRespond,
  offerFrom,
  isBuyer,
  status,
  onAccept,
  onDecline,
  onCounter,
  onBuy,
}: OfferActionBarProps) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [showCounter, setShowCounter] = useState(false);
  const [counterAmount, setCounterAmount] = useState('');

  const formatted = `${currency} ${amount.toLocaleString()}`;

  const run = async (fn: () => Promise<void>) => {
    try {
      setBusy(true);
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (status === 'accepted' && isBuyer && onBuy) {
    return (
      <View style={[styles.wrap, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>Offer accepted — {formatted}</Text>
        <AnimatedPressable
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={onBuy}
          scaleValue={0.97}>
          <IconSymbol name="bag.fill" size={16} color={colors.primaryForeground} />
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
            Complete purchase
          </Text>
        </AnimatedPressable>
      </View>
    );
  }

  if (status !== 'pending') return null;

  const pendingLabel =
    offerFrom === 'buyer'
      ? canRespond
        ? `Buying offer — ${formatted}`
        : `Your buying offer sent — ${formatted}`
      : canRespond
        ? `Seller offer — ${formatted}`
        : `Your offer sent — ${formatted}`;

  const waitingHint =
    offerFrom === 'buyer'
      ? 'Waiting for seller response'
      : 'Waiting for buyer response';

  return (
    <View style={[styles.wrap, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.text }]}>{pendingLabel}</Text>
      {lowball ? (
        <Text style={[styles.hint, { color: colors.warning || '#B8860B' }]}>
          Below 50% of list price — consider countering
        </Text>
      ) : null}

      {canRespond && showCounter ? (
        <View style={styles.counterRow}>
          <TextInput
            value={counterAmount}
            onChangeText={setCounterAmount}
            keyboardType="numeric"
            placeholder="Counter amount"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
          />
          <AnimatedPressable
            style={[styles.chip, { backgroundColor: colors.primary }]}
            disabled={busy}
            onPress={() =>
              run(async () => {
                const n = Number(counterAmount);
                if (!Number.isFinite(n) || n <= 0) return;
                await onCounter(n);
                setShowCounter(false);
                setCounterAmount('');
              })
            }
            scaleValue={0.95}>
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Text style={[styles.chipText, { color: colors.primaryForeground }]}>Send</Text>
            )}
          </AnimatedPressable>
        </View>
      ) : null}

      {canRespond ? (
        <View style={styles.actions}>
          <AnimatedPressable
            style={[styles.chip, { backgroundColor: colors.primary }]}
            disabled={busy}
            onPress={() => run(onAccept)}
            scaleValue={0.95}>
            <Text style={[styles.chipText, { color: colors.primaryForeground }]}>Accept</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            disabled={busy}
            onPress={() => setShowCounter((v) => !v)}
            scaleValue={0.95}>
            <Text style={[styles.chipTextDark, { color: colors.text }]}>Counter</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
            disabled={busy}
            onPress={() => run(onDecline)}
            scaleValue={0.95}>
            <Text style={[styles.chipTextDark, { color: colors.textSecondary }]}>Decline</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{waitingHint}</Text>
      )}
    </View>
  );
}

const styles = {
  wrap: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  hint: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  counterRow: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'center' as const,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 72,
    alignItems: 'center' as const,
  },
  chipText: {
    fontWeight: '600' as const,
    fontSize: 13,
  },
  chipTextDark: {
    fontWeight: '600' as const,
    fontSize: 13,
  },
  primaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryText: {
    fontWeight: '700' as const,
    fontSize: 14,
  },
};
