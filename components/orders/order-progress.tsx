import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { OrderStep } from '@/lib/orders/order-view';

const ACCENT = '#A67C52';
const FUTURE = '#3A3A3A';

type OrderProgressProps = {
  steps: OrderStep[];
  colors: { text: string; textSecondary: string };
  /** Colour of the step the order is on, so it matches the headline. */
  toneColor: string;
};

/**
 * The journey, read left to right in one line.
 *
 * This replaces a six-row vertical list that said "Paid, Accepted, Preparing, On the way,
 * Received, Completed" — six rows to say "it's on the way". Four steps fit across the screen,
 * so the answer to "where is my order" needs no scrolling or reading.
 */
export function OrderProgress({ steps, colors, toneColor }: OrderProgressProps) {
  return (
    <View style={styles.row}>
      {steps.map((step, index) => {
        const first = index === 0;
        const last = index === steps.length - 1;
        const reached = step.done;
        // A connector is lit once the step after it has been reached.
        const leftLit = reached;
        const rightLit = steps[index + 1]?.done ?? false;
        const color = reached ? toneColor : FUTURE;

        return (
          <View key={step.key} style={styles.step}>
            <View style={styles.track}>
              <View
                style={[
                  styles.connector,
                  { backgroundColor: first ? 'transparent' : leftLit ? toneColor : FUTURE },
                ]}
              />
              <View
                style={[
                  styles.dot,
                  reached ? { backgroundColor: color, borderColor: color } : { borderColor: FUTURE },
                  step.current && styles.dotCurrent,
                ]}
              />
              <View
                style={[
                  styles.connector,
                  { backgroundColor: last ? 'transparent' : rightLit ? toneColor : FUTURE },
                ]}
              />
            </View>

            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: reached ? colors.text : colors.textSecondary },
                step.current && { fontWeight: '800' },
              ]}>
              {step.label}
            </Text>

            {step.at ? (
              <Text style={[styles.when, { color: colors.textSecondary }]} numberOfLines={1}>
                {step.at.toLocaleDateString([], { day: 'numeric', month: 'short' })}
              </Text>
            ) : (
              // Keeps every step the same height when some have dates and some don't.
              <View style={styles.whenSpacer} />
            )}
          </View>
        );
      })}
    </View>
  );
}

const DOT = 14;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  step: {
    flex: 1,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connector: {
    flex: 1,
    height: 2,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  dotCurrent: {
    transform: [{ scale: 1.25 }],
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 4,
  },
  label: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  when: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  whenSpacer: {
    marginTop: 2,
    height: 13,
  },
});
