import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';

const ACCENT = '#A67C52';
const DESTRUCTIVE = '#E5484D';

export type AppAlertButtonStyle = 'default' | 'cancel' | 'destructive';

export type AppAlertButton = {
  text: string;
  onPress?: () => void;
  style?: AppAlertButtonStyle;
};

export type AppAlertOptions = {
  cancelable?: boolean;
  onDismiss?: () => void;
};

type AlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  options?: AppAlertOptions;
};

type AlertListener = (request: AlertRequest | null) => void;

let nextId = 1;
let queue: AlertRequest[] = [];
let current: AlertRequest | null = null;
let listener: AlertListener | null = null;

function publish() {
  listener?.(current);
}

function presentNext() {
  if (current || queue.length === 0) {
    publish();
    return;
  }
  current = queue.shift() || null;
  publish();
}

function dismissCurrent() {
  current = null;
  publish();
  // Allow exit animation to settle before next alert
  setTimeout(() => presentNext(), 180);
}

function normalizeButtons(buttons?: AppAlertButton[]): AppAlertButton[] {
  if (!buttons || buttons.length === 0) {
    return [{ text: 'OK', style: 'default' }];
  }
  return buttons.map((button) => ({
    text: button.text || 'OK',
    onPress: button.onPress,
    style: button.style || 'default',
  }));
}

/**
 * Drop-in replacement for React Native `Alert.alert` with styled UI.
 * Keep call sites as `Alert.alert(title, message, buttons)`.
 */
export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: AppAlertButton[],
    options?: AppAlertOptions
  ) {
    const request: AlertRequest = {
      id: nextId++,
      title: String(title || '').trim() || 'Notice',
      message: message != null ? String(message) : undefined,
      buttons: normalizeButtons(buttons),
      options,
    };
    queue.push(request);
    if (!current) presentNext();
    else publish();
  },
};

function inferTone(title: string, buttons: AppAlertButton[]): 'danger' | 'success' | 'auth' | 'info' {
  const hay = `${title} ${buttons.map((b) => b.text).join(' ')}`.toLowerCase();
  if (
    buttons.some((b) => b.style === 'destructive') ||
    /delete|remove|block|logout|log out|sign out|cancel order|destructive/.test(hay)
  ) {
    return 'danger';
  }
  if (/success|saved|updated|published|done/.test(hay)) return 'success';
  if (/sign in|log in|login|permission|required/.test(hay)) return 'auth';
  return 'info';
}

function toneVisual(tone: ReturnType<typeof inferTone>) {
  switch (tone) {
    case 'danger':
      return {
        icon: 'exclamationmark.triangle.fill' as const,
        iconBg: 'rgba(229,72,77,0.14)',
        iconColor: DESTRUCTIVE,
      };
    case 'success':
      return {
        icon: 'checkmark.circle.fill' as const,
        iconBg: 'rgba(52,199,89,0.16)',
        iconColor: '#34C759',
      };
    case 'auth':
      return {
        icon: 'person.crop.circle.badge.exclamationmark.fill' as const,
        iconBg: 'rgba(166,124,82,0.16)',
        iconColor: ACCENT,
      };
    default:
      return {
        icon: 'info.circle.fill' as const,
        iconBg: 'rgba(166,124,82,0.16)',
        iconColor: ACCENT,
      };
  }
}

function sortButtons(buttons: AppAlertButton[]): AppAlertButton[] {
  const rank = (style?: AppAlertButtonStyle) => {
    if (style === 'default') return 0;
    if (style === 'destructive') return 1;
    return 2; // cancel last
  };
  return [...buttons].sort((a, b) => rank(a.style) - rank(b.style));
}

