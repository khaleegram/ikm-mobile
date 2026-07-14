/** In-memory WebSocket registry (single-instance Cloud Run). Scale-out needs Redis TCP pub/sub. */
const threadSubscribers = new Map();

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

export function broadcastToThread(threadId, payload) {
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
