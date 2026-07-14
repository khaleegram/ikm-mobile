/**
 * Exclusive chat voice playback + feed pause coordination.
 * Only one voice note plays at a time; feed video yields while a note plays.
 */

type PauseListener = (playing: boolean) => void;

let activePlayerId: string | null = null;
const pauseHandlers = new Map<string, () => void>();
const feedListeners = new Set<PauseListener>();
let voicePlaying = false;

function emitFeed(playing: boolean) {
  voicePlaying = playing;
  feedListeners.forEach((fn) => fn(playing));
}

export function isChatVoicePlaying() {
  return voicePlaying;
}

export function subscribeChatVoicePlaying(listener: PauseListener) {
  feedListeners.add(listener);
  listener(voicePlaying);
  return () => {
    feedListeners.delete(listener);
  };
}

export function registerChatVoicePlayer(id: string, onForcePause: () => void) {
  pauseHandlers.set(id, onForcePause);
  return () => {
    pauseHandlers.delete(id);
    if (activePlayerId === id) {
      activePlayerId = null;
      emitFeed(false);
    }
  };
}

/** Call before starting playback — pauses every other registered player. */
export function claimChatVoicePlayback(id: string) {
  pauseHandlers.forEach((pause, otherId) => {
    if (otherId !== id) pause();
  });
  activePlayerId = id;
  emitFeed(true);
}

export function releaseChatVoicePlayback(id: string) {
  if (activePlayerId === id) {
    activePlayerId = null;
    emitFeed(false);
  }
}
