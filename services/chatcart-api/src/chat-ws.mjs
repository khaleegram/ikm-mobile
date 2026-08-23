/** WebSocket registry with optional Redis pub/sub for Cloud Run multi-instance fan-out. */
import crypto from 'crypto';
import Redis from 'ioredis';

const PUBSUB_CHANNEL = 'chat:ws';
const INSTANCE_ID = crypto.randomUUID();

const threadSubscribers = new Map();

let pubClient = null;
let subClient = null;

function broadcastLocal(threadId, payload) {
  const key = String(threadId);
  const set = threadSubscribers.get(key);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(payload);
  for (const socket of set) {
    try {
      if (socket.readyState === 1) socket.send(data);
    } catch {
      set.delete(socket);
    }
  }
}

export function registerThreadSocket(threadId, socket) {
  const key = String(threadId);
  if (!threadSubscribers.has(key)) {
    threadSubscribers.set(key, new Set());
  }
  threadSubscribers.get(key).add(socket);
}

export function unregisterThreadSocket(threadId, socket) {
  const key = String(threadId);
  const set = threadSubscribers.get(key);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) threadSubscribers.delete(key);
}

/** Deliver to local sockets, then fan-out to peer instances via Redis when configured. */
export function broadcastToThread(threadId, payload) {
  broadcastLocal(threadId, payload);
  if (!pubClient) return;
  void pubClient
    .publish(
      PUBSUB_CHANNEL,
      JSON.stringify({
        threadId: String(threadId),
        payload,
        originInstanceId: INSTANCE_ID,
      })
    )
    .catch((err) => {
      console.warn('[chat-ws] Redis publish failed:', err?.message || err);
    });
}

export async function initChatWsPubSub() {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) {
    console.warn('[chat-ws] REDIS_URL not set — in-memory WS only (single instance)');
    return;
  }

  pubClient = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  subClient = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });

  subClient.on('message', (channel, message) => {
    if (channel !== PUBSUB_CHANNEL) return;
    try {
      const parsed = JSON.parse(message);
      if (parsed?.originInstanceId === INSTANCE_ID) return;
      if (!parsed?.threadId || !parsed?.payload) return;
      broadcastLocal(parsed.threadId, parsed.payload);
    } catch {
      // ignore malformed fan-out payloads
    }
  });

  await subClient.subscribe(PUBSUB_CHANNEL);
  console.log(`[chat-ws] Redis pub/sub enabled on ${PUBSUB_CHANNEL} (instance ${INSTANCE_ID.slice(0, 8)})`);
}

export async function closeChatWsPubSub() {
  try {
    if (subClient) await subClient.unsubscribe(PUBSUB_CHANNEL);
  } catch {
    // ignore
  }
  await subClient?.quit();
  await pubClient?.quit();
  subClient = null;
  pubClient = null;
}
