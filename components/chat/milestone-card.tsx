import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { useTheme } from '@/lib/theme/theme-context';
import { formatRelativeTime } from '@/lib/utils/date-format';

/**
 * Compact WhatsApp-style system lines — not heavy "cards".
 */
const EVENT_COPY: Record<string, string> = {
  order_paid: 'Payment received in escrow',
  seller_accepted: 'Seller accepted the order',
  seller_preparing: 'Seller is preparing your order',
  order_shipped: 'Order marked as shipped',
  order_delivered: 'Delivered',
  buyer_confirmed: 'Order completed',
  order_cancelled: 'Order cancelled',
  refund_requested: 'Refund processing',
  dispute_opened: 'Dispute opened',
  dispute_resolved: 'Dispute resolved',
  escrow_released: 'Escrow released to seller',
  refund_processed: 'Refund processed',
  seller_needs_time: 'Seller needs more time',
  item_unavailable: 'Seller marked item unavailable',
  buyer_accepted_wait: 'Buyer agreed to wait',
  shipment_reminder: 'Reminder: still awaiting shipment',
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
    paddingVertical: 8,
    gap: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
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
    width: '72%',
    maxWidth: 240,
    height: 140,
    borderRadius: 12,
  },
});
