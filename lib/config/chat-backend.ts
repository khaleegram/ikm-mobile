// Chat is Postgres-only (chatcart-api + Neon). The Firestore paths gated behind this
// flag are legacy fallbacks kept temporarily; there is no EXPO_PUBLIC_CHAT_BACKEND switch.
// See docs/architecture-boundaries.md and docs/firebase-market-core-exit.md.
export function isPostgresChatBackend(): boolean {
  return true;
}
