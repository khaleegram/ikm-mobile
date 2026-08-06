import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { haptics } from '@/lib/utils/haptics';
import {
  isExpoAudioAvailable,
  useVoiceRecorder,
  VOICE_MIN_DURATION_MS,
  type VoiceRecordingResult,
} from '@/lib/hooks/use-voice-recorder';
import { Alert } from '@/components/app-alert';

const CANCEL_SLIDE_PX = 72;
const BRAND = '#A67C52';
const ERROR_RED = '#E5484D';

function formatTimer(ms: number) {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type ChatVoiceRecorderProps = {
  disabled?: boolean;
  busy?: boolean;
  mutedTextColor: string;
  onRecorded: (result: VoiceRecordingResult) => void;
  onRecordingChange?: (recording: boolean) => void;
};

/**
 * WhatsApp-style hold-to-record:
 * - UI expands immediately on press
 * - Slide left to arm cancel
 * - Release sends (or cancels); short takes are discarded
 * - Finger-up during native start is queued and applied after start settles
 */
export function ChatVoiceRecorder({
  disabled = false,
  busy = false,
  mutedTextColor,
  onRecorded,
  onRecordingChange,
}: ChatVoiceRecorderProps) {
  const native = isExpoAudioAvailable();
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const onRecordingChangeRef = useRef(onRecordingChange);
  onRecordingChangeRef.current = onRecordingChange;

  const handleMaxDuration = useCallback((result: VoiceRecordingResult) => {
    haptics.success();
    onRecordedRef.current(result);
  }, []);

  const recorder = useVoiceRecorder({ onMaxDuration: handleMaxDuration });
  const startRef = useRef(recorder.startRecording);
  const stopRef = useRef(recorder.stopRecording);
  const cancelRef = useRef(recorder.cancelRecording);
  startRef.current = recorder.startRecording;
  stopRef.current = recorder.stopRecording;
  cancelRef.current = recorder.cancelRecording;

  const [uiRecording, setUiRecording] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const cancelArmedRef = useRef(false);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const activeSessionRef = useRef(false);
  const sessionGenRef = useRef(0);
  const pendingReleaseRef = useRef<'send' | 'cancel' | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  const setRecordingUi = useCallback((next: boolean) => {
    setUiRecording(next);
    onRecordingChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    if (!native || disabled) return;
    void (async () => {
      try {
        const Audio = require('expo-av').Audio;
        await Audio.requestPermissionsAsync();
      } catch {
        // ignore
      }
    })();
  }, [disabled, native]);

  useEffect(() => {
    if (!uiRecording) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 450, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, uiRecording]);

  const finishSession = useCallback(
    async (mode: 'send' | 'cancel', gen: number) => {
      if (finishingRef.current) return;
      if (gen !== sessionGenRef.current) return;

      finishingRef.current = true;
      activeSessionRef.current = false;
      startingRef.current = false;
      pendingReleaseRef.current = null;
      cancelArmedRef.current = false;
      setCancelArmed(false);
      setRecordingUi(false);

      try {
        if (mode === 'cancel') {
          await cancelRef.current();
          haptics.warning();
          return;
        }

        const result = await stopRef.current();
        if (!result) return;
        if (result.durationMs < VOICE_MIN_DURATION_MS) {
          haptics.warning();
          showToast('Hold a bit longer to record a voice note.', 'info');
          return;
        }
        haptics.success();
        onRecordedRef.current(result);
      } finally {
        finishingRef.current = false;
      }
    },
    [setRecordingUi]
  );

  const beginSession = useCallback(async () => {
    if (disabled || busy || startingRef.current || activeSessionRef.current || finishingRef.current) {
      return;
    }
    if (!native) {
      Alert.alert(
        'Voice notes',
        'Voice notes need a development build with expo-av. Rebuild the app to enable recording.'
      );
      return;
    }

    const gen = ++sessionGenRef.current;
    startingRef.current = true;
    activeSessionRef.current = true;
    pendingReleaseRef.current = null;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    setRecordingUi(true);

    try {
      await startRef.current();
      if (gen !== sessionGenRef.current) {
        await cancelRef.current();
        return;
      }
      const pending = pendingReleaseRef.current;
      if (pending) {
        await finishSession(pending, gen);
      }
    } catch (error: any) {
      if (gen === sessionGenRef.current) {
        activeSessionRef.current = false;
        pendingReleaseRef.current = null;
        setRecordingUi(false);
        showToast(error?.message || 'Unable to record', 'error');
      }
    } finally {
      if (gen === sessionGenRef.current) {
        startingRef.current = false;
      }
    }
  }, [busy, disabled, finishSession, native, setRecordingUi]);

  const onSlide = useCallback((dx: number) => {
    if (!activeSessionRef.current) return;
    const next = dx <= -CANCEL_SLIDE_PX;
    if (next !== cancelArmedRef.current) {
      cancelArmedRef.current = next;
      setCancelArmed(next);
      if (next) haptics.selection();
    }
  }, []);

  const onFingerUp = useCallback(() => {
    if (!activeSessionRef.current && !startingRef.current) return;
    const mode: 'send' | 'cancel' = cancelArmedRef.current ? 'cancel' : 'send';
    if (startingRef.current) {
      pendingReleaseRef.current = mode;
      return;
    }
    void finishSession(mode, sessionGenRef.current);
  }, [finishSession]);

  const pan = Gesture.Pan()
    .enabled(!disabled && !busy)
    .minDistance(0)
    .maxPointers(1)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      runOnJS(beginSession)();
    })
    .onUpdate((e) => {
      runOnJS(onSlide)(e.translationX);
    })
    .onFinalize(() => {
      runOnJS(onFingerUp)();
    });

  const showingBar = uiRecording;

  return (
    <GestureDetector gesture={pan}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="button"
        accessibilityLabel="Hold to record voice note"
        style={[
          showingBar ? styles.recordingBar : styles.idleMic,
          showingBar ? { backgroundColor: cancelArmed ? ERROR_RED : BRAND } : null,
          !showingBar && (disabled || busy) ? styles.disabled : null,
          showingBar || Platform.OS === 'android' ? styles.flexHost : null,
        ]}>
        {showingBar ? (
          <>
            <Animated.View style={[styles.pulseDot, { opacity: pulse }]} />
            <Text style={styles.timer}>{formatTimer(recorder.durationMs)}</Text>
            <Text style={styles.hint} numberOfLines={1}>
              {cancelArmed ? 'Release to cancel' : '← Slide to cancel'}
            </Text>
            <View style={styles.micCircle}>
              <IconSymbol name="mic.fill" size={20} color="#FFFFFF" />
            </View>
          </>
        ) : busy ? (
          <ActivityIndicator size="small" color={mutedTextColor} />
        ) : (
          <IconSymbol name="mic" size={22} color={mutedTextColor} />
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  flexHost: {
    flex: 1,
  },
  idleMic: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  disabled: {
    opacity: 0.4,
  },
  recordingBar: {
    flex: 1,
    minHeight: 42,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  timer: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    minWidth: 40,
  },
  hint: {
    flex: 1,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '600',
  },
  micCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