export function AppAlertHost() {
  const { colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [request, setRequest] = useState<AlertRequest | null>(null);
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    listener = (next) => {
      if (next) {
        closingRef.current = false;
        setRequest(next);
        setVisible(true);
      } else {
        setVisible(false);
      }
    };
    publish();
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    scale.setValue(0.92);
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 120, useNativeDriver: true }),
    ]);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [visible, opacity, scale]);

  const runAfterDismiss = useCallback((action?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    dismissCurrent();
    // Modal `visible={false}` cancels exit animations — never gate navigation on `finished`.
    // Defer so the modal can tear down before router.push (otherwise login can no-op).
    if (action) {
      setTimeout(() => {
        try {
          action();
        } catch (error) {
          console.warn('AppAlert action failed:', error);
        }
      }, 80);
    }
  }, []);

  const onBackdrop = useCallback(() => {
    if (!request || closingRef.current) return;
    if (request.options?.cancelable === false) return;
    haptics.light();
    const cancelBtn = request.buttons.find((b) => b.style === 'cancel');
    const dismiss = request.options?.onDismiss;
    runAfterDismiss(() => {
      dismiss?.();
      cancelBtn?.onPress?.();
    });
  }, [request, runAfterDismiss]);

  const onButtonPress = useCallback(
    (button: AppAlertButton) => {
      if (closingRef.current) return;
      if (button.style === 'destructive') haptics.warning();
      else haptics.light();
      const action = button.onPress;
      runAfterDismiss(action);
    },
    [runAfterDismiss]
  );

  const tone = useMemo(
    () => (request ? inferTone(request.title, request.buttons) : 'info'),
    [request]
  );
  const visual = toneVisual(tone);
  const orderedButtons = useMemo(
    () => (request ? sortButtons(request.buttons) : []),
    [request]
  );

  const isDark = colorScheme === 'dark';
  const cardBg = isDark ? '#1C1A17' : '#FFFCF8';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(166,124,82,0.14)';
  const titleColor = isDark ? '#FFF8F0' : '#1A1510';
  const messageColor = isDark ? 'rgba(255,248,240,0.72)' : 'rgba(26,21,16,0.62)';
  const cancelBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(26,21,16,0.05)';

  // Keep the last request mounted briefly while Modal closes
  useEffect(() => {
    if (visible || !request) return;
    const t = setTimeout(() => setRequest(null), 200);
    return () => clearTimeout(t);
  }, [visible, request]);

  if (!request) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onBackdrop}>
      <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <Animated.View style={[styles.backdrop, { opacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onBackdrop} />
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor: border,
              opacity,
              transform: [{ scale }],
            },
          ]}>
          <View style={[styles.iconWrap, { backgroundColor: visual.iconBg }]}>
            <IconSymbol name={visual.icon} size={26} color={visual.iconColor} />
          </View>

          <Text style={[styles.title, { color: titleColor }]}>{request.title}</Text>
          {request.message ? (
            <Text style={[styles.message, { color: messageColor }]}>{request.message}</Text>
          ) : null}

          <View style={styles.actions}>
            {orderedButtons.map((button, index) => {
              const isCancel = button.style === 'cancel';
              const isDestructive = button.style === 'destructive';
              const isPrimary = !isCancel && !isDestructive;

              return (
                <TouchableOpacity
                  key={`${button.text}-${index}`}
                  activeOpacity={0.85}
                  onPress={() => onButtonPress(button)}
                  style={[
                    styles.button,
                    isPrimary && styles.buttonPrimary,
                    isDestructive && styles.buttonDestructive,
                    isCancel && [styles.buttonCancel, { backgroundColor: cancelBg }],
                  ]}>
                  <Text
                    style={[
                      styles.buttonText,
                      isPrimary && styles.buttonTextPrimary,
                      isDestructive && styles.buttonTextDestructive,
                      isCancel && { color: messageColor },
                    ]}>
                    {button.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 10, 8, 0.55)',
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 18,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: 4,
  },
  actions: {
    marginTop: 18,
    gap: 8,
  },
  button: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonPrimary: {
    backgroundColor: ACCENT,
  },
  buttonDestructive: {
    backgroundColor: 'rgba(229,72,77,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(229,72,77,0.28)',
  },
  buttonCancel: {
    backgroundColor: 'transparent',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextPrimary: {
    color: '#FFFFFF',
  },
  buttonTextDestructive: {
    color: DESTRUCTIVE,
  },
});
