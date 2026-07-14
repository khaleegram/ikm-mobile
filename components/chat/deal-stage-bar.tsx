import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useTheme } from '@/lib/theme/theme-context';

const lightBrown = '#A67C52';

const STAGES = [
  { key: 'talk', label: 'Chat' },
  { key: 'offer', label: 'Offer' },
  { key: 'pay', label: 'Paid' },
  { key: 'done', label: 'Done' },
] as const;

function stageIndexForStatus(status?: string | null): number {
  const value = String(status || '').toLowerCase();
  if (value === 'completed' || value === 'closed') return 3;
  if (value === 'in_order' || value === 'order_active') return 2;
  if (value === 'offer_sent' || value === 'accepted' || value === 'negotiating') return 1;
  return 0;
}

type DealStageBarProps = {
  status?: string | null;
};

export const DealStageBar = memo(function DealStageBar({ status }: DealStageBarProps) {
  const { colors } = useTheme();
  const active = useMemo(() => stageIndexForStatus(status), [status]);

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
                ]}>
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
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stage: {
    alignItems: 'center',
    gap: 4,
    minWidth: 44,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  connector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginHorizontal: 2,
    marginBottom: 14,
  },
});
