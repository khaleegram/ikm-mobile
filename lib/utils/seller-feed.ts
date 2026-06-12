import { formatShortDate } from '@/lib/utils/date-format';
import type { MarketPost } from '@/types';

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

export function formatFeedDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatShortDate(date);
}

export type SellerFeedItem =
  | { kind: 'date'; id: string; label: string }
  | { kind: 'post'; id: string; post: MarketPost };

export function buildSellerFeedItems(posts: MarketPost[]): SellerFeedItem[] {
  const items: SellerFeedItem[] = [];
  let lastDateKey = '';

  for (const post of posts) {
    const postId = post.id ?? `post-${post.posterId}-${asDate(post.createdAt).getTime()}`;
    const dateKey = asDate(post.createdAt).toDateString();

    if (dateKey !== lastDateKey) {
      items.push({
        kind: 'date',
        id: `date-${dateKey}`,
        label: formatFeedDateLabel(asDate(post.createdAt)),
      });
      lastDateKey = dateKey;
    }

    items.push({ kind: 'post', id: postId, post });
  }

  return items;
}
