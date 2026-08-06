import React, { memo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightBrown = '#A67C52';

type OfferInlinePanelProps = {
  visible: boolean;
  colors: any;
  /** Buyer is proposing what they want to pay; seller is quoting a price. */
  role: 'buyer' | 'seller';
  offerAmount: string;
  offerNote: string;
  sending?: boolean;
  onChangeOfferAmount: (value: string) => void;
  onChangeOfferNote: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
};

export const OfferInlinePanel = memo(function OfferInlinePanel({
  visible,
  colors,
  role,
  offerAmount,
  offerNote,
  sending = false,
  onChangeOfferAmount,
  onChangeOfferNote,
  onSend,
  onClose,
}: OfferInlinePanelProps) {
  const insets = useSafeAreaInsets();
  const isBuyer = role === 'buyer';
  const title = isBuyer ? 'Send buying offer' : 'Send offer';
  const subtitle = isBuyer
    ? 'Tell the seller what you want to pay for this item.'
    : 'Propose a price for the buyer.';
  const sendLabel = isBuyer ? 'Send buying offer' : 'Send offer';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss offer">
          <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={styles.dim} />
        </Pressable>

        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={0}
          style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}
          pointerEvents="box-none">
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                  <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={12}>
                  <Text style={[styles.close, { color: colors.textSecondary }]}>Close</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={offerAmount}
                onChangeText={onChangeOfferAmount}
                placeholder="Amount (NGN)"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundSecondary },
                ]}
              />
              <TextInput
                value={offerNote}
                onChangeText={onChangeOfferNote}
                placeholder="Optional note"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundSecondary },
                ]}
              />
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: lightBrown, opacity: sending ? 0.7 : 1 }]}
                onPress={onSend}
                disabled={sending}>
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sendText}>{sendLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  sheetWrap: {
    width: '100%',
  },
  wrap: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  close: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
  },
  sendBtn: {
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
});
