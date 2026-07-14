/** Market chat uses chatcart-api Deal Threads (Postgres). Firestore chat is retired. */
export function isPostgresChatBackend(): boolean {
  const raw = (process.env.EXPO_PUBLIC_CHAT_BACKEND || 'postgres').toLowerCase();
  return raw !== 'firestore';
}
