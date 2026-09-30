import React, { memo, useCallback, useId } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { useChatVoicePlayer } from '@/hooks/use-chat-voice-player';
import { formatRelativeTime } from '@/lib/utils/date-format';

import { onLightFill } from './deal-room/utils';

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

  // On the sent voice card (gold) the contents must be dark: white on this gold measures 3.73:1.
  // `onLightFill` is a fixed dark ink because BRAND is a fixed brand colour, not a theme token.
  const cardBg = isSent ? BRAND : colors.backgroundSecondary;
  const playBg = isSent ? onLightFill : BRAND;
  const playIcon = '#FFFFFF';
  const trackBg = isSent ? 'rgba(17, 24, 39, 0.24)' : colors.border;
  const fillBg = isSent ? onLightFill : BRAND;
  const muted = isSent ? 'rgba(17, 24, 39, 0.66)' : colors.textSecondary;
  const ink = isSent ? onLightFill : colors.text;
  const cornerStyle = isSent
    ? { borderBottomRightRadius: 3 }
    : { borderBottomLeftRadius: 3 };

  const cardStyle = {
    backgroundColor: cardBg,
    borderColor: failed ? '#E5484D' : isSent ? 'transparent' : colors.border,
    opacity: pending ? 0.92 : 1,
  };

  if (!player.available) {
    return (
      <View style={[styles.card, cornerStyle, cardStyle]}>
        <View style={styles.row}>
          <IconSymbol name="mic.fill" size={15} color={ink} />
          <Text style={[styles.fallbackLabel, { color: ink }]}>Voice note</Text>
          <Text style={[styles.time, { color: muted }]}>{formatClock(totalMs, true)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, cornerStyle, cardStyle]}>
      <View style={styles.row}>
        <AnimatedPressable
          onPress={onPlayPress}
          style={[styles.playBtn, { backgroundColor: playBg }]}
          scaleValue={0.92}
          // The circle stays this small for density; hitSlop keeps the touch target ≥44pt.
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={failed ? 'Retry send' : player.isPlaying ? 'Pause' : 'Play'}>
          {player.isLoading ? (
            <ActivityIndicator size="small" color={playIcon} />
          ) : player.isPlaying ? (
            <IconSymbol name="pause.fill" size={13} color={playIcon} />
          ) : (
            <IconSymbol name="play.fill" size={13} color={playIcon} />
          )}
        </AnimatedPressable>

        <View style={styles.metaCol}>
          <View style={[styles.track, { backgroundColor: trackBg }]}>
            <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: fillBg }]} />
          </View>
          <View style={styles.metaRow}>
            {/* Duration doubles as the speed control, so no permanent "1x" chip costs width. */}
            <AnimatedPressable
              onPress={onSpeedPress}
              scaleValue={0.94}
              style={styles.duration}
              accessibilityRole="button"
              accessibilityLabel={`Playback speed ${player.rate}x. Tap to change.`}>
              <Text style={[styles.time, { color: ink }]}>
                {player.isPlaying ? formatClock(remainingMs, true) : formatClock(totalMs, true)}
              </Text>
              {player.rate !== 1 ? (
                <Text style={[styles.rate, { color: muted }]}>{player.rate}x</Text>
              ) : null}
            </AnimatedPressable>

            {failed ? (
              <Text style={[styles.time, { color: '#E5484D' }]}>Tap to retry</Text>
            ) : pending ? (
              <Text style={[styles.time, { color: muted }]}>Sending…</Text>
            ) : (
              <View style={styles.stamp}>
                <Text style={[styles.time, { color: muted }]}>{formatRelativeTime(createdAt)}</Text>
                {isSent ? <IconSymbol name="checkmark.circle" size={12} color={muted} /> : null}
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  /**
   * Fixed width, one content row, ~40dp tall.
   *
   * A voice note used to be two stacked rows — waveform + duration, then a footer carrying the
   * timestamp and ticks — which cost ~61dp of height and printed the duration twice. WhatsApp
   * gives every voice note the same footprint, so the column reads as a tidy stack instead of
   * ragged varying-width cards.
   */
  card: {
    width: 190,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    // No shadow or elevation — matches the flattened message bubbles.
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  playBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaCol: {
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  track: {
    height: 3,
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
  duration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  time: {
    fontSize: 11,
    fontWeight: '600',
  },
  rate: {
    fontSize: 10,
    fontWeight: '800',
  },
  fallbackLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
});
