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
    <View style={styles.track}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <TouchableOpacity
            key={opt.id}
            style={[styles.pill, active && styles.pillActive]}
            activeOpacity={0.8}
            onPress={() => {
              if (opt.id === value) return;
              haptics.light();
              onChange(opt.id);
            }}>
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 22,
    padding: 3,
    gap: 2,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
  },
  pillActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  label: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  labelActive: {
    color: '#FFFFFF',
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 3,
  },
});
