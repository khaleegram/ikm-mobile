import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';

const ACCENT = '#A67C52';
const DANGER = '#B91C1C';

export type DealSheetAction = {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  tone?: 'default' | 'danger' | 'success';
  onPress: () => void;
};

type DealActionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** One line of context so the buttons don't need explaining. */
  note?: string;
  actions: DealSheetAction[];
};

function toneColor(tone: DealSheetAction['tone'], fallback: string) {
  if (tone === 'danger') return DANGER;
  if (tone === 'success') return '#10B981';
  return fallback;
}

/**
 * Bottom sheet for every deal action that isn't the current phase's primary step.
 * Keeps the chat window free of stacked button walls.
 */
export function DealActionsSheet({
  visible,
  onClose,
  title = 'Deal actions',
  note,
  actions,
}: DealActionsSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close deal actions" />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12) + 8,
            },
          ]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <IconSymbol name="xmark" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {note ? (
            <Text style={[styles.note, { color: colors.textSecondary }]}>{note}</Text>
          ) : null}

          {actions.map((action, index) => (
            <TouchableOpacity
              key={action.id}
              style={[
                styles.row,
                index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null,
              ]}
              activeOpacity={0.7}
              onPress={action.onPress}>
              {action.icon ? (
                <IconSymbol
                  name={action.icon as any}
                  size={18}
                  color={toneColor(action.tone, ACCENT)}
                />
              ) : (
                <View style={styles.iconSpacer} />
              )}
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: toneColor(action.tone, colors.text) }]}>
                  {action.label}
                </Text>
                {action.hint ? (
                  <Text style={[styles.rowHint, { color: colors.textSecondary }]}>{action.hint}</Text>
                ) : null}
              </View>
              <IconSymbol name="chevron.right" size={13} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 14,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
  },
  closeBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    minHeight: 52,
  },
  iconSpacer: {
    width: 18,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowHint: {
    fontSize: 11.5,
    fontWeight: '500',
    lineHeight: 15,
  },
});
