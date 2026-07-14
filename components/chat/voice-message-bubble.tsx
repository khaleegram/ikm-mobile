import React, { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
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
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { isExpoAudioAvailable } from '@/lib/hooks/use-voice-recorder';
import {
  claimChatVoicePlayback,
  registerChatVoicePlayer,
  releaseChatVoicePlayback,
} from '@/lib/chat/chat-audio';
import { formatRelativeTime } from '@/lib/utils/date-format';

const BRAND = '#A67C52';
const SPEEDS = [1, 1.5, 2] as const;

type VoiceMessageBubbleProps = {
  uri: string;
  durationSec?: number;
  isSent?: boolean;
  pending?: boolean;
  failed?: boolean;
  createdAt?: any;
  onRetry?: () => void;
};

function formatClock(sec: number) {
  const total = Math.max(0, Math.floor(sec));
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
}: VoiceMessageBubbleProps) {
  const { colors } = useTheme();
  const reactId = useId();
  const playerId = `voice-${reactId}`;
  const player = useAudioPlayer(uri, { updateIntervalMs: 200 });
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const playingRef = useRef(false);

  const totalSec = Math.max(durationSec, 0.01);
  const current = player.currentTime || 0;
  const remaining = Math.max(0, totalSec - current);
  const progress = Math.min(1, Math.max(0, current / totalSec));
  const available = isExpoAudioAvailable();

  const forcePause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    void player.pause();
    releaseChatVoicePlayback(playerId);
  }, [player, playerId]);

  useEffect(() => registerChatVoicePlayer(playerId, forcePause), [forcePause, playerId]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    if (current >= totalSec - 0.05 && current > 0.2) {
      playingRef.current = false;
      setPlaying(false);
      void player.pause();
      player.currentTime = 0;
      releaseChatVoicePlayback(playerId);
    }
  }, [current, playing, player, playerId, totalSec, tick]);

  const togglePlayback = useCallback(async () => {
    if (failed) {
      onRetry?.();
      return;
    }
    if (!available) return;

    if (playingRef.current) {
      forcePause();
      return;
    }

    claimChatVoicePlayback(playerId);
    if (current >= totalSec - 0.08) {
      player.currentTime = 0;
    }
    playingRef.current = true;
    setPlaying(true);
    await player.play();
  }, [available, current, failed, forcePause, onRetry, player, playerId, totalSec]);

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((idx) => {
      const next = (idx + 1) % SPEEDS.length;
      player.rate = SPEEDS[next];
      return next;
    });
  }, [player]);

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

  if (!available) {
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
        <Text style={[styles.time, { color: muted }]}>{formatClock(totalSec)}</Text>
      </View>
    );
  }

  return (
    <AnimatedPressable
      disabled={!failed}
      onPress={failed ? onRetry : undefined}
      scaleValue={failed ? 0.98 : 1}
      style={[
        styles.card,
        cornerStyle,
        {
          backgroundColor: cardBg,
          borderColor: failed ? '#E5484D' : isSent ? 'transparent' : colors.border,
          opacity: pending ? 0.88 : 1,
        },
      ]}>
      <View style={styles.row}>
        <AnimatedPressable
          onPress={togglePlayback}
          style={[styles.playBtn, { backgroundColor: playBg }]}
          scaleValue={0.92}>
          {playing ? (
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
              {playing ? formatClock(remaining) : formatClock(totalSec)}
            </Text>
            <AnimatedPressable onPress={cycleSpeed} scaleValue={0.94} style={styles.speedChip}>
              <Text style={[styles.speedText, { color: ink }]}>{SPEEDS[speedIndex]}x</Text>
            </AnimatedPressable>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
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
      </View>
    </AnimatedPressable>
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
    width: 34,
    height: 34,
    borderRadius: 17,
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
