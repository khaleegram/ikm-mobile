/**
 * Live call state — deliberately NOT persisted.
 *
 * A call belongs to this moment and this device. Restoring a call after a restart would mean
 * reconnecting to a conversation that is already over, so unlike cart or filters this store is
 * plain in-memory Zustand with no MMKV backing.
 *
 * Only what the UI draws lives here. The peer connection itself is kept in `call-manager.ts` —
 * it is not renderable state, and putting it in the store would re-render the whole tree on every
 * ICE candidate.
 */
import { create } from 'zustand';
import type { MediaStream } from 'react-native-webrtc';

import type { CallKind, CallRecord } from '@/lib/api/calls';

export type CallPhase =
  /** Nothing happening. */
  | 'idle'
  /** We are ringing them. */
  | 'outgoing'
  /** They are ringing us. */
  | 'incoming'
  /** Answered — setting up media. */
  | 'connecting'
  /** Live. */
  | 'active'
  /** Just finished; shown briefly so the outcome is visible before the screen closes. */
  | 'ended';

export type CallPeer = {
  id: string;
  name: string;
  avatarUri?: string;
};

export type CallEndInfo = {
  reason: string;
  durationSec: number | null;
} | null;

type CallState = {
  phase: CallPhase;
  call: CallRecord | null;
  peer: CallPeer | null;
  kind: CallKind;
  isCaller: boolean;
  muted: boolean;
  speakerOn: boolean;
  cameraOff: boolean;
  facing: 'front' | 'back';
  durationSec: number;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  endInfo: CallEndInfo;
  error: string | null;
  /** True when no TURN relay is configured — calls will fail on most mobile networks. */
  relayMissing: boolean;

  reset: () => void;
  set: (patch: Partial<CallState>) => void;
};

const INITIAL = {
  phase: 'idle' as CallPhase,
  call: null,
  peer: null,
  kind: 'audio' as CallKind,
  isCaller: false,
  muted: false,
  speakerOn: false,
  cameraOff: false,
  facing: 'front' as const,
  durationSec: 0,
  localStream: null,
  remoteStream: null,
  endInfo: null,
  error: null,
  relayMissing: false,
};

export const useCallStore = create<CallState>((set) => ({
  ...INITIAL,
  reset: () => set({ ...INITIAL }),
  set: (patch) => set(patch),
}));

export const callStore = {
  get: () => useCallStore.getState(),
  set: (patch: Partial<CallState>) => useCallStore.getState().set(patch),
  reset: () => useCallStore.getState().reset(),
};
