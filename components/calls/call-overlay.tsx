/**
 * Mounts the call screen above the whole app.
 *
 * A call must be able to take over whatever screen you are on — a call that only appears if you
 * happen to be in the right conversation is not a call feature. So this sits at the root, over the
 * navigator, and owns two responsibilities:
 *   1. keep the signalling socket alive while signed in
 *   2. catch calls that arrived by push while the app was backgrounded
 *
 * The socket is what normally rings the app. The push path exists because a backgrounded app has
 * no live socket, and that is exactly when a call is most likely to arrive.
 */
import { useEffect, useRef } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import { CallScreen } from '@/components/calls/call-screen';
import { callManager } from '@/lib/calls/call-manager';
import { useCallStore } from '@/lib/calls/call-store';
import { useUser } from '@/lib/firebase/auth/use-user';

/** Shape of the data payload sent with an incoming-call push (values arrive as strings). */
type CallPushData = {
  type?: string;
  callId?: string;
  threadId?: string;
  callerId?: string;
  callerName?: string;
  kind?: string;
};

function pickCallData(data: unknown): CallPushData | null {
  const value = data as CallPushData | null;
  if (!value || value.type !== 'incoming_call' || !value.callId) return null;
  return value;
}

export function CallOverlay() {
  const { user } = useUser();
  const phase = useCallStore((s) => s.phase);
  const userId = user?.uid;

  /** A call discovered from a push while the app was backgrounded, held until it comes forward. */
  const pendingFromPush = useRef<CallPushData | null>(null);

  // Keep the signalling socket alive for as long as someone is signed in.
  useEffect(() => {
    if (!userId) return;
    return callManager.init();
  }, [userId]);

  // A push can arrive while backgrounded. Ringing a screen nobody can see is pointless, so the
  // call is held and presented the moment the app comes forward.
  useEffect(() => {
    const present = (data: CallPushData | null) => {
      if (!data?.callId) return;
      void callManager.presentIncoming({
        callId: String(data.callId),
        threadId: data.threadId,
        callerId: data.callerId,
        callerName: data.callerName,
        kind: data.kind,
      });
    };

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const data = pickCallData(notification.request.content.data);
      if (!data) return;
      if (AppState.currentState === 'active') present(data);
      else pendingFromPush.current = data;
    });

    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = pickCallData(response.notification.request.content.data);
      if (data) present(data);
    });

    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active' && pendingFromPush.current) {
        const data = pendingFromPush.current;
        pendingFromPush.current = null;
        present(data);
      }
    });

    return () => {
      received.remove();
      responded.remove();
      appState.remove();
    };
  }, []);

  // Nothing happening, or the socket is already showing it.
  if (phase === 'idle') return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <CallScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
});
