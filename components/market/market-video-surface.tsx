import { useAudioPlayer } from "@/hooks/use-audio-player";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useRef } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

export interface VideoPlaybackSnapshot {
  currentTimeSec: number;
  durationSec: number;
}

interface MarketVideoSurfaceProps {
  active: boolean;
  externalSoundUri?: string | null;
  externalSoundVolume?: number;
  originalAudioVolume?: number;
  showControls?: boolean;
  soundStartMs?: number;
  useOriginalVideoAudio?: boolean;
  videoUri: string;
  style?: StyleProp<ViewStyle>;
  onPlaybackSnapshot?: (snapshot: VideoPlaybackSnapshot) => void;
}

function clampUnitVolume(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

export const MarketVideoSurface = React.memo(function MarketVideoSurface({
  active,
  externalSoundUri,
  externalSoundVolume,
  originalAudioVolume,
  showControls = false,
  soundStartMs = 0,
  useOriginalVideoAudio = true,
  videoUri,
  style,
  onPlaybackSnapshot,
}: MarketVideoSurfaceProps) {
  const mountedRef = useRef(true);
  const onPlaybackSnapshotRef = useRef(onPlaybackSnapshot);
  onPlaybackSnapshotRef.current = onPlaybackSnapshot;
  const videoPlayer = useVideoPlayer({ uri: videoUri }, (player) => {
    if (!mountedRef.current) return;
    player.loop = true;
    player.muted = !useOriginalVideoAudio;
    player.volume = clampUnitVolume(
      originalAudioVolume,
      useOriginalVideoAudio ? 1 : 0,
    );
  });
  const audioPlayer = useAudioPlayer(externalSoundUri || null, {
    updateIntervalMs: 500,
  });

  useEffect(() => {
    if (!mountedRef.current) return;
    videoPlayer.loop = true;
    videoPlayer.muted =
      !useOriginalVideoAudio || clampUnitVolume(originalAudioVolume, 0) <= 0;
    videoPlayer.volume = clampUnitVolume(
      originalAudioVolume,
      useOriginalVideoAudio ? 1 : 0,
    );
  }, [originalAudioVolume, useOriginalVideoAudio, videoPlayer]);

  useEffect(() => {
    if (!mountedRef.current) return;
    audioPlayer.loop = true;
    audioPlayer.muted = !externalSoundUri;
    audioPlayer.volume = clampUnitVolume(
      externalSoundVolume,
      externalSoundUri ? 0.9 : 0,
    );
  }, [audioPlayer, externalSoundUri, externalSoundVolume]);

  useEffect(() => {
    if (!mountedRef.current) return;
    if (!active) {
      try {
        videoPlayer.pause();
        videoPlayer.currentTime = 0;
      } catch {}
      try {
        audioPlayer.pause();
        audioPlayer.currentTime = Math.max(0, soundStartMs) / 1000;
      } catch {}
      return;
    }

    try {
      videoPlayer.currentTime = 0;
      videoPlayer.play();
    } catch {}

    if (externalSoundUri) {
      try {
        audioPlayer.currentTime = Math.max(0, soundStartMs) / 1000;
        audioPlayer.play();
      } catch {}
    } else {
      try {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
      } catch {}
    }
  }, [active, audioPlayer, externalSoundUri, soundStartMs, videoPlayer]);

  useEffect(() => {
    if (!onPlaybackSnapshotRef.current) return undefined;
    const interval = setInterval(() => {
      try {
        const currentTimeSec = Math.max(0, Number(videoPlayer.currentTime || 0));
        const durationSec = Math.max(0, Number(videoPlayer.duration || 0));
        onPlaybackSnapshotRef.current?.({ currentTimeSec, durationSec });
      } catch {
        // ignore player read errors during teardown
      }
    }, 500);
    return () => clearInterval(interval);
  }, [videoPlayer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { videoPlayer.pause(); } catch {}
      try { audioPlayer.pause(); } catch {}
    };
  }, []);

  return (
    <View style={[styles.container, style]}>
      <VideoView
        player={videoPlayer}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={showControls}
        fullscreenOptions={{ presentation: showControls ? 'fullScreen' : 'contained' }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },
});
