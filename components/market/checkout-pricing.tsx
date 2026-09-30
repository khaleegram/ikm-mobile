import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { formatKobo, type CheckoutDisplay, type CheckoutQuote } from '@/lib/api/checkout';
import { useLivePromoCodes } from '@/lib/hooks/use-checkout-quote';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';

const ACCENT = '#A67C52';
const GREEN = '#10B981';

/**
 * The promo code field.
 *
 * The code is only sent to the server when the buyer asks for it, so a half-typed code
 * does not earn an error message and a round-trip per keystroke. Nothing here decides
 * whether a code is valid or what it is worth — that is the server's answer, and this
 * component only reports it.
 */
export function PromoCodeField({
  appliedCode,
  onApply,
  onClear,
  isChecking,
  error,
  message,
}: {
  appliedCode: string | null;
  onApply: (code: string) => void;
  onClear: () => void;
  isChecking: boolean;
  error: string | null;
  message: string | null;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');

  const submit = () => {
    const code = draft.trim().toUpperCase();
    if (!code) return;
    onApply(code);
  };

  if (appliedCode) {
    return (
      <View style={[styles.appliedBox, { borderColor: GREEN }]}>
        <IconSymbol name="checkmark.circle.fill" size={16} color={GREEN} />
        <View style={styles.appliedText}>
          <Text style={[styles.appliedCode, { color: colors.text }]}>{appliedCode}</Text>
          {!!message && (
            <Text style={[styles.appliedMessage, { color: colors.textSecondary }]} numberOfLines={2}>
              {message}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={onClear} hitSlop={10}>
          <Text style={[styles.clearText, { color: colors.textSecondary }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={(text) => setDraft(text.toUpperCase())}
          placeholder="Promo code"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
          editable={!isChecking}
          style={[
            styles.input,
            { color: colors.text, borderColor: error ? colors.error : colors.border },
          ]}
        />
        <TouchableOpacity
          style={[
            styles.applyBtn,
            { borderColor: ACCENT, opacity: !draft.trim() || isChecking ? 0.5 : 1 },
          ]}
          onPress={submit}
          disabled={!draft.trim() || isChecking}
        >
          {isChecking ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Text style={[styles.applyText, { color: ACCENT }]}>Apply</Text>
          )}
        </TouchableOpacity>
      </View>
      {!!error && <Text style={[styles.error, { color: colors.error }]}>{error}</Text>}
    </View>
  );
}

/**
 * The itemised breakdown.
 *
 * Every figure is the server's, in kobo, and the total is the server's total — never a
 * sum recomputed here. A breakdown that adds up on the phone but not at the gateway is
 * how a buyer is charged a number they never saw.
 */
export function CheckoutBreakdown({
  display,
  quote,
  itemCount,
}: {
  display: CheckoutDisplay;
  quote?: CheckoutQuote | null;
  itemCount?: number;
}) {
  const { colors } = useTheme();

  const promoMessage = useMemo(() => {
    if (!quote || !quote.eligible || !quote.promo) return null;
    return quote.promo.message;
  }, [quote]);

  // A campaign that is valid but cannot be funded is not offered at all, so the buyer
  // is never shown a discount the platform will refuse at the moment of payment.
  const blocked = Boolean(quote && quote.eligible && !quote.chargeable);

  return (
    <View style={[styles.card, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <Row
        label={typeof itemCount === 'number' && itemCount > 1 ? `Items (${itemCount})` : 'Item'}
        value={formatKobo(display.itemsKobo)}
      />

      {display.discountKobo > 0 && (
        <Row
          label={display.code ? `Discount (${display.code})` : 'Discount'}
          value={`−${formatKobo(display.discountKobo)}`}
          valueColor={GREEN}
        />
      )}

      {display.shippingKobo > 0 && <Row label="Delivery" value={formatKobo(display.shippingKobo)} />}

      <Row label="Buyer protection" value={formatKobo(display.protectionKobo)} />

      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, { color: colors.text }]}>Total to pay</Text>
        <Text style={[styles.totalValue, { color: colors.text }]}>{formatKobo(display.totalKobo)}</Text>
      </View>

      {!!promoMessage && !blocked && (
        <Text style={[styles.footnote, { color: colors.textSecondary }]}>{promoMessage}</Text>
      )}
      {blocked && (
        <Text style={[styles.footnote, { color: colors.textSecondary }]}>
          This offer has reached its limit, so it is not being applied.
        </Text>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: valueColor || colors.text }]}>{value}</Text>
    </View>
  );
}

/** The offers currently running, shown as tappable chips. Hidden when there are none. */
export function LiveOfferChips({ onPick }: { onPick: (code: string) => void }) {
  const { colors } = useTheme();
  const { data: campaigns, isPending } = useLivePromoCodes();

  // Nothing to show and nothing loading: a heading with no offers is worse than none.
  if (isPending || !campaigns?.length) return null;

  return (
    <View style={styles.chips}>
      {campaigns.slice(0, 4).map((campaign) => (
        <TouchableOpacity
          key={campaign.code}
          style={[styles.chip, { borderColor: ACCENT }]}
          onPress={() => onPick(campaign.code)}
        >
          <Text style={[styles.chipCode, { color: ACCENT }]}>{campaign.code}</Text>
          {!!campaign.display?.headline && (
            <Text style={[styles.chipLabel, { color: colors.textSecondary }]} numberOfLines={1}>
              {campaign.display.headline}
            </Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    fontWeight: '700',
    letterSpacing: 1,
  },
  applyBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 78,
  },
  applyText: { fontSize: 14, fontWeight: '800' },
  error: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  appliedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
  },
  appliedText: { flex: 1 },
  appliedCode: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  appliedMessage: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  clearText: { fontSize: 12, fontWeight: '700' },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: '600', flex: 1 },
  value: { fontSize: 13, fontWeight: '700', maxWidth: '55%' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 15, fontWeight: '800' },
  totalValue: { fontSize: 18, fontWeight: '900' },
  footnote: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '48%' },
  chipCode: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  chipLabel: { fontSize: 10, fontWeight: '600', marginTop: 1 },
});
