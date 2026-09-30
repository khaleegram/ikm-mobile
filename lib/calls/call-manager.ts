/**
 * The brain of the call feature.
 *
 * Owns the peer connection, the signalling socket, and the audio session. Everything the UI needs
 * is written into `call-store`; everything expensive or non-renderable stays in this module.
 *
 * How a call actually happens:
 *   1. Caller asks the API to place it. The API records it and rings the callee — by socket if
 *      their app is open, by push if it is not.
 *   2. Caller and callee each build a peer connection and swap SDP (the "here is what I can do")
 *      and ICE candidates (the "here is how to reach me") through the socket.
 *   3. Media flows phone-to-phone. The server never sees or touches the audio or video.
 *
 * The fiddly part, and the reason this file is careful: the two sides do not arrive at the same
 * moment. A callee's phone receives ICE candidates while it is still ringing, before there is any
 * remote description to attach them to. Candidates are therefore buffered and flushed once the
 * offer lands — drop them instead and calls connect only sometimes, which shows up as "calls
 * sometimes take ages and sometimes just fail".
 */
import { PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';

import { callsApi, type CallKind, type IceConfig } from '@/lib/api/calls';
import { callStore, type CallPeer } from './call-store';

type SignalSocket = ReturnType<typeof callsApi.openSignalSocket>;

/**
 * How long a call rings before it becomes a missed call. Kept in step with the server's own
 * timeout, so both sides give up at roughly the same moment instead of one ringing into a void.
 */
const RING_TIMEOUT_SEC = 45;

let socket: SignalSocket | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

let activeCallId: string | null = null;
let currentKind: CallKind = 'audio';
let currentPeer: CallPeer | null = null;
let amCaller = false;

/** SDP that arrived before we were ready to use it (callee side, before accepting). */
let pendingOffer: any = null;
/** Remote candidates that arrived before there was a remote description to attach them to. */
let pendingCandidates: any[] = [];
let remoteDescriptionSet = false;
let accepted = false;

let ringTimer: ReturnType<typeof setTimeout> | null = null;
let durationTimer: ReturnType<typeof setInterval> | null = null;
/** Guards against double-teardown, which would otherwise fire two end requests and two sound stops. */
let finishing = false;

async function ensurePermissions(kind: CallKind): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const needed = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (kind === 'video') needed.push(PermissionsAndroid.PERMISSIONS.CAMERA);

  try {
    const results = await PermissionsAndroid.requestMultiple(needed);
    return needed.every(
      (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch {
    return false;
  }
}

async function openLocalStream(kind: CallKind): Promise<MediaStream> {
  const stream = (await mediaDevices.getUserMedia({
    audio: true,
    video:
      kind === 'video'
        ? { facingMode: 'user', width: 1280, height: 720, frameRate: 30 }
        : false,
  })) as MediaStream;
  return stream;
}

function buildPeerConnection(ice: IceConfig): RTCPeerConnection {
  const connection = new RTCPeerConnection({
    iceServers: ice.iceServers,
    // Tells a relayed connection to actually be used when direct fails; without this the far side
    // can be reachable only through TURN and the call still fails.
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
  });

  connection.onicecandidate = (event: any) => {
    if (event?.candidate && activeCallId) {
      socket?.send({ type: 'ice', callId: activeCallId, payload: event.candidate });
    }
  };

  connection.oniceconnectionstatechange = () => {
    const state = String((connection as any).iceConnectionState || '');
    if (state === 'failed') {
      void finish('failed', { failed: true });
    }
  };

  connection.ontrack = (event: any) => {
    const stream = event?.streams?.[0];
    if (stream) callStore.set({ remoteStream: stream as MediaStream });
  };

  connection.onconnectionstatechange = () => {
    const state = String((connection as any).connectionState || '');
    if (state === 'connected') {
      // The real moment the call is live — not when the answer arrived.
      if (callStore.get().phase !== 'active') {
        callStore.set({ phase: 'active' });
        startDurationTimer();
        InCallManager.start({ media: currentKind === 'video' ? 'video' : 'audio' });
      }
    } else if (state === 'failed' || state === 'closed') {
      if (callStore.get().phase === 'active' || callStore.get().phase === 'connecting') {
        void finish('failed', { failed: true });
      }
    }
  };

  return connection;
}

async function attachAndOffer(ice: IceConfig) {
  localStream = await openLocalStream(currentKind);
  callStore.set({ localStream });

  pc = buildPeerConnection(ice);
  localStream.getTracks().forEach((track) => pc?.addTrack(track, localStream as MediaStream));

  const offer = await pc.createOffer({});
  await pc.setLocalDescription(offer);
  socket?.send({ type: 'offer', callId: activeCallId, payload: offer });
}

function startDurationTimer() {
  stopDurationTimer();
  InCallManager.setSpeakerphoneOn(currentKind === 'video');
  callStore.set({ speakerOn: currentKind === 'video', durationSec: 0 });
  durationTimer = setInterval(() => {
    const next = callStore.get().durationSec + 1;
    callStore.set({ durationSec: next });
  }, 1000);
}

function stopDurationTimer() {
  if (durationTimer) clearInterval(durationTimer);
  durationTimer = null;
}

function clearTimers() {
  stopDurationTimer();
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = null;
}

/**
 * Tear everything down and tell the server. Safe to call at any point, from either side, and more
 * than once — a call can end because someone hung up, because it rang out, or because the network
 * gave up, and all three land here.
 */
async function finish(reason: string, options: { failed?: boolean } = {}) {
  if (finishing) return;
  finishing = true;

  const callId = activeCallId;
  const wasActive = callStore.get().phase === 'active';
  const duration = callStore.get().durationSec;

  clearTimers();
  try {
    InCallManager.stop();
  } catch {
    // audio session may already be gone
  }

  try {
    pc?.getSenders?.().forEach((sender: any) => {
      try {
        sender?.track?.stop?.();
      } catch {
        // track already stopped
      }
    });
    pc?.close?.();
  } catch {
    // connection already torn down
  }
  pc = null;

  try {
    localStream?.getTracks?.().forEach((track: any) => track?.stop?.());
  } catch {
    // stream already released
  }
  localStream = null;

  if (callId) {
    // Socket first so the other side hangs up immediately rather than waiting on the API round trip.
    socket?.send({ type: 'end', callId });
    await callsApi.end(callId, Boolean(options.failed)).catch(() => {
      // The server reconciles a ring that outlived its app; nothing useful to do here.
    });
  }

  activeCallId = null;
  amCaller = false;
  accepted = false;
  finishing = false;
  pendingOffer = null;
  pendingCandidates = [];
  remoteDescriptionSet = false;

  // Show the outcome briefly so a dropped or declined call is not silent, then clear.
  callStore.set({
    phase: 'ended',
    endInfo: { reason, durationSec: wasActive ? duration : null },
    localStream: null,
    remoteStream: null,
  });
  setTimeout(() => {
    if (callStore.get().phase === 'ended') callStore.reset();
  }, 1600);
}

async function flushCandidates() {
  if (!pc || !remoteDescriptionSet) return;
  const queued = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of queued) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // A single bad candidate is not fatal; others will carry the connection.
    }
  }
}

