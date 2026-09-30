/**
 * Socket registries with optional Redis pub/sub for multi-instance fan-out.
 *
 * Two scopes share one pair of Redis clients:
 *  - threads: chat message fan-out (a socket watches one conversation)
 *  - users:   call signalling (a socket is a *person*, and must be reachable wherever they are)
 *
 * They are kept on separate channels on purpose. Chat and call traffic have different lifetimes —
 * a dropped call signal is worth nothing a second later — so mixing them in one channel would mean
 * call traffic queueing behind chat traffic.
 */
import crypto from 'crypto';
import Redis from 'ioredis';

const THREAD_CHANNEL = 'chat:ws';
const USER_CHANNEL = 'call:ws';
const INSTANCE_ID = crypto.randomUUID();

const threadSubscribers = new Map();
const userSubscribers = new Map();

let pubClient = null;
let subClient = null;

function sendToSockets(map, key, payload) {
  const set = map.get(String(key));
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

function addSubscriber(map, key, socket) {
  const k = String(key);
  if (!map.has(k)) map.set(k, new Set());
  map.get(k).add(socket);
}

function removeSubscriber(map, key, socket) {
  const k = String(key);
  const set = map.get(k);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) map.delete(k);
}

/** Deliver locally, then hand to peer instances so fan-out works across replicas. */
function publishToPeers(channel, map, key, payload) {
  sendToSockets(map, key, payload);
  if (!pubClient) return;
  void pubClient
    .publish(
      channel,
      JSON.stringify({ key: String(key), payload, originInstanceId: INSTANCE_ID })
    )
    .catch((err) => {
      console.warn(`[rt-ws] Redis publish failed on ${channel}:`, err?.message || err);
    });
}

// ── Chat: one socket per conversation ────────────────────────────────────────
export function registerThreadSocket(threadId, socket) {
  addSubscriber(threadSubscribers, threadId, socket);
}

export function unregisterThreadSocket(threadId, socket) {
  removeSubscriber(threadSubscribers, threadId, socket);
}

export function broadcastToThread(threadId, payload) {
  publishToPeers(THREAD_CHANNEL, threadSubscribers, threadId, payload);
}

// ── Calls: one socket per person ─────────────────────────────────────────────
export function registerUserSocket(userId, socket) {
  addSubscriber(userSubscribers, userId, socket);
}

export function unregisterUserSocket(userId, socket) {
  removeSubscriber(userSubscribers, userId, socket);
}

/**
 * Push to every device a person has open. Used for call signalling (offer, answer, candidates,
 * hang-up) and for telling the other side a call was accepted or declined.
 */
export function broadcastToUser(userId, payload) {
  publishToPeers(USER_CHANNEL, userSubscribers, userId, payload);
}

/** How many live sockets a user has, so the caller can tell "offline" from "not answering". */
export function countUserSockets(userId) {
  return userSubscribers.get(String(userId))?.size ?? 0;
}

export async function initChatWsPubSub() {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) {
    console.warn('[rt-ws] REDIS_URL not set — in-memory WS only (single instance)');
    return;
  }

  pubClient = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  subClient = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });

  subClient.on('message', (channel, message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed?.originInstanceId === INSTANCE_ID) return;
      if (!parsed?.key || !parsed?.payload) return;
      if (channel === THREAD_CHANNEL) sendToSockets(threadSubscribers, parsed.key, parsed.payload);
      else if (channel === USER_CHANNEL) sendToSockets(userSubscribers, parsed.key, parsed.payload);
    } catch {
      // ignore malformed fan-out payloads
    }
  });

  await subClient.subscribe(THREAD_CHANNEL, USER_CHANNEL);
  console.log(
    `[rt-ws] Redis pub/sub enabled on ${THREAD_CHANNEL} + ${USER_CHANNEL} (instance ${INSTANCE_ID.slice(0, 8)})`
  );
}

export async function closeChatWsPubSub() {
  try {
    if (subClient) await subClient.unsubscribe(THREAD_CHANNEL, USER_CHANNEL);
  } catch {
    // ignore
  }
  await subClient?.quit();
  await pubClient?.quit();
  subClient = null;
  pubClient = null;
}
