/**
 * Calls API — placing, answering, and signalling.
 *
 * Two channels, for two different jobs:
 *  - REST for anything that must survive a dropped connection: place a call, answer, decline, hang
 *    up, fetch relay credentials. If the app is killed mid-call, this is what still holds.
 *  - a socket for the parts that are worthless a second later: SDP offers/answers and ICE
 *    candidates. These are useless once stale, so they are never stored, only relayed.
 */
import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import { auth } from '@/lib/firebase/config';

export type CallKind = 'audio' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'failed';

export type CallRecord = {
  id: string;
  threadId: string;
  callerId: string;
  calleeId: string;
  kind: CallKind;
  status: CallStatus;
  startedAt?: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSec?: number | null;
  endedBy?: string | null;
};

export type IceServerEntry = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type IceConfig = {
  iceServers: IceServerEntry[];
  /** False means no relay was configured — calls will fail on most mobile networks. */
  turn?: boolean;
};

export type StartCallResult = {
  call: CallRecord;
  busy: boolean;
  ice: IceConfig | null;
  ringTimeoutSec: number;
};

function wsBaseUrl(): string {
  const http = apiUrl('').replace(/\/v1\/?$/, '');
  return http.replace(/^http/, 'ws');
}

export const callsApi = {
  async start(input: {
    threadId: string;
    calleeId: string;
    kind: CallKind;
  }): Promise<StartCallResult> {
    const response = await coreCloudClient.request<StartCallResult & { success: boolean }>(
      apiUrl('/calls'),
      {
        method: 'POST',
        body: { threadId: input.threadId, calleeId: input.calleeId, kind: input.kind },
        requiresAuth: true,
      }
    );
    return {
      call: response.call,
      busy: Boolean(response.busy),
      ice: response.ice ?? null,
      ringTimeoutSec: Number(response.ringTimeoutSec) || 45,
    };
  },

  async get(callId: string): Promise<CallRecord> {
    const response = await coreCloudClient.request<{ success: boolean; call: CallRecord }>(
      apiUrl(`/calls/${callId}`),
      { method: 'GET', requiresAuth: true }
    );
    return response.call;
  },

  async answer(callId: string): Promise<CallRecord> {
    const response = await coreCloudClient.request<{ success: boolean; call: CallRecord }>(
      apiUrl(`/calls/${callId}/answer`),
      { method: 'POST', requiresAuth: true }
    );
    return response.call;
  },

  async decline(callId: string): Promise<CallRecord> {
    const response = await coreCloudClient.request<{ success: boolean; call: CallRecord }>(
      apiUrl(`/calls/${callId}/decline`),
      { method: 'POST', requiresAuth: true }
    );
    return response.call;
  },

  async end(callId: string, failed = false): Promise<CallRecord> {
    const response = await coreCloudClient.request<{ success: boolean; call: CallRecord }>(
      apiUrl(`/calls/${callId}/end`),
      { method: 'POST', body: { failed }, requiresAuth: true }
    );
    return response.call;
  },

  async getIce(): Promise<IceConfig> {
    const response = await coreCloudClient.request<IceConfig & { success: boolean }>(
      apiUrl('/calls/ice'),
      { method: 'GET', requiresAuth: true }
    );
    return { iceServers: response.iceServers || [], turn: response.turn };
  },

  async listForThread(threadId: string): Promise<CallRecord[]> {
    const response = await coreCloudClient.request<{ success: boolean; calls: CallRecord[] }>(
      apiUrl(`/calls/thread/${threadId}`),
      { method: 'GET', requiresAuth: true }
    );
    return Array.isArray(response.calls) ? response.calls : [];
  },

  /**
   * The signalling socket — one per person, not per conversation, so a call reaches you wherever
   * you happen to be in the app. Reconnects automatically, because dropping a socket must not mean
   * missing a call.
   */
  openSignalSocket(handlers: {
    onEvent: (event: Record<string, any>) => void;
    onError?: (error: Error) => void;
    onClose?: () => void;
  }): { close: () => void; send: (message: Record<string, unknown>) => void } {
    let closed = false;
    let socket: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    /**
     * Signals sent before the socket finished connecting.
     *
     * Without this, placing a call immediately after opening the app would silently drop the SDP
     * offer — the call would ring and then never connect, which looks like a random failure. The
     * offer matters more than the candidate stream, so it must not depend on a race.
     */
    let outbox: string[] = [];

    const flushOutbox = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const queued = outbox;
      outbox = [];
      for (const message of queued) {
        try {
          socket.send(message);
        } catch {
          // socket died mid-flush; it will reconnect
        }
      }
    };

    const connect = async () => {
      if (closed) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        handlers.onError?.(new Error('Not authenticated'));
        return;
      }

      socket = new WebSocket(`${wsBaseUrl()}/v1/calls/stream`);
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'auth', token }));
        flushOutbox();
        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };
      socket.onmessage = (event) => {
        try {
          handlers.onEvent(JSON.parse(String(event.data)));
        } catch {
          // ignore malformed frames
        }
      };
      socket.onerror = () => handlers.onError?.(new Error('Call socket error'));
      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        handlers.onClose?.();
        if (!closed) setTimeout(connect, 2000);
      };
    };

    void connect();

    return {
      close: () => {
        closed = true;
        if (pingTimer) clearInterval(pingTimer);
        outbox = [];
        socket?.close();
      },
      /** Queues while connecting so an offer is never lost to a race. */
      send: (message: Record<string, unknown>) => {
        const encoded = JSON.stringify(message);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(encoded);
          return;
        }
        // A hung-up call should not leave stale signals to flush later.
        if (message.type === 'end' || message.type === 'decline') {
          outbox = [];
        }
        outbox.push(encoded);
        // Keep the queue small: only the newest ICE candidates are worth delivering.
        if (outbox.length > 40) outbox = outbox.slice(-40);
      },
    };
  },
};
