import { useAudioPlayer } from "@/hooks/use-audio-player";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";

interface MarketVideoSurfaceProps {
  active: boolean;
  externalSoundUri?: string | null;
  externalSoundVolume?: number;
  originalAudioVolume?: number;
  showControls?: boolean;
  soundStartMs?: number;
  useOriginalVideoAudio?: boolean;
  videoUri: string;
}

function clampUnitVolume(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

export function MarketVideoSurface({
  active,
  externalSoundUri,
  externalSoundVolume,
  originalAudioVolume,
  showControls = false,
  soundStartMs = 0,
  useOriginalVideoAudio = true,
  videoUri,
}: MarketVideoSurfaceProps) {
  const videoPlayer = useVideoPlayer({ uri: videoUri }, (player) => {
    player.loop = true;
    player.muted = !useOriginalVideoAudio;
    player.volume = clampUnitVolume(
      originalAudioVolume,
      useOriginalVideoAudio ? 1 : 0,
    );
  });
  const audioPlayer = useAudioPlayer(externalSoundUri || null, {
    updateInterval: 500,
  });

  useEffect(() => {
    videoPlayer.loop = true;
    videoPlayer.muted =
      !useOriginalVideoAudio || clampUnitVolume(originalAudioVolume, 0) <= 0;
    videoPlayer.volume = clampUnitVolume(
      originalAudioVolume,
      useOriginalVideoAudio ? 1 : 0,
    );
  }, [originalAudioVolume, useOriginalVideoAudio, videoPlayer]);

  useEffect(() => {
    audioPlayer.loop = true;
    audioPlayer.muted = !externalSoundUri;
    audioPlayer.volume = clampUnitVolume(
      externalSoundVolume,
      externalSoundUri ? 0.9 : 0,
    );
  }, [audioPlayer, externalSoundUri, externalSoundVolume]);

  useEffect(() => {
    if (!active) {
      videoPlayer.pause();
      videoPlayer.currentTime = 0;
      audioPlayer.pause();
      audioPlayer.currentTime = Math.max(0, soundStartMs) / 1000;
      return;
    }

    videoPlayer.currentTime = 0;
    videoPlayer.play();

    if (externalSoundUri) {
      audioPlayer.currentTime = Math.max(0, soundStartMs) / 1000;
      audioPlayer.play();
    } else {
      audioPlayer.pause();
      audioPlayer.currentTime = 0;
    }
  }, [active, audioPlayer, externalSoundUri, soundStartMs, videoPlayer]);

  return (
    <View style={styles.container}>
      <VideoView
        player={videoPlayer}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={showControls}
        allowsFullscreen={showControls}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
  },
});
