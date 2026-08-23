import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import React, { useEffect, useRef } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

function runOnPlayer(player: VideoPlayer, fn: () => void) {
  try {
    fn();
  } catch {
    // Native player may already be released during feed recycle / unmount.
  }
}

export interface VideoPlaybackSnapshot {
  currentTimeSec: number;
  durationSec: number;
}

interface MarketVideoSurfaceProps {
  active: boolean;
  /** User paused while still on this post — keeps scrub position */
  paused?: boolean;
  muted?: boolean;
  showControls?: boolean;
  videoUri: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: 'cover' | 'contain';
  onPlaybackSnapshot?: (snapshot: VideoPlaybackSnapshot) => void;
  onFirstFrame?: () => void;
  /** @deprecated Ignored — videos play their own audio only. */
  externalSoundUri?: string | null;
  /** @deprecated Ignored */
  externalSoundVolume?: number;
  /** @deprecated Ignored */
  originalAudioVolume?: number;
  /** @deprecated Ignored */
  soundStartMs?: number;
  /** @deprecated Ignored */
  useOriginalVideoAudio?: boolean;
}

export const MarketVideoSurface = React.memo(function MarketVideoSurface({
  active,
  paused = false,
  muted = false,
  showControls = false,
  videoUri,
  style,
  contentFit = 'cover',
  onPlaybackSnapshot,
  onFirstFrame,
}: MarketVideoSurfaceProps) {
  const mountedRef = useRef(true);
  const firstFrameSentRef = useRef(false);
  const wasActiveRef = useRef(false);
  const onPlaybackSnapshotRef = useRef(onPlaybackSnapshot);
  onPlaybackSnapshotRef.current = onPlaybackSnapshot;
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;

  const videoPlayer = useVideoPlayer({ uri: videoUri }, (player) => {
    if (!mountedRef.current) return;
    player.loop = true;
    player.muted = muted;
    player.volume = muted ? 0 : 1;
  });

  useEffect(() => {
    if (!mountedRef.current) return;
    runOnPlayer(videoPlayer, () => {
      videoPlayer.loop = true;
      videoPlayer.muted = muted;
      videoPlayer.volume = muted ? 0 : 1;
    });
  }, [muted, videoPlayer]);

  useEffect(() => {
    if (!mountedRef.current) return;

    // Left the feed slot — reset so next visit starts from the top
    if (!active) {
      wasActiveRef.current = false;
      runOnPlayer(videoPlayer, () => {
        videoPlayer.pause();
        videoPlayer.currentTime = 0;
      });
      firstFrameSentRef.current = false;
      return;
    }

    // Still on this post but user paused — keep position
    if (paused) {
      runOnPlayer(videoPlayer, () => {
        videoPlayer.pause();
      });
      return;
    }

    runOnPlayer(videoPlayer, () => {
      // Only seek to start when first becoming active (scroll-in), not on resume from pause
      if (!wasActiveRef.current) {
        videoPlayer.currentTime = 0;
      }
      wasActiveRef.current = true;
      videoPlayer.play();
    });
  }, [active, paused, videoPlayer]);

  useEffect(() => {
    if (!onPlaybackSnapshotRef.current && !onFirstFrameRef.current) return undefined;
    const interval = setInterval(() => {
      try {
        const currentTimeSec = Math.max(0, Number(videoPlayer.currentTime || 0));
        const durationSec = Math.max(0, Number(videoPlayer.duration || 0));
        onPlaybackSnapshotRef.current?.({ currentTimeSec, durationSec });
        if (!firstFrameSentRef.current && (currentTimeSec > 0.05 || durationSec > 0)) {
          firstFrameSentRef.current = true;
          onFirstFrameRef.current?.();
        }
      } catch {
        // ignore player read errors during teardown
      }
    }, 250);
    return () => clearInterval(interval);
  }, [videoPlayer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!videoUri) {
    return <View style={[styles.container, style]} pointerEvents="none" />;
  }

  return (
    <View style={[styles.container, style]} pointerEvents="none">
      <VideoView
        key={videoUri}
        player={videoPlayer}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
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
