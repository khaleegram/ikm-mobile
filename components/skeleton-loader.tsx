// Skeleton loader component for better loading states
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useEffect, useRef } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export function Skeleton({ width = '100%', height = 20, borderRadius = 8, style }: SkeletonProps) {
  const { colors } = useTheme();
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.backgroundSecondary,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonProductCard() {
  const { colors } = useTheme();
  
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <Skeleton width="100%" height={160} borderRadius={12} />
      <View style={styles.content}>
        <Skeleton width="80%" height={20} style={{ marginBottom: 12 }} />
        <Skeleton width="40%" height={24} style={{ marginBottom: 8 }} />
        <View style={styles.row}>
          <Skeleton width={60} height={18} />
          <Skeleton width={40} height={18} />
        </View>
      </View>
    </View>
  );
}

export function SkeletonOrderCard() {
  const { colors } = useTheme();
  
  return (
    <View style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={styles.orderHeader}>
        <Skeleton width={120} height={20} />
        <Skeleton width={80} height={24} borderRadius={12} />
      </View>
      <View style={styles.orderContent}>
        <Skeleton width="60%" height={16} style={{ marginBottom: 8 }} />
        <Skeleton width="40%" height={16} />
      </View>
      <Skeleton width="30%" height={24} style={{ marginTop: 12 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: 12,
  },
  content: {
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  orderCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderContent: {
    marginBottom: 12,
  },
});

