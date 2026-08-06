import React from 'react';

import { PostgresChatDetail } from '@/components/chat/deal-room/postgres-chat-detail';

/**
 * Deal-room entry — Postgres/Neon only.
 * The legacy Firestore chat UI and the duplicate `_chat-detail` tree are gone.
 */
export default function ChatDetailScreen() {
  return <PostgresChatDetail />;
}
