import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Order, OrderStatus } from '@/types';

const STATUS_ORDER: OrderStatus[] = [
  'Paid',
  'Accepted',
  'Preparing',
  'Sent',
  'Received',
  'Completed',
];

const STATUS_LABELS: Record<string, string> = {
  Paid: 'Paid',
  Accepted: 'Accepted',
  Preparing: 'Preparing',
  Sent: 'Shipped',
  Received: 'Received',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Disputed: 'Disputed',
};

function getStateIndex(currentStatus: string): number {
  const idx = STATUS_ORDER.indexOf(currentStatus as OrderStatus);
  if (idx >= 0) return idx;
  if (currentStatus === 'Cancelled' || currentStatus === 'Disputed') return -2;
  if (currentStatus === 'Processing') return 0;
  return 0;
}

interface OrderTimelineProps {
  order: Order;
  events: any[];
}

export function OrderTimeline({ order, events }: OrderTimelineProps) {
  const currentIdx = getStateIndex(order.status || 'Paid');
  const isCancelled = order.status === 'Cancelled';
  const isDisputed = order.status === 'Disputed';

  if (isCancelled || isDisputed) {
    const color = isCancelled ? '#9CA3AF' : '#EF4444';
    return (
      <View style={styles.container}>
        {STATUS_ORDER.map((state, idx) => (
          <View key={state} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: '#2A2A2A', borderColor: '#444' }]} />
            {idx < STATUS_ORDER.length - 1 && <View style={[styles.line, { backgroundColor: '#1A1A1A' }]} />}
            <View style={styles.labelWrap}>
              <Text style={[styles.label, { color: '#555' }]}>{STATUS_LABELS[state]}</Text>
            </View>
          </View>
        ))}
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: color, borderColor: color }]} />
          <View style={styles.labelWrap}>
            <Text style={[styles.label, { color, fontWeight: '800' }]}>
              {isCancelled ? 'Cancelled' : 'Disputed'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {STATUS_ORDER.map((state, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isFuture = idx > currentIdx;

        const dotColor = isCompleted
          ? '#A67C52'
          : isCurrent
            ? '#A67C52'
            : '#2A2A2A';
        const dotBorder = isFuture ? '#444' : '#A67C52';
        const dotScale = isCurrent ? 1.3 : 1;
        const lineColor = isCompleted ? '#A67C52' : '#1A1A1A';
        const labelColor = isCompleted
          ? '#A67C52'
          : isCurrent
            ? '#FFFFFF'
            : '#555';

        const event = events.find(
          (e: any) => e.event === state.toLowerCase().replace(/ /g, '_')
        );
        const timestamp = event?.createdAt
          ? new Date(
              event.createdAt.seconds
                ? event.createdAt.seconds * 1000
                : event.createdAt
            ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : null;

        return (
          <View key={state} style={styles.row}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: dotColor,
                  borderColor: dotBorder,
                  borderWidth: isCurrent ? 3 : 2,
                  transform: [{ scale: dotScale }],
                  ...(isCurrent ? styles.currentDot : {}),
                },
              ]}
            />
            {idx < STATUS_ORDER.length - 1 && (
              <View style={[styles.line, { backgroundColor: lineColor }]} />
            )}
            <View style={styles.labelWrap}>
              <Text style={[styles.label, { color: labelColor, fontWeight: isCurrent ? '800' : '600' }]}>
                {STATUS_LABELS[state]}
              </Text>
              {timestamp && (isCompleted || isCurrent) && (
                <Text style={[styles.timestamp, { color: labelColor }]}>{timestamp}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DOT_SIZE = 16;

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingLeft: DOT_SIZE / 2 + 2,
    position: 'relative',
    minHeight: 48,
    paddingBottom: 0,
  },
  dot: {
    position: 'absolute',
    left: 2,
    top: 4,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  currentDot: {
    shadowColor: '#A67C52',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 4,
  },
  line: {
    position: 'absolute',
    left: 2 + DOT_SIZE / 2 - 1,
    top: DOT_SIZE + 4,
    width: 2,
    bottom: 0,
  },
  labelWrap: {
    marginLeft: 20,
  },
  label: {
    fontSize: 14,
  },
  timestamp: {
    fontSize: 11,
    marginTop: 2,
    opacity: 0.7,
  },
});