/** Callee side: build the answer once both the offer and the user's acceptance are present. */
async function buildAnswer(ice: IceConfig) {
  if (!pendingOffer || !accepted || pc) return;

  localStream = await openLocalStream(currentKind);
  callStore.set({ localStream, phase: 'connecting' });

  pc = buildPeerConnection(ice);
  localStream.getTracks().forEach((track) => pc?.addTrack(track, localStream as MediaStream));

  await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
  remoteDescriptionSet = true;
  await flushCandidates();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket?.send({ type: 'answer', callId: activeCallId, payload: answer });
}

/** Everything that happens when a call arrives, from either the socket or a push. */
async function beginIncoming(event: {
  callId: string;
  threadId?: string;
  callerId?: string;
  callerName?: string;
  kind?: string;
}) {
  // Already busy: decline so the caller is not left ringing into silence.
  const current = callStore.get().phase;
  if (current !== 'idle' && current !== 'ended') {
    socket?.send({ type: 'decline', callId: event.callId });
    return;
  }

  activeCallId = event.callId;
  amCaller = false;
  accepted = false;
  remoteDescriptionSet = false;
  pendingCandidates = [];
  pendingOffer = null;
  currentKind = event.kind === 'video' ? 'video' : 'audio';
  currentPeer = {
    id: String(event.callerId || ''),
    name: String(event.callerName || 'Someone'),
  };

  callStore.set({
    phase: 'incoming',
    kind: currentKind,
    isCaller: false,
    peer: currentPeer,
    call: {
      id: String(event.callId),
      threadId: String(event.threadId || ''),
      callerId: String(event.callerId || ''),
      calleeId: '',
      kind: currentKind,
      status: 'ringing',
    } as any,
    durationSec: 0,
    muted: false,
    cameraOff: false,
    endInfo: null,
    error: null,
  });

  try {
    // Vibrate pattern matches the ring timeout, so a call that is not answered stops ringing on
    // its own rather than vibrating until the app is opened.
    InCallManager.startRingtone('_DEFAULT_', [0, 500, 1000], 'default', RING_TIMEOUT_SEC);
  } catch {
    // ringtone is a nicety; the screen is the source of truth
  }

  // Ring out on our side too, so an unanswered call does not sit on screen forever.
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = setTimeout(() => {
    if (callStore.get().phase === 'incoming') void finish('missed');
  }, RING_TIMEOUT_SEC * 1000);
}

