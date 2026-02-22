import React from 'react';
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';

import { styles } from './styles';
import { lightBrown } from './utils';

type OfferModalProps = {
  colors: any;
  offerAmount: string;
  offerNote: string;
  onChangeOfferAmount: (value: string) => void;
  onChangeOfferNote: (value: string) => void;
  onClose: () => void;
  onSendOffer: () => void;
  sendingOffer: boolean;
  visible: boolean;
};

export function OfferModal({
  colors,
  offerAmount,
  offerNote,
  onChangeOfferAmount,
  onChangeOfferNote,
  onClose,
  onSendOffer,
  sendingOffer,
  visible,
}: OfferModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.offerModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.offerModalHeader}>
            <Text style={[styles.offerModalTitle, { color: colors.text }]}>Send Final Offer</Text>
            <TouchableOpacity onPress={onClose}>
              <IconSymbol name="xmark.circle.fill" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.offerLabel, { color: colors.textSecondary }]}>Offer Amount (NGN)</Text>
          <TextInput
            value={offerAmount}
            onChangeText={onChangeOfferAmount}
            keyboardType="numeric"
            placeholder="e.g. 12000"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.offerInput,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />

          <Text style={[styles.offerLabel, styles.offerSpacingTop, { color: colors.textSecondary }]}>
            Optional Note
          </Text>
          <TextInput
            value={offerNote}
            onChangeText={onChangeOfferNote}
            placeholder="Add packaging or pickup details"
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[
              styles.offerInput,
              styles.offerNoteInput,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />

          <TouchableOpacity
            style={[
              styles.offerSubmitButton,
              {
                backgroundColor: lightBrown,
                opacity: sendingOffer ? 0.6 : 1,
              },
            ]}
            disabled={sendingOffer}
            onPress={onSendOffer}>
            {sendingOffer ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.offerSubmitText}>Send Offer</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
