import React from 'react';
import { ActivityIndicator, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';

import { styles } from './styles';
import { lightBrown } from './utils';

type ChatComposerProps = {
  colors: any;
  messageText: string;
  onChangeMessageText: (value: string) => void;
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
  messageText,
  onChangeMessageText,
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
        styles.composerShell,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: insetBottom + (Platform.OS === 'ios' ? 10 : 12),
        },
      ]}>
      <View
        style={[
          styles.composerInner,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}>
        {showInlineOfferCta ? (
          <TouchableOpacity
            style={[styles.inlineOfferButton, { backgroundColor: lightBrown }]}
            onPress={onOpenOffer}
            activeOpacity={0.88}>
            <IconSymbol name="dollarsign.circle.fill" size={18} color="#FFFFFF" />
            <Text style={styles.inlineOfferButtonText}>Buyer asked for price — send offer</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.composerRow}>
          <AnimatedPressable
            style={[styles.circleAction, { backgroundColor: colors.backgroundSecondary }]}
            onPress={onPickImage}
            scaleValue={0.92}>
            <IconSymbol name="photo" size={22} color={colors.text} />
          </AnimatedPressable>

          <View
            style={[
              styles.inputIsland,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: hasMessage ? `${lightBrown}66` : colors.border,
              },
            ]}>
            <TextInput
              style={[styles.composerInput, { color: colors.text }]}
              placeholder="Message…"
              placeholderTextColor={colors.textSecondary}
              value={messageText}
              onChangeText={onChangeMessageText}
              multiline
              maxLength={1000}
            />
          </View>

          <AnimatedPressable
            style={[
              styles.circleAction,
              styles.sendCircle,
              {
                backgroundColor: hasMessage ? lightBrown : colors.backgroundSecondary,
              },
            ]}
            onPress={onSend}
            disabled={!hasMessage}
            scaleValue={0.92}>
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconSymbol name="paperplane.fill" size={20} color={hasMessage ? '#FFFFFF' : colors.textSecondary} />
            )}
          </AnimatedPressable>
        </View>
      </View>
    </View>
  );
}
