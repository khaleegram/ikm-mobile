import { useEffect, useMemo, useRef } from "react";

let Audio: any = null;
try {
  Audio = require("expo-av").Audio;
} catch {
  // expo-av not available, audio will be disabled
}

type AudioPlayer = {
  loop: boolean;
  muted: boolean;
  volume: number;
  currentTime: number;
  play: () => Promise<void>;
  pause: () => Promise<void>;
};

type UseAudioPlayerOptions = {
  updateIntervalMs?: number;
};

export function useAudioPlayer(sourceUri: string | null, options?: UseAudioPlayerOptions): AudioPlayer {
  const soundRef = useRef<Audio.Sound | null>(null);
  const stateRef = useRef({
    loop: false,
    muted: false,
    volume: 1,
    currentTime: 0,
  });
  const optionsRef = useRef<UseAudioPlayerOptions>({});
  optionsRef.current = options || {};

  useEffect(() => {
    if (!Audio) return; // Skip if expo-av not available

    let isActive = true; // avoid race on unmount

    const unloadCurrentSound = async () => {
      if (!soundRef.current) return;
      try {
        await soundRef.current.stopAsync();
      } catch {
        // ignore if already stopped/invalid
      }
      try {
        await soundRef.current.unloadAsync();
      } catch {
        // ignore unload errors
      }
      soundRef.current = null;
    };

    const loadSound = async () => {
      await unloadCurrentSound();

      if (!sourceUri) {
        return;
      }

      try {
        const progressIntervalMs = Math.max(250, Number(optionsRef.current.updateIntervalMs || 500));
        const { sound } = await Audio.Sound.createAsync(
          { uri: sourceUri },
          {
            shouldPlay: false,
            isLooping: stateRef.current.loop,
            isMuted: stateRef.current.muted,
            volume: stateRef.current.muted ? 0 : stateRef.current.volume,
            positionMillis: Math.round(stateRef.current.currentTime * 1000),
          },
          (status: any) => {
            if (!isActive) return;
            if (!status || status.isLoaded !== true) return;
            // Throttle updates a bit by relying on expo-av's progressUpdateIntervalMillis.
            if (typeof status.positionMillis === "number") {
              stateRef.current.currentTime = Math.max(0, status.positionMillis / 1000);
            }
          }
        );

        try {
          await sound.setProgressUpdateIntervalAsync(progressIntervalMs);
        } catch {
          // ignore
        }

        if (!isActive) {
          await sound.unloadAsync();
          return;
        }

        soundRef.current = sound;
      } catch {
        // Neutral fallback: continue without sound
        soundRef.current = null;
      }
    };

    loadSound();

    return () => {
      isActive = false;
      unloadCurrentSound();
    };
  }, [sourceUri]);

  const player = useMemo<AudioPlayer>(() => {
    if (!Audio) {
      // Return no-op player when expo-av is not available
      return {
        loop: false,
        muted: false,
        volume: 1,
        currentTime: 0,
        play: async () => {},
        pause: async () => {},
      };
    }

    const setLoop = async (value: boolean) => {
      stateRef.current.loop = value;
      if (soundRef.current) {
        try {
          await soundRef.current.setIsLoopingAsync(value);
        } catch {
          // ignore
        }
      }
    };

    const setMuted = async (value: boolean) => {
      stateRef.current.muted = value;
      if (soundRef.current) {
        try {
          await soundRef.current.setIsMutedAsync(value);
          if (!value) {
            await soundRef.current.setVolumeAsync(stateRef.current.volume);
          }
        } catch {
          // ignore
        }
      }
    };

    const setVolume = async (value: number) => {
      const volumeValue = Math.max(0, Math.min(1, value));
      stateRef.current.volume = volumeValue;
      if (soundRef.current && !stateRef.current.muted) {
        try {
          await soundRef.current.setVolumeAsync(volumeValue);
        } catch {
          // ignore
        }
      }
    };

    const setCurrentTime = async (value: number) => {
      const secs = Math.max(0, value);
      stateRef.current.currentTime = secs;
      if (soundRef.current) {
        try {
          await soundRef.current.setPositionAsync(Math.round(secs * 1000));
        } catch {
          // ignore
        }
      }
    };

    return {
      get loop() {
        return stateRef.current.loop;
      },
      set loop(value: boolean) {
        void setLoop(Boolean(value));
      },
      get muted() {
        return stateRef.current.muted;
      },
      set muted(value: boolean) {
        void setMuted(Boolean(value));
      },
      get volume() {
        return stateRef.current.volume;
      },
      set volume(value: number) {
        void setVolume(Number(value));
      },
      get currentTime() {
        return stateRef.current.currentTime;
      },
      set currentTime(value: number) {
        void setCurrentTime(Number(value));
      },
      play: async () => {
        if (!soundRef.current) return;
        try {
          await soundRef.current.playAsync();
        } catch {
          // ignore
        }
      },
      pause: async () => {
        if (!soundRef.current) return;
        try {
          await soundRef.current.pauseAsync();
        } catch {
          // ignore
        }
      },
    };
  }, []);

  return player;
}
