import React from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';

import { styles } from './styles';
import { lightBrown } from './utils';

type ChatComposerProps = {
  colors: any;
  keyboardVisible: boolean;
  messageText: string;
  onChangeMessageText: (value: string) => void;
  onFocusInput: () => void;
  onOpenOffer: () => void;
  onPickImage: () => void;
  onSend: () => void;
  sending: boolean;
  showInlineOfferCta: boolean;
  insetBottom: number;
};

export function ChatComposer({
  colors,
  insetBottom,
  keyboardVisible,
  messageText,
  onChangeMessageText,
  onFocusInput,
  onOpenOffer,
  onPickImage,
  onSend,
  sending,
  showInlineOfferCta,
}: ChatComposerProps) {
  const hasMessage = Boolean(messageText.trim());

  return (
    <View
      style={[
        styles.inputContainer,
        {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: keyboardVisible ? 0 : insetBottom + 12,
        },
      ]}>
      {showInlineOfferCta ? (
        <TouchableOpacity
          style={[styles.inlineOfferButton, { backgroundColor: lightBrown }]}
          onPress={onOpenOffer}>
          <IconSymbol name="dollarsign.circle.fill" size={16} color="#FFFFFF" />
          <Text style={styles.inlineOfferButtonText}>Buyer asked for price. Send Offer</Text>
        </TouchableOpacity>
      ) : null}

      <AnimatedPressable
        style={[styles.imageButton, { backgroundColor: colors.backgroundSecondary }]}
        onPress={onPickImage}
        scaleValue={0.9}>
        <IconSymbol name="photo" size={24} color={colors.text} />
      </AnimatedPressable>

      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.border,
          },
        ]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="Type a message..."
          placeholderTextColor={colors.textSecondary}
          value={messageText}
          onChangeText={onChangeMessageText}
          onFocus={onFocusInput}
          multiline
          maxLength={1000}
        />
      </View>

      <AnimatedPressable
        style={[
          styles.sendButton,
          {
            backgroundColor: hasMessage ? lightBrown : colors.backgroundSecondary,
            opacity: hasMessage ? 1 : 0.5,
          },
        ]}
        onPress={onSend}
        disabled={!hasMessage}
        scaleValue={0.9}>
        {sending ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <IconSymbol name="paperplane.fill" size={20} color="#FFFFFF" />
        )}
      </AnimatedPressable>
    </View>
  );
}
