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
  isBuyer: boolean;
  status: 'pending' | 'accepted' | 'declined' | 'countered';
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  onCounter: (amount: number) => Promise<void>;
  onBuy?: () => void;
};

export function OfferActionBar({
  offerId,
  amount,
  currency,
  lowball,
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
          <IconSymbol name="bag.fill" size={16} color="#fff" />
          <Text style={styles.primaryText}>Complete purchase</Text>
        </AnimatedPressable>
      </View>
    );
  }

  if (status !== 'pending') return null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.text }]}>
        {isBuyer ? 'Offer from seller' : 'Buyer can respond'} — {formatted}
      </Text>
      {lowball ? (
        <Text style={[styles.hint, { color: colors.warning || '#B8860B' }]}>
          Below 50% of list price — consider countering
        </Text>
      ) : null}

      {showCounter ? (
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
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.chipText}>Send</Text>
            )}
          </AnimatedPressable>
        </View>
      ) : null}

      {isBuyer ? (
        <View style={styles.actions}>
          <AnimatedPressable
            style={[styles.chip, { backgroundColor: colors.primary }]}
            disabled={busy}
            onPress={() => run(onAccept)}
            scaleValue={0.95}>
            <Text style={styles.chipText}>Accept</Text>
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
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Waiting for buyer response</Text>
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
    color: '#fff',
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
    color: '#fff',
    fontWeight: '700' as const,
    fontSize: 14,
  },
};
