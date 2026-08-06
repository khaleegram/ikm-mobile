import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useTheme } from '@/lib/theme/theme-context';
import type { OrderStatus } from '@/types';

const lightBrown = '#A67C52';

type DealStatusStripProps = {
  /** Thread status before an order exists */
  threadStatus?: string | null;
  /** Live order status once paid */
  orderStatus?: string | null;
  escrowStatus?: string | null;
  refundStatus?: string | null;
  hasLinkedOrder?: boolean;
  availabilityStatus?: string | null;
  waitTimeDays?: number | null;
};

function labelFor(
  threadStatus?: string | null,
  orderStatus?: string | null,
  hasOrder?: boolean,
  escrowStatus?: string | null,
  refundStatus?: string | null,
  availabilityStatus?: string | null,
  waitTimeDays?: number | null
): string {
  if (hasOrder || orderStatus) {
    const escrow = String(escrowStatus || '');
    const refund = String(refundStatus || '');
    if (refund === 'failed') return 'Refund failed — contact support';
    if (escrow === 'refund_pending') return 'Cancelled — refund processing';
    if (escrow === 'refunded') return 'Cancelled — refunded';
    if (String(orderStatus) === 'Cancelled') return 'Cancelled';

    const s = String(orderStatus || 'Processing');
    if (s === 'AvailabilityCheck') {
      const avail = String(availabilityStatus || '');
      if (avail === 'not_available') return 'Item unavailable — resolve or cancel';
      const days = Number(waitTimeDays);
      if (Number.isFinite(days) && days > 0) {
        return `Seller needs ~${days} day(s) — can ship earlier`;
      }
      return 'Delay requested — seller can ship when ready';
    }
    if (s === 'Sent') return 'Shipped — confirm when you receive';
    if (s === 'Received') return 'Received — completing';
    if (s === 'Completed') return 'Completed';
    if (s === 'Disputed') return 'In dispute';
    if (s === 'Preparing' || s === 'Accepted') return 'Seller preparing to ship';
    return 'Paid — awaiting shipment';
  }

  const t = String(threadStatus || '').toLowerCase();
  if (t === 'accepted') return 'Offer accepted — complete purchase';
  if (t === 'offer_sent' || t === 'negotiating') return 'Negotiating price';
  if (t === 'in_order' || t === 'order_active') return 'Order in progress';
  if (t === 'completed') return 'Deal completed';
  if (t === 'closed') return 'Deal closed';
  if (t === 'browsing') return 'Chat about this product';
  return 'Chat about this product';
}

/**
 * One quiet status line instead of multi-stage progress bars.
 */
export const DealStatusStrip = memo(function DealStatusStrip({
  threadStatus,
  orderStatus,
  escrowStatus,
  refundStatus,
  hasLinkedOrder,
  availabilityStatus,
  waitTimeDays,
}: DealStatusStripProps) {
  const { colors } = useTheme();
  const label = labelFor(
    threadStatus,
    orderStatus,
    hasLinkedOrder,
    escrowStatus,
    refundStatus,
    availabilityStatus,
    waitTimeDays
  );
  const isAlert =
    String(orderStatus) === 'Cancelled' ||
    String(orderStatus) === 'Disputed' ||
    (String(orderStatus) === 'AvailabilityCheck' &&
      String(availabilityStatus || '') === 'not_available') ||
    String(escrowStatus) === 'refund_pending' ||
    String(refundStatus) === 'failed';

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: isAlert ? colors.error || '#EF4444' : lightBrown },
        ]}
      />
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});

export type { OrderStatus };

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
});
