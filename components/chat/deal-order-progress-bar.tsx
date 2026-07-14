import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useTheme } from '@/lib/theme/theme-context';
import type { OrderStatus } from '@/types';

const lightBrown = '#A67C52';

const STAGES: { key: OrderStatus; label: string }[] = [
  { key: 'Paid', label: 'Paid' },
  { key: 'Accepted', label: 'Accepted' },
  { key: 'Preparing', label: 'Preparing' },
  { key: 'Sent', label: 'Shipped' },
  { key: 'Received', label: 'Received' },
  { key: 'Completed', label: 'Done' },
];

function stageIndexForOrderStatus(status?: string | null): number {
  const value = String(status || 'Paid');
  if (value === 'Processing' || value === 'PendingPayment') return 0;
  const idx = STAGES.findIndex((s) => s.key === value);
  if (idx >= 0) return idx;
  if (value === 'Cancelled' || value === 'Disputed') return -1;
  return 0;
}

type DealOrderProgressBarProps = {
  orderStatus?: string | null;
};

export const DealOrderProgressBar = memo(function DealOrderProgressBar({
  orderStatus,
}: DealOrderProgressBarProps) {
  const { colors } = useTheme();
  const active = useMemo(() => stageIndexForOrderStatus(orderStatus), [orderStatus]);

  if (active < 0) {
    return (
      <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[styles.cancelled, { color: colors.error || '#EF4444' }]}>
          {String(orderStatus)}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {STAGES.map((stage, index) => {
        const reached = index <= active;
        return (
          <React.Fragment key={stage.key}>
            {index > 0 ? (
              <View
                style={[
                  styles.connector,
                  { backgroundColor: index <= active ? lightBrown : colors.border },
                ]}
              />
            ) : null}
            <View style={styles.stage}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: reached ? lightBrown : colors.backgroundSecondary,
                    borderColor: reached ? lightBrown : colors.border,
                  },
                ]}
              />
              <Text
                style={[
                  styles.label,
                  { color: reached ? colors.text : colors.textSecondary },
                ]}
                numberOfLines={1}>
                {stage.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stage: {
    alignItems: 'center',
    gap: 3,
    minWidth: 36,
    maxWidth: 52,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  connector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginHorizontal: 1,
    marginBottom: 12,
  },
  cancelled: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    width: '100%',
  },
});
