/**
 * WhatsApp-style exclusive voice-note player for chat.
 * One Sound instance app-wide; lazy-load on play; pause others automatically.
 */

let Audio: any = null;
try {
  Audio = require('expo-av').Audio;
} catch {
  // expo-av unavailable
}

export type ChatVoicePlayerState = {
  activeId: string | null;
  uri: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  error: string | null;
};

type Listener = (state: ChatVoicePlayerState) => void;

const SPEEDS = [1, 1.5, 2] as const;

const initialState: ChatVoicePlayerState = {
  activeId: null,
  uri: null,
  isPlaying: false,
  isLoading: false,
  positionMs: 0,
  durationMs: 0,
  rate: 1,
  error: null,
};

class ChatVoicePlayerController {
  private sound: any = null;
  private listeners = new Set<Listener>();
  private state: ChatVoicePlayerState = { ...initialState };
  private loadToken = 0;
  private feedListeners = new Set<(playing: boolean) => void>();

  isAvailable() {
    return Boolean(Audio);
  }

  getState() {
    return this.state;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Feed/video can pause while a voice note plays. */
  subscribeFeed(listener: (playing: boolean) => void) {
    this.feedListeners.add(listener);
    listener(this.state.isPlaying);
    return () => {
      this.feedListeners.delete(listener);
    };
  }

  private emit() {
    const snapshot = this.state;
    this.listeners.forEach((fn) => fn(snapshot));
    this.feedListeners.forEach((fn) => fn(snapshot.isPlaying));
  }

  private setState(patch: Partial<ChatVoicePlayerState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private async ensurePlaybackMode() {
    if (!Audio) return;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: Audio.InterruptionModeIOS?.DoNotMix ?? 1,
      interruptionModeAndroid: Audio.InterruptionModeAndroid?.DoNotMix ?? 1,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  }

  private async unloadSound() {
    const sound = this.sound;
    this.sound = null;
    if (!sound) return;
    try {
      await sound.stopAsync();
    } catch {
      // ignore
    }
    try {
      await sound.unloadAsync();
    } catch {
      // ignore
    }
  }

  private onStatus = (status: any) => {
    if (!status?.isLoaded) {
      if (status?.error) {
        this.setState({
          isPlaying: false,
          isLoading: false,
          error: String(status.error),
        });
      }
      return;
    }

    const positionMs = Math.max(0, Number(status.positionMillis || 0));
    const durationMs = Math.max(
      this.state.durationMs,
      Number(status.durationMillis || 0)
    );
    const finished = Boolean(status.didJustFinish);

    if (finished) {
      this.setState({
        isPlaying: false,
        isLoading: false,
        positionMs: 0,
        durationMs,
        error: null,
      });
      void this.sound?.setPositionAsync(0).catch(() => {});
      return;
    }

    this.setState({
      isPlaying: Boolean(status.isPlaying),
      isLoading: false,
      positionMs,
      durationMs,
      error: null,
    });
  };

  async toggle(id: string, uri: string, fallbackDurationMs = 0) {
    if (!Audio) {
      this.setState({ error: 'Voice playback needs a development build.' });
      return;
    }
    const cleanUri = String(uri || '').trim();
    if (!cleanUri || !id) return;

    // Same note playing → pause
    if (this.state.activeId === id && this.state.isPlaying) {
      await this.pause();
      return;
    }

    // Same note paused with same (or still-valid) sound → resume
    if (
      this.state.activeId === id &&
      this.sound &&
      (this.state.uri === cleanUri || Boolean(this.state.uri))
    ) {
      // If URI changed (rare), keep playing the already-loaded sound — WhatsApp keeps the local take.
      try {
        await this.ensurePlaybackMode();
        if (this.state.positionMs > 0 && this.state.durationMs > 0) {
          const nearEnd = this.state.positionMs >= this.state.durationMs - 120;
          if (nearEnd) {
            await this.sound.setPositionAsync(0);
            this.setState({ positionMs: 0 });
          }
        }
        if (this.state.rate !== 1) {
          await this.sound.setRateAsync(this.state.rate, true);
        }
        this.setState({ isPlaying: true, isLoading: false, error: null });
        await this.sound.playAsync();
      } catch (error: any) {
        this.setState({
          isPlaying: false,
          isLoading: false,
          error: error?.message || 'Unable to play',
        });
      }
      return;
    }

    // Switch to a different note (or first load)
    const token = ++this.loadToken;
    await this.unloadSound();
    this.setState({
      activeId: id,
      uri: cleanUri,
      isPlaying: false,
      isLoading: true,
      positionMs: 0,
      durationMs: Math.max(0, fallbackDurationMs),
      rate: 1,
      error: null,
    });

    try {
      await this.ensurePlaybackMode();
      const { sound } = await Audio.Sound.createAsync(
        { uri: cleanUri },
        {
          shouldPlay: true,
          progressUpdateIntervalMillis: 100,
          rate: 1,
          shouldCorrectPitch: true,
        },
        this.onStatus
      );

      if (token !== this.loadToken) {
        await sound.unloadAsync().catch(() => {});
        return;
      }

      this.sound = sound;
      const status = await sound.getStatusAsync();
      const durationMs = status?.isLoaded
        ? Math.max(fallbackDurationMs, Number(status.durationMillis || 0))
        : fallbackDurationMs;
      this.setState({
        isLoading: false,
        isPlaying: Boolean(status?.isLoaded && status.isPlaying),
        durationMs,
        error: null,
      });
    } catch (error: any) {
      if (token !== this.loadToken) return;
      this.sound = null;
      this.setState({
        isPlaying: false,
        isLoading: false,
        error: error?.message || 'Unable to play voice note',
      });
    }
  }

  async pause() {
    if (!this.sound) {
      this.setState({ isPlaying: false, isLoading: false });
      return;
    }
    try {
      await this.sound.pauseAsync();
    } catch {
      // ignore
    }
    this.setState({ isPlaying: false, isLoading: false });
  }

  async stop() {
    this.loadToken += 1;
    await this.unloadSound();
    this.setState({ ...initialState });
  }

  async cycleRate() {
    const idx = SPEEDS.indexOf(this.state.rate as (typeof SPEEDS)[number]);
    const next = SPEEDS[(idx >= 0 ? idx + 1 : 0) % SPEEDS.length];
    this.setState({ rate: next });
    if (this.sound) {
      try {
        await this.sound.setRateAsync(next, true);
      } catch {
        // ignore
      }
    }
    return next;
  }

  getSpeeds() {
    return SPEEDS;
  }
}

export const chatVoicePlayer = new ChatVoicePlayerController();

/** @deprecated use chatVoicePlayer.subscribeFeed */
export function subscribeChatVoicePlaying(listener: (playing: boolean) => void) {
  return chatVoicePlayer.subscribeFeed(listener);
}

export function isChatVoicePlaying() {
  return chatVoicePlayer.getState().isPlaying;
}
