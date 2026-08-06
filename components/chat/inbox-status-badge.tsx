import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

const BADGE_LABELS: Record<string, string> = {
  browsing: 'Browsing',
  offer_sent: 'Offer',
  accepted: 'Accepted',
  order_active: 'In order',
  in_order: 'In order',
  completed: 'Completed',
  closed: 'Closed',
  negotiating: 'Negotiating',
  seller: 'Seller',
};

type InboxStatusBadgeProps = {
  badge?: string | null;
};

export const InboxStatusBadge = memo(function InboxStatusBadge({ badge }: InboxStatusBadgeProps) {
  if (!badge) return null;
  const key = String(badge).trim().toLowerCase();
  // Skip noisy defaults that don't help the user
  if (key === 'browsing') return null;
  const label = BADGE_LABELS[key] || BADGE_LABELS[badge] || null;
  if (!label) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(166, 124, 82, 0.14)',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A67C52',
  },
});
