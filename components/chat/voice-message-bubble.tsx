import React, { memo, useCallback, useId } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { useChatVoicePlayer } from '@/hooks/use-chat-voice-player';
import { formatRelativeTime } from '@/lib/utils/date-format';

const BRAND = '#A67C52';

type VoiceMessageBubbleProps = {
  uri: string;
  durationSec?: number;
  isSent?: boolean;
  pending?: boolean;
  failed?: boolean;
  createdAt?: any;
  onRetry?: () => void;
  /** Stable id — prefer clientMsgId so upload success does not remount playback. */
  messageKey?: string;
};

function formatClock(msOrSec: number, fromMs = false) {
  const total = Math.max(0, Math.floor(fromMs ? msOrSec / 1000 : msOrSec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const VoiceMessageBubble = memo(function VoiceMessageBubble({
  uri,
  durationSec = 0,
  isSent = false,
  pending = false,
  failed = false,
  createdAt,
  onRetry,
  messageKey,
}: VoiceMessageBubbleProps) {
  const { colors } = useTheme();
  const reactId = useId();
  const playerId = messageKey || `voice-${reactId}`;
  const player = useChatVoicePlayer(playerId, uri, durationSec);

  const totalMs = Math.max(player.durationMs, durationSec * 1000, 1);
  const currentMs = player.isPlaying || player.isActive ? player.positionMs : 0;
  const remainingMs = Math.max(0, totalMs - currentMs);
  const progress = Math.min(1, Math.max(0, currentMs / totalMs));

  const onPlayPress = useCallback(() => {
    if (failed) {
      onRetry?.();
      return;
    }
    if (!player.available) return;
    player.toggle();
  }, [failed, onRetry, player]);

  const onSpeedPress = useCallback(() => {
    if (failed || pending || !player.available) return;
    void player.cycleRate();
  }, [failed, pending, player]);

  const cardBg = isSent ? BRAND : colors.backgroundSecondary;
  const playBg = isSent ? '#FFFFFF' : BRAND;
  const playIcon = isSent ? BRAND : '#FFFFFF';
  const trackBg = isSent ? 'rgba(255,255,255,0.28)' : colors.border;
  const fillBg = isSent ? '#FFFFFF' : BRAND;
  const muted = isSent ? 'rgba(255,255,255,0.78)' : colors.textSecondary;
  const ink = isSent ? '#FFFFFF' : colors.text;
  const cornerStyle = isSent
    ? { borderBottomRightRadius: 4 }
    : { borderBottomLeftRadius: 4 };

  if (!player.available) {
    return (
      <View
        style={[
          styles.card,
          cornerStyle,
          {
            backgroundColor: cardBg,
            borderColor: failed ? '#E5484D' : isSent ? 'transparent' : colors.border,
            opacity: pending ? 0.85 : 1,
          },
        ]}>
        <IconSymbol name="mic.fill" size={16} color={ink} />
        <Text style={[styles.fallbackLabel, { color: ink }]}>Voice note</Text>
        <Text style={[styles.time, { color: muted }]}>{formatClock(totalMs, true)}</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        cornerStyle,
        {
          backgroundColor: cardBg,
          borderColor: failed ? '#E5484D' : isSent ? 'transparent' : colors.border,
          opacity: pending ? 0.92 : 1,
        },
      ]}>
      <View style={styles.row}>
        <AnimatedPressable
          onPress={onPlayPress}
          style={[styles.playBtn, { backgroundColor: playBg }]}
          scaleValue={0.92}
          accessibilityRole="button"
          accessibilityLabel={failed ? 'Retry send' : player.isPlaying ? 'Pause' : 'Play'}>
          {player.isLoading ? (
            <ActivityIndicator size="small" color={playIcon} />
          ) : player.isPlaying ? (
            <IconSymbol name="pause.fill" size={14} color={playIcon} />
          ) : (
            <IconSymbol name="play.fill" size={14} color={playIcon} />
          )}
        </AnimatedPressable>

        <View style={styles.metaCol}>
          <View style={[styles.track, { backgroundColor: trackBg }]}>
            <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: fillBg }]} />
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.time, { color: muted }]}>
              {player.isPlaying ? formatClock(remainingMs, true) : formatClock(totalMs, true)}
            </Text>
            <AnimatedPressable
              onPress={onSpeedPress}
              scaleValue={0.94}
              style={styles.speedChip}
              accessibilityRole="button"
              accessibilityLabel="Playback speed">
              <Text style={[styles.speedText, { color: ink }]}>{player.rate}x</Text>
            </AnimatedPressable>
          </View>
        </View>
      </View>

      <AnimatedPressable
        disabled={!failed}
        onPress={failed ? onRetry : undefined}
        scaleValue={failed ? 0.98 : 1}
        style={styles.footer}>
        <Text style={[styles.footerText, { color: failed ? '#E5484D' : muted }]}>
          {failed ? 'Tap to retry' : pending ? 'Sending…' : formatRelativeTime(createdAt)}
        </Text>
        {isSent && !failed ? (
          pending ? (
            <ActivityIndicator size="small" color={muted} />
          ) : (
            <IconSymbol name="checkmark.circle" size={13} color={muted} />
          )
        ) : null}
      </AnimatedPressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    minWidth: 180,
    maxWidth: 240,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 1 },
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaCol: {
    flex: 1,
    gap: 4,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  time: {
    fontSize: 12,
    fontWeight: '600',
  },
  speedChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  speedText: {
    fontSize: 11,
    fontWeight: '800',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
  footerText: {
    fontSize: 11,
    fontWeight: '600',
  },
  fallbackLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
});
