import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { haptics } from '@/lib/utils/haptics';

export type FeedSegmentOption = {
  id: string;
  label: string;
};

interface FeedSegmentSwitchProps {
  options: FeedSegmentOption[];
  value: string;
  onChange: (id: string) => void;
}

export function FeedSegmentSwitch({ options, value, onChange }: FeedSegmentSwitchProps) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <TouchableOpacity
            key={opt.id}
            style={styles.tab}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            onPress={() => {
              if (opt.id === value) return;
              haptics.light();
              onChange(opt.id);
            }}>
            {/* No container: the selected tab is simply brighter than the others. */}
            <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  tab: {
    paddingVertical: 6,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  labelIdle: {
    color: '#FFFFFF',
    opacity: 0.55,
    fontWeight: '600',
  },
  labelActive: {
    color: '#FFFFFF',
    opacity: 1,
    fontWeight: '800',
  },
});
