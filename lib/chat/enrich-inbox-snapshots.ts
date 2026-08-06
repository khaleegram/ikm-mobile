import type { MarketPost } from '@/types';
import type { ChatInboxItem, ChatPostSnapshot } from '@/types/chat';
import { getMarketPostPrimaryImage, getMarketPostVideoCover } from '@/lib/utils/market-media';

/** post.title if set, otherwise "Product". Nothing else. */
export function productTitleOrFallback(raw?: string | null): string {
  const title = String(raw || '').trim().slice(0, 80);
  return title || 'Product';
}

/** Deal UI label: post.title if present, else "Product". */
export function dealProductLabel(snapshot?: ChatPostSnapshot | null): string {
  return productTitleOrFallback(snapshot?.title);
}

export function snapshotFromMarketPost(post: MarketPost | null | undefined): ChatPostSnapshot | null {
  if (!post?.id) return null;
  const imageUrl =
    getMarketPostVideoCover(post) || getMarketPostPrimaryImage(post) || null;
  const price = typeof post.price === 'number' && post.price > 0 ? post.price : null;
  const location = [post.location?.city, post.location?.state].filter(Boolean).join(', ') || null;
  return {
    title: productTitleOrFallback(post.title),
    price,
    currency: 'NGN',
    imageUrl,
    location,
  };
}

/** Always prefer live post.title over stale chat snapshots. */
export function enrichInboxRoomsWithPosts(
  rooms: ChatInboxItem[],
  postsById: Record<string, MarketPost | undefined>
): ChatInboxItem[] {
  return rooms.map((room) => {
    const post = postsById[String(room.postId || '').trim()];
    if (!post) {
      // Still sanitize caption leftovers sitting in old snapshots
      const stale = String(room.postSnapshot?.title || '').trim();
      if (!stale || stale.includes('#') || stale.length > 80) {
        return {
          ...room,
          postSnapshot: { ...(room.postSnapshot || {}), title: 'Product' },
        };
      }
      return room;
    }
    const snap = snapshotFromMarketPost(post);
    if (!snap) return room;
    return {
      ...room,
      postSnapshot: {
        ...(room.postSnapshot || {}),
        ...snap,
        title: productTitleOrFallback(post.title),
      },
    };
  });
}

/** One room per product — keep the most recently active thread. */
export function dedupeRoomsByPostId(rooms: ChatInboxItem[]): ChatInboxItem[] {
  const byPost = new Map<string, ChatInboxItem>();
  for (const room of rooms) {
    const postId = String(room.postId || '').trim();
    const key = postId || String(room.threadId || '').trim();
    if (!key) continue;
    const existing = byPost.get(key);
    if (!existing) {
      byPost.set(key, room);
      continue;
    }
    const nextMs = room.lastAt ? new Date(room.lastAt).getTime() : 0;
    const prevMs = existing.lastAt ? new Date(existing.lastAt).getTime() : 0;
    if (nextMs >= prevMs) {
      byPost.set(key, {
        ...room,
        unreadCount: Number(existing.unreadCount || 0) + Number(room.unreadCount || 0),
      });
    } else {
      byPost.set(key, {
        ...existing,
        unreadCount: Number(existing.unreadCount || 0) + Number(room.unreadCount || 0),
      });
    }
  }
  return Array.from(byPost.values());
}
