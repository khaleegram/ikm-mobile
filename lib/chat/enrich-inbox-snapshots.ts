import type { MarketPost } from '@/types';
import type { ChatInboxItem, ChatPostSnapshot } from '@/types/chat';
import { getMarketPostPrimaryImage, getMarketPostVideoCover } from '@/lib/utils/market-media';

function snapshotLooksEmpty(snapshot?: ChatPostSnapshot | null): boolean {
  if (!snapshot || typeof snapshot !== 'object') return true;
  const title = String(snapshot.title || '').trim();
  const image = String(snapshot.imageUrl || '').trim();
  return !title && !image;
}

export function snapshotFromMarketPost(post: MarketPost | null | undefined): ChatPostSnapshot | null {
  if (!post?.id) return null;
  const imageUrl =
    getMarketPostVideoCover(post) || getMarketPostPrimaryImage(post) || null;
  const title =
    String(post.title || '').trim() ||
    String(post.description || '').trim().split('\n')[0].slice(0, 80) ||
    'Listing';
  const price = typeof post.price === 'number' && post.price > 0 ? post.price : null;
  const location = [post.location?.city, post.location?.state].filter(Boolean).join(', ') || null;
  return {
    title,
    price,
    currency: 'NGN',
    imageUrl,
    location,
  };
}

/** Merge Firestore post data into inbox rooms that have empty post_snapshot. */
export function enrichInboxRoomsWithPosts(
  rooms: ChatInboxItem[],
  postsById: Record<string, MarketPost | undefined>
): ChatInboxItem[] {
  return rooms.map((room) => {
    if (!snapshotLooksEmpty(room.postSnapshot)) return room;
    const post = postsById[room.postId];
    const snap = snapshotFromMarketPost(post);
    if (!snap) return room;
    return { ...room, postSnapshot: snap };
  });
}
