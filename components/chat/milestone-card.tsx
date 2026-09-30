import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { useTheme } from '@/lib/theme/theme-context';
import { formatRelativeTime } from '@/lib/utils/date-format';

/**
 * Compact WhatsApp-style system lines — not heavy "cards".
 *
 * One event, one sentence. These lines are read by both sides, so they stay neutral and
 * passive ("Seller sent your item") rather than phrased as a to-do for one role — that is the
 * ribbon's job. "Send" is used throughout instead of "ship": the marketplace supports pickup
 * and waybill, and "shipped" is wrong for a handover.
 */
const EVENT_COPY: Record<string, string> = {
  order_paid: 'Money held safely',
  seller_accepted: 'Seller accepted your order',
  seller_preparing: 'Seller is preparing your order',
  order_shipped: 'Seller sent your item',
  order_delivered: 'Buyer confirmed they got it',
  buyer_confirmed: 'Order completed',
  order_cancelled: 'Order cancelled',
  refund_requested: 'Refund on the way',
  dispute_opened: 'Dispute open — money held',
  dispute_resolved: 'Dispute resolved',
  escrow_released: 'Money released to seller',
  refund_processed: 'Refunded',
  seller_needs_time: 'Seller needs more time',
  item_unavailable: "Seller can't supply this item",
  buyer_accepted_wait: 'Buyer agreed to wait',
  shipment_reminder: 'Reminder: not sent yet',
};

type MilestoneCardProps = {
  text?: string;
  event?: string | null;
  photoUrl?: string | null;
  createdAt?: any;
};

export const MilestoneCard = memo(function MilestoneCard({
  text,
  event,
  photoUrl,
  createdAt,
}: MilestoneCardProps) {
  const { colors } = useTheme();
  const fromEvent = event ? EVENT_COPY[event] : null;
  const raw = String(text || '').trim();
  // Prefer short event label; avoid dumping long customText into the bubble when we have a known event.
  const label = fromEvent || raw || 'Deal update';
  const detail =
    fromEvent && raw && raw !== fromEvent && !raw.toLowerCase().startsWith(fromEvent.toLowerCase())
      ? raw
      : null;

  return (
    <View style={styles.wrap}>
      <View style={[styles.pill, { backgroundColor: colors.backgroundSecondary }]}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        {createdAt ? (
          <Text style={[styles.time, { color: colors.textSecondary }]}>
            · {formatRelativeTime(createdAt)}
          </Text>
        ) : null}
      </View>
      {detail ? (
        <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={3}>
          {detail}
        </Text>
      ) : null}
      {photoUrl ? <SafeImage uri={photoUrl} style={styles.photo} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 6,
    gap: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    maxWidth: '100%',
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  time: {
    fontSize: 11,
    fontWeight: '500',
  },
  detail: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 15,
    paddingHorizontal: 8,
  },
  photo: {
    width: '68%',
    maxWidth: 220,
    height: 120,
    borderRadius: 10,
  },
});
