/**
 * The call screen — one surface for every stage of a call.
 *
 * It is deliberately dark regardless of the app theme. Video needs a neutral backdrop, and a call
 * is a full-attention moment: this should not look like another page of the marketplace.
 *
 * Stages, in the order they occur: incoming (accept/decline), outgoing (ringing), connecting
 * (media negotiating), active (live, with the timer), ended (outcome shown briefly).
 */
import React, { memo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';

import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { callManager } from '@/lib/calls/call-manager';
import { useCallStore } from '@/lib/calls/call-store';

const BACKDROP = '#0B1114';
const SURFACE = 'rgba(255,255,255,0.12)';
const DANGER = '#F04438';
const ACCEPT = '#22C55E';

function formatDuration(total: number): string {
  const secs = Math.max(0, Math.floor(total));
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}:${String(mins % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Round control used for every call button, so they read as one family. */
const CallControl = memo(function CallControl({
  icon,
  label,
  onPress,
  active = false,
  destructive = false,
  large = false,
}: {
  icon: React.ComponentProps<typeof IconSymbol>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
  destructive?: boolean;
  large?: boolean;
}) {
  const size = large ? 68 : 58;
  const background = destructive ? DANGER : active ? '#FFFFFF' : SURFACE;
  const tint = destructive ? '#FFFFFF' : active ? '#111827' : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        alignItems: 'center',
        gap: 7,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <IconSymbol name={icon} size={large ? 26 : 22} color={tint} />
      </View>
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500' }}>
        {label}
      </Text>
    </Pressable>
  );
});

export function CallScreen() {
  const insets = useSafeAreaInsets();
  const phase = useCallStore((s) => s.phase);
  const call = useCallStore((s) => s.call);
  const peer = useCallStore((s) => s.peer);
  const kind = useCallStore((s) => s.kind);
  const isCaller = useCallStore((s) => s.isCaller);
  const muted = useCallStore((s) => s.muted);
  const speakerOn = useCallStore((s) => s.speakerOn);
  const cameraOff = useCallStore((s) => s.cameraOff);
  const durationSec = useCallStore((s) => s.durationSec);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const endInfo = useCallStore((s) => s.endInfo);
  const error = useCallStore((s) => s.error);
  const relayMissing = useCallStore((s) => s.relayMissing);

  if (phase === 'idle') return null;

  const isIncoming = phase === 'incoming';
  const isVideo = kind === 'video';
  /** Only show remote video once it is actually flowing; until then the avatar is calmer. */
  const showRemoteVideo = isVideo && Boolean(remoteStream) && phase === 'active';

  const peerName = peer?.name || 'Unknown';
  const initial = peerName.trim().charAt(0).toUpperCase() || '?';

  const statusText = (() => {
    if (error) return error;
    switch (phase) {
      case 'incoming':
        return isVideo ? 'Incoming video call' : 'Incoming voice call';
      case 'outgoing':
        return 'Ringing…';
      case 'connecting':
        return 'Connecting…';
      case 'active':
        return formatDuration(durationSec);
      case 'ended':
        return endInfo?.reason === 'declined'
          ? 'Call declined'
          : endInfo?.reason === 'missed'
            ? 'No answer'
            : endInfo?.reason === 'failed'
              ? 'Call failed'
              : endInfo?.durationSec
                ? `Call ended · ${formatDuration(endInfo.durationSec)}`
                : 'Call ended';
      default:
        return '';
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: BACKDROP }}>
      {showRemoteVideo ? (
        <RTCView
          streamURL={(remoteStream as any).toURL()}
          objectFit="cover"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            paddingBottom: 140,
          }}>
          <View
            style={{
              width: 116,
              height: 116,
              borderRadius: 58,
              overflow: 'hidden',
              backgroundColor: 'rgba(255,255,255,0.10)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 22,
            }}>
            {peer?.avatarUri ? (
              <SafeImage uri={peer.avatarUri} style={{ width: 116, height: 116 }} />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 44, fontWeight: '600' }}>{initial}</Text>
            )}
          </View>

          <Text
            numberOfLines={1}
            style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '600', paddingHorizontal: 32 }}>
            {peerName}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {phase === 'connecting' && !error ? (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
            ) : null}
            <Text
              style={{
                color: error ? '#FCA5A5' : 'rgba(255,255,255,0.75)',
                fontSize: 15,
                fontWeight: '500',
                textAlign: 'center',
                paddingHorizontal: 32,
              }}>
              {statusText}
            </Text>
          </View>
        </View>
      )}

      {/* Self view — small and cornered, out of the way of the other person's face. */}
      {isVideo && localStream && phase !== 'ended' ? (
        <View
          style={{
            position: 'absolute',
            top: insets.top + 12,
            right: 16,
            width: 108,
            height: 156,
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: 'rgba(255,255,255,0.10)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.16)',
          }}>
          {cameraOff ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <IconSymbol name="video.slash.fill" size={20} color="rgba(255,255,255,0.7)" />
            </View>
          ) : (
            <RTCView
              streamURL={(localStream as any).toURL()}
              objectFit="cover"
              zOrder={1}
              mirror
              style={{ flex: 1 }}
            />
          )}
        </View>
      ) : null}

      {/* Active-call timer stays visible over video, where the avatar block is hidden. */}
      {showRemoteVideo ? (
        <View style={{ position: 'absolute', top: insets.top + 16, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '600' }}>{peerName}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 2 }}>
            {statusText}
          </Text>
        </View>
      ) : null}

      {/* Warn once, quietly, instead of letting calls mysteriously fail later. */}
      {relayMissing && (phase === 'active' || phase === 'connecting') ? (
        <View
          style={{
            position: 'absolute',
            top: insets.top + (showRemoteVideo ? 70 : 0),
            left: 16,
            right: 16,
            bottom: showRemoteVideo ? undefined : insets.bottom + 190,
            justifyContent: 'flex-end',
          }}>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textAlign: 'center' }}>
            On a weak network this call may drop — no relay configured.
          </Text>
        </View>
      ) : null}

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + 26,
          paddingHorizontal: 24,
        }}>
        {isIncoming ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-evenly' }}>
            <CallControl
              icon="phone.down.fill"
              label="Decline"
              destructive
              large
              onPress={() => void callManager.decline()}
            />
            <CallControl
              icon={isVideo ? 'video.fill' : 'phone.fill'}
              label="Accept"
              large
              active
              onPress={() => void callManager.accept()}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start' }}>
            <CallControl
              icon={muted ? 'mic.slash.fill' : 'mic.fill'}
              label={muted ? 'Unmute' : 'Mute'}
              active={muted}
              onPress={() => callManager.toggleMute()}
            />
            <CallControl
              icon={speakerOn ? 'speaker.wave.2.fill' : 'speaker.slash.fill'}
              label="Speaker"
              active={speakerOn}
              onPress={() => callManager.toggleSpeaker()}
            />
            {isVideo ? (
              <>
                <CallControl
                  icon={cameraOff ? 'video.slash.fill' : 'video.fill'}
                  label="Camera"
                  active={cameraOff}
                  onPress={() => callManager.toggleCamera()}
                />
                <CallControl
                  icon="camera.rotate.fill"
                  label="Flip"
                  onPress={() => callManager.switchCamera()}
                />
              </>
            ) : null}
            <CallControl
              icon="phone.down.fill"
              label={phase === 'ended' ? 'Close' : 'End'}
              destructive
              onPress={() =>
                phase === 'ended' ? useCallStore.getState().reset() : void callManager.hangup()
              }
            />
          </View>
        )}
      </View>

      {call?.threadId && phase === 'outgoing' ? (
        <Text
          style={{
            position: 'absolute',
            bottom: insets.bottom + 6,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 11,
          }}>
          {isCaller ? 'Calling…' : ''}
        </Text>
      ) : null}
    </View>
  );
}
