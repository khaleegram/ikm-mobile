// Toast notification component
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from './ui/icon-symbol';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

let toastState: ToastState = { visible: false, message: '', type: 'info' };
let setToastState: ((state: ToastState) => void) | null = null;

export function showToast(message: string, type: ToastType = 'info') {
  if (setToastState) {
    setToastState({ visible: true, message, type });
  }
}

export function Toast() {
  const { colors } = useTheme();
  const [state, setState] = useState<ToastState>({ visible: false, message: '', type: 'info' });
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    setToastState = setState;
    return () => {
      setToastState = null;
    };
  }, []);

  useEffect(() => {
    if (state.visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
        }),
      ]).start();

      const timer = setTimeout(() => {
        hideToast();
      }, 3000);

      return () => clearTimeout(timer);
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [state.visible]);

  const hideToast = () => {
    setState((prev) => ({ ...prev, visible: false }));
  };

  if (!state.visible) return null;

  const getToastColors = () => {
    switch (state.type) {
      case 'success':
        return { bg: colors.success, icon: 'checkmark.circle.fill' as const };
      case 'error':
        return { bg: colors.error, icon: 'xmark.circle.fill' as const };
      case 'warning':
        return { bg: colors.warning, icon: 'exclamationmark.triangle.fill' as const };
      default:
        return { bg: colors.info, icon: 'info.circle.fill' as const };
    }
  };

  const toastColors = getToastColors();

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}>
      <View style={[styles.toast, { backgroundColor: toastColors.bg }]}>
        <IconSymbol name={toastColors.icon} size={20} color="#FFFFFF" />
        <Text style={styles.message}>{state.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  message: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

