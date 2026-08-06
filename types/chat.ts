export type ChatThreadStatus =
  | 'browsing'
  | 'negotiating'
  | 'offer_sent'
  | 'accepted'
  | 'in_order'
  | 'completed'
  | 'closed';

export type ChatMessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'quote'
  | 'offer'
  | 'counter'
  | 'accept'
  | 'decline'
  | 'system'
  | 'order_created'
  | 'order_shipped'
  | 'order_delivered';

export type ChatOfferStatus = 'pending' | 'accepted' | 'countered' | 'declined' | 'expired';

export interface ChatPostSnapshot {
  title?: string;
  price?: number | null;
  currency?: string;
  imageUrl?: string | null;
  location?: string | null;
}

export interface ChatThread {
  id: string;
  postId: string;
  buyerId: string;
  sellerId: string;
  status: ChatThreadStatus;
  postSnapshot: ChatPostSnapshot;
  linkedOrderId?: string | null;
  lastMessage?: string | null;
  lastAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatInboxItem {
  threadId: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string | null;
  peerPresence?: 'online' | 'last_seen' | 'offline';
  peerLastSeenAt?: string | null;
  postId: string;
  postSnapshot: ChatPostSnapshot;
  status: ChatThreadStatus;
  statusBadge?: string | null;
  lastPreview: string;
  unreadCount: number;
  lastAt?: string | null;
}

export interface ChatOffer {
  id: string;
  threadId?: string;
  buyerId?: string;
  sellerId?: string;
  amount: number;
  currency: string;
  note?: string | null;
  status: ChatOfferStatus;
  parentOfferId?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatAttachment {
  id: string;
  messageId?: string;
  type: string;
  url: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId?: string | null;
  type: ChatMessageType;
  body?: string | null;
  payload?: Record<string, unknown>;
  clientMsgId?: string | null;
  offer?: ChatOffer | null;
  attachment?: ChatAttachment | null;
  createdAt: string;
}

export interface ChatPeerProfile {
  id: string;
  displayName: string;
  storeName?: string | null;
  avatarUrl?: string | null;
  isVerified?: boolean;
  presence?: 'online' | 'last_seen' | 'offline';
  lastSeenAt?: string | null;
}
