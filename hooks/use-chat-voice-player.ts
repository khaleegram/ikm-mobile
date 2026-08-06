import { useCallback, useEffect, useState } from 'react';

import {
  chatVoicePlayer,
  type ChatVoicePlayerState,
} from '@/lib/chat/voice-player';

export function useChatVoicePlayer(
  id: string,
  uri: string,
  durationSec = 0
) {
  const fallbackMs = Math.max(0, Math.round(durationSec * 1000));
  const [state, setState] = useState<ChatVoicePlayerState>(() => chatVoicePlayer.getState());

  useEffect(() => chatVoicePlayer.subscribe(setState), []);

  const isActive = state.activeId === id;
  const isPlaying = isActive && state.isPlaying;
  const isLoading = isActive && state.isLoading;
  const positionMs = isActive ? state.positionMs : 0;
  const durationMs = Math.max(
    fallbackMs,
    isActive ? state.durationMs : fallbackMs
  );

  const toggle = useCallback(() => {
    void chatVoicePlayer.toggle(id, uri, fallbackMs);
  }, [fallbackMs, id, uri]);

  const pause = useCallback(() => {
    if (chatVoicePlayer.getState().activeId === id) {
      void chatVoicePlayer.pause();
    }
  }, [id]);

  const cycleRate = useCallback(async () => {
    if (!isActive) return 1;
    return chatVoicePlayer.cycleRate();
  }, [isActive]);

  return {
    available: chatVoicePlayer.isAvailable(),
    isActive,
    isPlaying,
    isLoading,
    positionMs,
    durationMs,
    rate: isActive ? state.rate : 1,
    error: isActive ? state.error : null,
    toggle,
    pause,
    cycleRate,
  };
}
