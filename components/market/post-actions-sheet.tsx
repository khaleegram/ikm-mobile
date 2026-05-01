import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { haptics } from '@/lib/utils/haptics';

const lightBrown = '#A67C52';

interface Action {
  id: string;
  label: string;
  icon: string;
  color?: string;
  destructive?: boolean;
  onPress: () => void;
}

interface PostActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  posterName: string;
  actions: Action[];
}

export function PostActionsSheet({ visible, onClose, posterName, actions }: PostActionsSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(500)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : 500,
      useNativeDriver: true,
      tension: 68,
      friction: 12,
    }).start();
  }, [visible, translateY]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, 12) + 8, transform: [{ translateY }] },
        ]}>
        <View style={styles.handle} />

        {posterName ? (
          <Text style={styles.posterLabel} numberOfLines={1}>
            {posterName}
          </Text>
        ) : null}

        <View style={styles.actions}>
          {actions.map((action, index) => (
            <TouchableOpacity
              key={action.id}
              style={[
                styles.actionRow,
                index < actions.length - 1 && styles.actionBorder,
              ]}
              activeOpacity={0.65}
              onPress={() => {
                haptics.light();
                onClose();
                setTimeout(action.onPress, 120);
              }}>
              <View
                style={[
                  styles.iconBox,
                  { backgroundColor: action.destructive ? 'rgba(255,59,48,0.12)' : 'rgba(255,255,255,0.08)' },
                ]}>
                <IconSymbol
                  name={action.icon as any}
                  size={20}
                  color={action.destructive ? '#FF3B30' : (action.color ?? '#FFFFFF')}
                />
              </View>
              <Text
                style={[
                  styles.actionLabel,
                  action.destructive && styles.actionLabelDestructive,
                ]}>
                {action.label}
              </Text>
              <IconSymbol name="chevron.right" size={16} color="rgba(255,255,255,0.25)" />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignSelf: 'center',
    marginVertical: 10,
  },
  posterLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  actions: {
    marginHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  actionBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  actionLabelDestructive: {
    color: '#FF3B30',
  },
  cancelBtn: {
    marginHorizontal: 14,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    alignItems: 'center',
  },
  cancelText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
