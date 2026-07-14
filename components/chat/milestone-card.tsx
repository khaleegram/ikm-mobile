import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { formatRelativeTime } from '@/lib/utils/date-format';

const lightBrown = '#A67C52';

const EVENT_LABELS: Record<string, string> = {
  order_paid: 'Payment received',
  seller_accepted: 'Seller accepted',
  seller_preparing: 'Preparing order',
  order_shipped: 'Shipped',
  order_delivered: 'Delivered',
  buyer_confirmed: 'Order completed',
  order_cancelled: 'Cancelled',
  dispute_opened: 'Dispute opened',
  dispute_resolved: 'Dispute resolved',
  escrow_released: 'Escrow released',
  refund_processed: 'Refund processed',
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
  const label =
    (event && EVENT_LABELS[event]) ||
    String(text || '').trim() ||
    'Deal update';

  return (
    <View style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.header}>
          <View style={[styles.iconWrap, { backgroundColor: `${lightBrown}18` }]}>
            <IconSymbol name="checkmark.circle.fill" size={14} color={lightBrown} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {label}
            </Text>
            {createdAt ? (
              <Text style={[styles.time, { color: colors.textSecondary }]}>
                {formatRelativeTime(createdAt)}
              </Text>
            ) : null}
          </View>
        </View>
        {photoUrl ? <SafeImage uri={photoUrl} style={styles.photo} /> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 6,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
  },
  time: {
    fontSize: 11,
    fontWeight: '600',
  },
  photo: {
    width: '100%',
    height: 160,
    borderRadius: 10,
  },
});
