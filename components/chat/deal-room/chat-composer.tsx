import React from 'react';
import { ActivityIndicator, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AnimatedPressable } from '@/components/animated-pressable';
import { ChatVoiceRecorder } from '@/components/chat/chat-voice-recorder';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { VoiceRecordingResult } from '@/lib/hooks/use-voice-recorder';

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
  inlineOfferCtaLabel?: string;
  showOfferAction?: boolean;
  offerActionLabel?: string;
  onInputFocus?: () => void;
  insetBottom: number;
  enableVoice?: boolean;
  voiceBusy?: boolean;
  voiceDisabled?: boolean;
  onVoiceRecorded?: (result: VoiceRecordingResult) => void;
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
  inlineOfferCtaLabel = 'Send offer',
  showOfferAction = false,
  offerActionLabel = 'Make offer',
  onInputFocus,
  enableVoice = false,
  voiceBusy = false,
  voiceDisabled = false,
  onVoiceRecorded,
}: ChatComposerProps) {
  const hasMessage = Boolean(messageText.trim());
  const [isRecordingVoice, setIsRecordingVoice] = React.useState(false);
  const showMic = enableVoice && !hasMessage;

  return (
    <View
      style={[
        styles.composerShell,
        {
          paddingBottom: insetBottom + (Platform.OS === 'ios' ? 6 : 8),
        },
      ]}>
      {showInlineOfferCta && !isRecordingVoice ? (
        <TouchableOpacity
          style={[styles.inlineOfferButton, { backgroundColor: lightBrown }]}
          onPress={onOpenOffer}
          activeOpacity={0.88}>
          <IconSymbol name="dollarsign.circle.fill" size={18} color="#FFFFFF" />
          <Text style={styles.inlineOfferButtonText}>{inlineOfferCtaLabel}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.composerRow}>
        {/* Keep idle controls mounted while recording so Android doesn't cancel the hold gesture. */}
        <View
          style={[
            styles.composerIdleCluster,
            isRecordingVoice ? styles.composerIdleClusterHidden : null,
          ]}
          pointerEvents={isRecordingVoice ? 'none' : 'auto'}>
          {/* The input keeps its own rounded field; the attach and offer icons sit beside it on
              the chat background. There is no container card behind the whole row. */}
          <View
            style={[
              styles.composerField,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: hasMessage ? `${lightBrown}66` : 'transparent',
              },
            ]}>
            <TextInput
              style={[styles.composerInput, { color: colors.text }]}
              placeholder="Message…"
              placeholderTextColor={colors.textSecondary}
              value={messageText}
              onChangeText={onChangeMessageText}
              onFocus={onInputFocus}
              multiline
              maxLength={1000}
              editable={!isRecordingVoice}
            />
          </View>

          <AnimatedPressable
            style={styles.fieldIcon}
            onPress={onPickImage}
            scaleValue={0.9}
            accessibilityLabel="Attach photo">
            <IconSymbol name="photo" size={21} color={colors.textSecondary} />
          </AnimatedPressable>

          {showOfferAction ? (
            <AnimatedPressable
              style={styles.fieldIcon}
              onPress={onOpenOffer}
              scaleValue={0.9}
              accessibilityRole="button"
              accessibilityLabel={offerActionLabel}>
              <IconSymbol name="dollarsign.circle.fill" size={21} color={lightBrown} />
            </AnimatedPressable>
          ) : null}
        </View>

        {showMic ? (
          <View
            style={[
              styles.voiceSlot,
              isRecordingVoice ? styles.voiceSlotRecording : null,
            ]}>
            <ChatVoiceRecorder
              busy={voiceBusy}
              disabled={voiceDisabled}
              mutedTextColor={colors.textSecondary}
              onRecordingChange={setIsRecordingVoice}
              onRecorded={(result) => {
                setIsRecordingVoice(false);
                onVoiceRecorded?.(result);
              }}
            />
          </View>
        ) : (
          <AnimatedPressable
            style={[
              styles.circleAction,
              styles.sendCircle,
              {
                backgroundColor: hasMessage ? lightBrown : colors.backgroundSecondary,
              },
            ]}
            onPress={onSend}
            disabled={!hasMessage || sending}
            scaleValue={0.92}>
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconSymbol
                name="paperplane.fill"
                size={19}
                color={hasMessage ? '#FFFFFF' : colors.textSecondary}
              />
            )}
          </AnimatedPressable>
        )}
      </View>
    </View>
  );
}