async function onSignal(event: Record<string, any>) {
  switch (event?.event) {
    case 'connected':
      return;

    case 'incoming_call': {
      await beginIncoming({
        callId: String(event.callId),
        threadId: event.threadId,
        callerId: event.callerId,
        callerName: event.callerName,
        kind: event.kind,
      });
      return;
    }

    case 'offer': {
      // May arrive before the user has accepted — hold it until they do.
      if (event.callId !== activeCallId) return;
      pendingOffer = event.payload;
      if (accepted) {
        const ice = await callsApi.getIce();
        await buildAnswer(ice).catch(() => void finish('failed', { failed: true }));
      }
      return;
    }

    case 'answer': {
      if (event.callId !== activeCallId || !pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(event.payload));
      remoteDescriptionSet = true;
      await flushCandidates();
      callStore.set({ phase: 'connecting' });
      return;
    }

    case 'ice': {
      if (event.callId !== activeCallId || !event.payload) return;
      if (!pc || !remoteDescriptionSet) {
        // Buffer — this is the case that makes calls work reliably on mobile networks.
        pendingCandidates.push(event.payload);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(event.payload));
      } catch {
        // stale candidate; ignore
      }
      return;
    }

    case 'call_accepted': {
      if (event.callId !== activeCallId) return;
      try {
        InCallManager.stopRingback();
      } catch {
        // noop
      }
      callStore.set({ phase: 'connecting' });
      return;
    }

    case 'call_declined': {
      if (event.callId !== activeCallId) return;
      void finish('declined');
      return;
    }

    case 'call_ended': {
      if (event.callId !== activeCallId) return;
      void finish(String(event.reason || 'ended'));
      return;
    }

    default:
      return;
  }
}

