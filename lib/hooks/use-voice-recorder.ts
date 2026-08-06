import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { chatVoicePlayer } from '@/lib/chat/voice-player';

let Audio: any = null;
try {
  Audio = require('expo-av').Audio;
} catch {
  // expo-av unavailable (Expo Go / missing native module)
}

export const VOICE_MIN_DURATION_MS = 600;
export const VOICE_MAX_DURATION_MS = 120_000;

export type VoiceRecordingResult = {
  uri: string;
  durationMs: number;
  mime: 'audio/m4a';
};

export function isExpoAudioAvailable() {
  return Boolean(Audio);
}

function recordingOptions() {
  if (Platform.OS === 'android' && Audio?.RecordingOptionsPresets?.HIGH_QUALITY) {
    return {
      ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
      android: {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
        extension: '.m4a',
        outputFormat: Audio.AndroidOutputFormat?.MPEG_4 ?? 2,
        audioEncoder: Audio.AndroidAudioEncoder?.AAC ?? 3,
        sampleRate: 44100,
        numberOfChannels: 1,
        bitRate: 128000,
      },
    };
  }
  return Audio.RecordingOptionsPresets.HIGH_QUALITY;
}

export function useVoiceRecorder(options?: {
  onMaxDuration?: (result: VoiceRecordingResult) => void;
}) {
  const recordingRef = useRef<any>(null);
  const startedAtRef = useRef(0);
  const opLockRef = useRef(false);
  const onMaxDurationRef = useRef(options?.onMaxDuration);
  onMaxDurationRef.current = options?.onMaxDuration;

  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

  const restorePlaybackMode = useCallback(async () => {
    if (!Audio) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: Audio.InterruptionModeIOS?.DoNotMix ?? 1,
        interruptionModeAndroid: Audio.InterruptionModeAndroid?.DoNotMix ?? 1,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch {
      // ignore
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!Audio) {
      throw new Error(
        'Voice notes need a development build with expo-av. Rebuild the app to enable recording.'
      );
    }
    if (opLockRef.current || recordingRef.current) {
      throw new Error('Already recording');
    }
    opLockRef.current = true;

    try {
      // WhatsApp-style: stop any playing note before opening the mic session.
      await chatVoicePlayer.stop();

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Microphone permission is required for voice notes.');
      }

      try {
        const leftover = recordingRef.current;
        if (leftover) {
          await leftover.stopAndUnloadAsync();
        }
      } catch {
        // ignore
      }
      recordingRef.current = null;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: Audio.InterruptionModeIOS?.DoNotMix ?? 1,
        interruptionModeAndroid: Audio.InterruptionModeAndroid?.DoNotMix ?? 1,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await Audio.Recording.createAsync(recordingOptions());
      recordingRef.current = recording;
      startedAtRef.current = Date.now();
      setDurationMs(0);
      setIsRecording(true);
    } catch (error) {
      recordingRef.current = null;
      setIsRecording(false);
      setDurationMs(0);
      await restorePlaybackMode();
      throw error;
    } finally {
      opLockRef.current = false;
    }
  }, [restorePlaybackMode]);

  const finalizeRecording = useCallback(
    async (mode: 'stop' | 'cancel'): Promise<VoiceRecordingResult | null> => {
      if (opLockRef.current) {
        // Wait briefly for start/stop handoff rather than dropping the take.
        await new Promise((r) => setTimeout(r, 40));
      }
      const recording = recordingRef.current;
      if (!recording) {
        setIsRecording(false);
        setDurationMs(0);
        await restorePlaybackMode();
        return null;
      }

      opLockRef.current = true;
      recordingRef.current = null;
      setIsRecording(false);

      try {
        let statusBefore: any = null;
        try {
          statusBefore = await recording.getStatusAsync();
        } catch {
          statusBefore = null;
        }

        await recording.stopAndUnloadAsync();

        if (mode === 'cancel') {
          setDurationMs(0);
          await restorePlaybackMode();
          return null;
        }

        const uri = recording.getURI();
        const fromStatus = Number(statusBefore?.durationMillis || 0);
        const fromClock = Math.max(0, Date.now() - startedAtRef.current);
        const duration = Math.min(
          VOICE_MAX_DURATION_MS,
          fromStatus > 0 ? fromStatus : fromClock
        );
        setDurationMs(0);
        // Await session restore so the next play/send does not hit a recording-locked route.
        await restorePlaybackMode();
        if (!uri) return null;
        return { uri, durationMs: duration, mime: 'audio/m4a' };
      } catch {
        setDurationMs(0);
        await restorePlaybackMode();
        return null;
      } finally {
        opLockRef.current = false;
      }
    },
    [restorePlaybackMode]
  );

  const stopRecording = useCallback(
    () => finalizeRecording('stop'),
    [finalizeRecording]
  );

  const cancelRecording = useCallback(async () => {
    await finalizeRecording('cancel');
  }, [finalizeRecording]);

  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      const elapsed = Math.max(0, Date.now() - startedAtRef.current);
      setDurationMs(elapsed);
      if (elapsed >= VOICE_MAX_DURATION_MS) {
        void (async () => {
          const result = await stopRef.current();
          if (result) onMaxDurationRef.current?.(result);
        })();
      }
    }, 200);
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state !== 'active' && recordingRef.current) {
        void finalizeRecording('cancel');
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [finalizeRecording]);

  return {
    isRecording,
    durationMs,
    durationSec: Math.max(0, Math.round(durationMs / 1000)),
    startRecording,
    stopRecording,
    cancelRecording,
    isAvailable: isExpoAudioAvailable(),
  };
}
