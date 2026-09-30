import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';

import { onLightFill } from './utils';

const lightBrown = '#A67C52';
const successGreen = '#10B981';
const dangerRed = '#B91C1C';

export type DealRibbonAction = {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'success' | 'danger';
  icon?: string;
  busy?: boolean;
};

type DealActionRibbonProps = {
  /** Who is reading — the phase line is phrased for this side. */
  viewer: DealViewer;
  /** Thread status before an order exists */
  threadStatus?: string | null;
  /** Live order status once paid */
  orderStatus?: string | null;
  escrowStatus?: string | null;
  refundStatus?: string | null;
  availabilityStatus?: string | null;
  waitTimeDays?: number | null;
  hasLinkedOrder?: boolean;
  /** Exactly one primary action for the current phase — never a stack. */
  primary?: DealRibbonAction | null;
  /** Secondary actions parked behind the sheet trigger. */
  secondaryCount?: number;
  onOpenActions?: () => void;
  /** Slim row while the keyboard is up or while reading older messages. */
  compact?: boolean;
};

/** Which side of the deal is reading — the same state is phrased differently for each. */
export type DealViewer = 'buyer' | 'seller';

/**
 * Single source of truth for the deal's phase line.
 *
 * Every string is addressed to whoever is reading it. Before this took a `viewer`, both sides
 * saw the identical sentence, so a buyer was told "Paid — awaiting shipment" — a to-do for the
 * seller that means nothing to the person who already paid.
 *
 * Vocabulary rules: "send" rather than "ship" (pickup and waybill are both supported, and
 * "shipped" is wrong for a handover), and "held" rather than "frozen" (frozen sounds broken).
 */
export function dealStatusLabel(
  viewer: DealViewer,
  threadStatus?: string | null,
  orderStatus?: string | null,
  hasOrder?: boolean,
  escrowStatus?: string | null,
  refundStatus?: string | null,
  availabilityStatus?: string | null,
  waitTimeDays?: number | null
): string {
  const buyer = viewer === 'buyer';

  if (hasOrder || orderStatus) {
    const escrow = String(escrowStatus || '');
    const refund = String(refundStatus || '');
    if (refund === 'failed') return 'Refund failed — contact support';
    if (escrow === 'refund_pending') return 'Cancelled — refund on the way';
    if (escrow === 'refunded') return buyer ? 'Cancelled — you were refunded' : 'Cancelled — buyer refunded';
    if (String(orderStatus) === 'Cancelled') return 'Cancelled';

    const s = String(orderStatus || 'Processing');
    if (s === 'AvailabilityCheck') {
      const avail = String(availabilityStatus || '');
      const days = Number(waitTimeDays);
      if (avail === 'not_available') {
        return buyer
          ? "Seller can't supply this — cancel for a refund"
          : "You can't supply this — buyer can cancel";
      }
      if (Number.isFinite(days) && days > 0) {
        return buyer
          ? `Seller needs ~${days} day(s) — they can send sooner`
          : `You told the buyer ~${days} day(s) — send when ready`;
      }
      return buyer
        ? 'Seller needs more time — they can send when ready'
        : 'Buyer is waiting on you — send when ready';
    }
    if (s === 'Sent') {
      return buyer
        ? 'Seller sent your item — confirm when you get it'
        : 'Buyer is waiting for the item';
    }
    if (s === 'Received') return 'Received — completing';
    if (s === 'Completed') {
      return buyer ? 'Completed — money released to seller' : 'Completed — money is yours';
    }
    if (s === 'Disputed') return 'Dispute open — money held';
    if (s === 'Preparing' || s === 'Accepted') {
      return buyer ? 'Seller is preparing your order' : 'Preparing — send it when ready';
    }
    return buyer ? 'Money held safely' : 'Buyer paid — send the item';
  }

  const t = String(threadStatus || '').toLowerCase();
  if (t === 'accepted') {
    return buyer ? 'Offer accepted — pay to start' : 'Offer accepted — waiting for payment';
  }
  if (t === 'offer_sent' || t === 'negotiating') return 'Negotiating price';
  if (t === 'in_order' || t === 'order_active') return 'Order in progress';
  if (t === 'completed') return 'Completed';
  if (t === 'closed') return 'Closed';
  return buyer ? 'Chat about this item' : 'Buyer is asking about this item';
}

export function isDealStatusAlert(
  orderStatus?: string | null,
  escrowStatus?: string | null,
  refundStatus?: string | null,
  availabilityStatus?: string | null
): boolean {
  return (
    String(orderStatus) === 'Cancelled' ||
    String(orderStatus) === 'Disputed' ||
    (String(orderStatus) === 'AvailabilityCheck' &&
      String(availabilityStatus || '') === 'not_available') ||
    String(escrowStatus) === 'refund_pending' ||
    String(refundStatus) === 'failed'
  );
}

function toneStyle(tone: DealRibbonAction['tone']) {
  if (tone === 'success') return successGreen;
  if (tone === 'danger') return dangerRed;
  return lightBrown;
}

/** Gold and green are light fills, so their text must be dark; only the red takes white. */
function toneForeground(tone: DealRibbonAction['tone']) {
  return tone === 'danger' ? '#FFFFFF' : onLightFill;
}

/**
 * The deal's one live line: phase text plus at most one primary action.
 * Everything else lives in the actions sheet behind the ⋯ trigger.
 */
export const DealActionRibbon = memo(function DealActionRibbon({
  viewer,
  threadStatus,
  orderStatus,
  escrowStatus,
  refundStatus,
  availabilityStatus,
  waitTimeDays,
  hasLinkedOrder,
  primary,
  secondaryCount = 0,
  onOpenActions,
  compact = false,
}: DealActionRibbonProps) {
  const { colors } = useTheme();
  const label = dealStatusLabel(
    viewer,
    threadStatus,
    orderStatus,
    hasLinkedOrder,
    escrowStatus,
    refundStatus,
    availabilityStatus,
    waitTimeDays
  );
  const alert = isDealStatusAlert(orderStatus, escrowStatus, refundStatus, availabilityStatus);
  const hasSheet = secondaryCount > 0 && Boolean(onOpenActions);

  return (
    <View
      style={[
        styles.wrap,
        {
          height: compact ? 36 : 44,
          paddingHorizontal: compact ? 4 : 6,
        },
      ]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: alert ? colors.error || '#EF4444' : lightBrown },
        ]}
      />

      {hasSheet ? (
        <TouchableOpacity
          style={styles.labelArea}
          activeOpacity={0.7}
          onPress={onOpenActions}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Open deal actions.`}>
          <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
            {label}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.labelArea}>
          <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}

      {primary ? (
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: toneStyle(primary.tone), opacity: primary.busy ? 0.7 : 1 },
          ]}
          disabled={primary.busy}
          onPress={primary.onPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={primary.label}>
          {primary.busy ? (
            <ActivityIndicator size="small" color={toneForeground(primary.tone)} />
          ) : (
            <>
              {primary.icon ? (
                <IconSymbol
                  name={primary.icon as any}
                  size={14}
                  color={toneForeground(primary.tone)}
                />
              ) : null}
              <Text
                style={[styles.primaryText, { color: toneForeground(primary.tone) }]}
                numberOfLines={1}>
                {primary.label}
              </Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      {hasSheet ? (
        <TouchableOpacity
          style={[styles.moreBtn, { borderColor: colors.border }]}
          onPress={onOpenActions}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="More deal actions">
          <IconSymbol name="ellipsis" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 8,
    marginTop: 2,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  labelArea: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    minWidth: 76,
  },
  primaryText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  moreBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