export const callManager = {
  /**
   * Start listening for incoming calls. Called once from the root layout for a signed-in user.
   * Returns a cleanup function for sign-out.
   */
  init(): () => void {
    if (socket) return () => {};

    socket = callsApi.openSignalSocket({
      onEvent: (event) => void onSignal(event),
      onError: () => {
        // Socket reconnects itself; a live call survives brief drops via ICE.
      },
    });

    return () => {
      socket?.close();
      socket = null;
    };
  },

  /**
   * Present a call that arrived by push rather than over the socket — i.e. the app was in the
   * background when it came in. The socket would have handled this if it had been connected.
   */
  async presentIncoming(input: {
    callId: string;
    threadId?: string;
    callerId?: string;
    callerName?: string;
    kind?: string;
  }): Promise<void> {
    if (callStore.get().phase !== 'idle') return;
    await beginIncoming(input);
  },

  async start(input: {
    threadId: string;
    peer: CallPeer;
    kind: CallKind;
  }): Promise<void> {
    const phase = callStore.get().phase;
    if (phase !== 'idle' && phase !== 'ended') return;
    if (!input.peer.id) return;

    finishing = false;
    amCaller = true;
    accepted = true; // caller never needs to "accept"
    currentKind = input.kind;
    currentPeer = input.peer;
    remoteDescriptionSet = false;
    pendingCandidates = [];
    pendingOffer = null;

    callStore.set({
      phase: 'outgoing',
      kind: input.kind,
      isCaller: true,
      peer: input.peer,
      durationSec: 0,
      muted: false,
      speakerOn: input.kind === 'video',
      cameraOff: false,
      facing: 'front',
      endInfo: null,
      error: null,
      call: null,
    });

    const granted = await ensurePermissions(input.kind);
    if (!granted) {
      callStore.set({ error: 'Microphone and camera access are needed to call.' });
      await finish('failed');
      return;
    }

    let started: Awaited<ReturnType<typeof callsApi.start>>;
    try {
      started = await callsApi.start({
        threadId: input.threadId,
        calleeId: input.peer.id,
        kind: input.kind,
      });
    } catch (error: any) {
      callStore.set({ error: error?.message || 'Could not place the call.' });
      await finish('failed');
      return;
    }

    if (started.busy) {
      callStore.set({ error: `${input.peer.name} is on another call.` });
      await finish('failed');
      return;
    }

    activeCallId = started.call.id;
    callStore.set({
      call: started.call,
      peer: input.peer,
      relayMissing: started.ice ? !started.ice.turn : true,
    });

    try {
      InCallManager.startRingback('default');
    } catch {
      // ringback is a nicety
    }

    // Ring out rather than leaving the caller staring at a screen forever.
    ringTimer = setTimeout(() => {
      if (callStore.get().phase === 'outgoing') void finish('missed');
    }, (started.ringTimeoutSec || RING_TIMEOUT_SEC) * 1000);

    try {
      await attachAndOffer(started.ice || { iceServers: [] });
    } catch (error: any) {
      callStore.set({
        error:
          error?.message ||
          'Could not start the call. Check that microphone and camera permissions are allowed.',
      });
      await finish('failed', { failed: true });
    }
  },

  /** Callee picks up. */
  async accept(): Promise<void> {
    const callId = activeCallId;
    if (!callId || accepted) return;

    const granted = await ensurePermissions(currentKind);
    if (!granted) {
      callStore.set({ error: 'Microphone and camera access are needed to call.' });
      await this.decline();
      return;
    }

    accepted = true;
    callStore.set({ phase: 'connecting' });
    try {
      InCallManager.stopRingtone();
    } catch {
      // noop
    }

    try {
      await callsApi.answer(callId);
    } catch {
      // The socket 'accept' is the authoritative path; REST is a backstop for a dead socket.
      socket?.send({ type: 'accept', callId });
    }

    // The offer may still be in flight; buildAnswer is re-invoked when it lands.
    if (pendingOffer) {
      const ice = await callsApi.getIce();
      await buildAnswer(ice).catch(() => void finish('failed', { failed: true }));
    }
  },

  async decline(): Promise<void> {
    const callId = activeCallId;
    if (!callId) return;
    socket?.send({ type: 'decline', callId });
    if (ringTimer) clearTimeout(ringTimer);
    ringTimer = null;
    try {
      InCallManager.stopRingtone();
    } catch {
      // noop
    }
    await callsApi.decline(callId).catch(() => {});
    activeCallId = null;
    accepted = false;
    pendingOffer = null;
    pendingCandidates = [];
    callStore.reset();
  },

  async hangup(): Promise<void> {
    if (!activeCallId) {
      callStore.reset();
      return;
    }
    await finish('ended');
  },

  toggleMute(): void {
    const next = !callStore.get().muted;
    localStream?.getAudioTracks?.().forEach((track: any) => {
      track.enabled = !next;
    });
    callStore.set({ muted: next });
  },

  toggleSpeaker(): void {
    const next = !callStore.get().speakerOn;
    try {
      InCallManager.setSpeakerphoneOn(next);
    } catch {
      // routing is best-effort
    }
    callStore.set({ speakerOn: next });
  },

  /** Camera on/off — keeps the track so the other side does not renegotiate. */
  toggleCamera(): void {
    const next = !callStore.get().cameraOff;
    localStream?.getVideoTracks?.().forEach((track: any) => {
      track.enabled = !next;
    });
    callStore.set({ cameraOff: next });
  },

  switchCamera(): void {
    const track: any = localStream?.getVideoTracks?.()[0];
    try {
      track?._switchCamera?.();
      callStore.set({ facing: callStore.get().facing === 'front' ? 'back' : 'front' });
    } catch {
      // some devices have a single camera
    }
  },

  /** Current peer, so the UI can show the right name and avatar. */
  peer: () => currentPeer,
};

export { finish as finishCall };
