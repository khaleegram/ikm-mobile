import type { ChatInboxItem, ChatThreadStatus } from '@/types/chat';

export type PeerDealGroup = {
  peerId: string;
  peerName: string;
  peerAvatar?: string | null;
  peerPresence?: ChatInboxItem['peerPresence'];
  rooms: ChatInboxItem[];
  activeRoomCount: number;
  unreadTotal: number;
  lastAt: string | null;
  lastPreview: string;
  topProductTitle?: string;
  topProductImage?: string | null;
};

const ACTIVE_STATUSES = new Set<string>([
  'browsing',
  'negotiating',
  'offer_sent',
  'accepted',
  'in_order',
  'order_active',
]);

const COMPLETED_STATUSES = new Set<string>(['completed', 'closed']);

export function isActiveDealStatus(status?: ChatThreadStatus | string | null): boolean {
  const value = String(status || '').trim();
  // Missing status = still an open room (treat as browsing)
  if (!value) return true;
  return ACTIVE_STATUSES.has(value);
}

export function isCompletedDealStatus(status?: ChatThreadStatus | string | null): boolean {
  return COMPLETED_STATUSES.has(String(status || ''));
}

function lastAtMs(value?: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Group flat inbox threads into peer hubs with product rooms. */
export function groupInboxByPeer(items: ChatInboxItem[]): PeerDealGroup[] {
  const map = new Map<string, PeerDealGroup>();

  for (const item of items) {
    const peerId = String(item.peerId || '').trim();
    if (!peerId) continue;

    const existing = map.get(peerId);
    if (!existing) {
      map.set(peerId, {
        peerId,
        peerName:
          item.peerName && !String(item.peerName).includes('@') ? item.peerName : 'User',
        peerAvatar: item.peerAvatar || null,
        peerPresence: item.peerPresence,
        rooms: [item],
        activeRoomCount: isActiveDealStatus(item.status) ? 1 : 0,
        unreadTotal: Number(item.unreadCount || 0),
        lastAt: item.lastAt || null,
        lastPreview: item.lastPreview || '',
        topProductTitle: item.postSnapshot?.title,
        topProductImage: item.postSnapshot?.imageUrl || null,
      });
      continue;
    }

    existing.rooms.push(item);
    existing.unreadTotal += Number(item.unreadCount || 0);
    if (isActiveDealStatus(item.status)) existing.activeRoomCount += 1;

    if (lastAtMs(item.lastAt) >= lastAtMs(existing.lastAt)) {
      existing.lastAt = item.lastAt || existing.lastAt;
      existing.lastPreview = item.lastPreview || existing.lastPreview;
      existing.topProductTitle = item.postSnapshot?.title || existing.topProductTitle;
      existing.topProductImage = item.postSnapshot?.imageUrl || existing.topProductImage;
      if (item.peerName && !String(item.peerName).includes('@')) {
        existing.peerName = item.peerName;
      }
      if (item.peerAvatar) existing.peerAvatar = item.peerAvatar;
      if (item.peerPresence) existing.peerPresence = item.peerPresence;
    }
  }

  for (const group of map.values()) {
    // One room per product — keep newest thread for each postId
    const buckets = new Map<string, ChatInboxItem[]>();
    for (const room of group.rooms) {
      const key = String(room.postId || room.threadId || '').trim();
      if (!key) continue;
      const list = buckets.get(key) || [];
      list.push(room);
      buckets.set(key, list);
    }
    group.rooms = Array.from(buckets.values())
      .map((list) => {
        const sorted = [...list].sort((a, b) => lastAtMs(b.lastAt) - lastAtMs(a.lastAt));
        const best = sorted[0];
        return {
          ...best,
          unreadCount: list.reduce((sum, room) => sum + Number(room.unreadCount || 0), 0),
        };
      })
      .sort((a, b) => lastAtMs(b.lastAt) - lastAtMs(a.lastAt));
    group.activeRoomCount = group.rooms.filter((room) => isActiveDealStatus(room.status)).length;
  }

  return Array.from(map.values()).sort((a, b) => lastAtMs(b.lastAt) - lastAtMs(a.lastAt));
}

export function filterRoomsBySegment(
  rooms: ChatInboxItem[],
  segment: 'deals' | 'completed' | 'unread'
): ChatInboxItem[] {
  if (segment === 'unread') {
    return rooms.filter((room) => Number(room.unreadCount || 0) > 0);
  }
  if (segment === 'completed') {
    return rooms.filter((room) => isCompletedDealStatus(room.status));
  }
  return rooms.filter((room) => isActiveDealStatus(room.status));
}

export function filterPeerGroupsBySegment(
  groups: PeerDealGroup[],
  segment: 'deals' | 'completed' | 'unread'
): PeerDealGroup[] {
  return groups
    .map((group) => {
      const rooms = filterRoomsBySegment(group.rooms, segment);
      if (!rooms.length) return null;
      const unreadTotal = rooms.reduce((sum, room) => sum + Number(room.unreadCount || 0), 0);
      const latest = rooms[0];
      return {
        ...group,
        rooms,
        activeRoomCount: rooms.filter((room) => isActiveDealStatus(room.status)).length,
        unreadTotal,
        lastAt: latest?.lastAt || group.lastAt,
        lastPreview: latest?.lastPreview || group.lastPreview,
        topProductTitle: latest?.postSnapshot?.title || group.topProductTitle,
        topProductImage: latest?.postSnapshot?.imageUrl || group.topProductImage,
      } satisfies PeerDealGroup;
    })
    .filter(Boolean) as PeerDealGroup[];
}
