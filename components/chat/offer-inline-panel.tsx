import React, { memo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const lightBrown = '#A67C52';

type OfferInlinePanelProps = {
  visible: boolean;
  colors: any;
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
  offerAmount,
  offerNote,
  sending = false,
  onChangeOfferAmount,
  onChangeOfferNote,
  onSend,
  onClose,
}: OfferInlinePanelProps) {
  if (!visible) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Send offer</Text>
        <TouchableOpacity onPress={onClose}>
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
          <Text style={styles.sendText}>Send offer</Text>
        )}
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
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
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
  },
  close: {
    fontSize: 13,
    fontWeight: '700',
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
