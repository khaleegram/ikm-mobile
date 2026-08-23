/**
 * Canonical TanStack Query key factory.
 *
 * This is the single place every domain's query keys are defined. Before this module
 * existed, each hook file invented its own ad hoc key arrays (e.g. `['market-post', id]`
 * typed by hand in `lib/hooks/use-market-post.ts`), which makes cross-file invalidation
 * fragile — a typo in one file's key silently fails to invalidate another file's cache.
 *
 * Rules for adding to this file:
 * - One nested namespace per domain (user, social, posts, feed, chat, orders, ...).
 * - Every key is a function, even for keys with no arguments, so call sites read the
 *   same way everywhere (`queryKeys.social.following(userId)`, not a mix of functions
 *   and bare arrays).
 * - IDs are normalized (trimmed, empty -> null) so `undefined`, `''`, and `null` all
 *   produce the same key instead of silently creating separate cache entries.
 * - List/batch keys sort + dedupe their inputs so the same set of ids always produces
 *   the same key regardless of call-site ordering.
 * - New domains being migrated onto Query (per the foundational rewrite) should add
 *   their keys here rather than inlining new ad hoc arrays in the hook file.
 */

function normalizeId(id: string | null | undefined): string | null {
  return String(id ?? '').trim() || null;
}

function normalizeIdListKey(ids: Array<string | null | undefined>): string {
  return [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))]
    .sort()
    .join(',');
}

export const queryKeys = {
  user: {
    byId: (userId: string | null | undefined) => ['user', normalizeId(userId)] as const,
    batch: (userIds: string[]) => ['users', 'batch', normalizeIdListKey(userIds)] as const,
    /** Own full profile from Neon (`/users/me`) — includes private buyer fields. */
    me: (userId: string | null | undefined) => ['user', 'me', normalizeId(userId)] as const,
  },

  social: {
    following: (userId: string | null | undefined) =>
      ['social', 'following', normalizeId(userId)] as const,
    followingOf: (userId: string | null | undefined) =>
      ['social', 'following-of', normalizeId(userId)] as const,
    followersOf: (userId: string | null | undefined) =>
      ['social', 'followers-of', normalizeId(userId)] as const,
    saved: (userId: string | null | undefined) =>
      ['social', 'saved', normalizeId(userId)] as const,
    liked: (userId: string | null | undefined) =>
      ['social', 'liked', normalizeId(userId)] as const,
    blocked: (userId: string | null | undefined) =>
      ['social', 'blocked', normalizeId(userId)] as const,
  },

  posts: {
    byId: (postId: string | null | undefined) => ['market-post', normalizeId(postId)] as const,
    batch: (postIds: string[]) => ['market-posts-batch', normalizeIdListKey(postIds)] as const,
    byPoster: (posterId: string | null | undefined) =>
      ['market-posts-by-poster', normalizeId(posterId)] as const,
    bySound: (soundId: string | null | undefined) =>
      ['market-posts-by-sound', normalizeId(soundId)] as const,
    search: (searchTerm: string | null | undefined) =>
      ['market-posts-search', String(searchTerm ?? '').trim().toLowerCase()] as const,
    sellersSearch: (searchTerm: string, city: string, state: string) =>
      [
        'sellers-search',
        String(searchTerm ?? '').trim().toLowerCase(),
        String(city ?? '').trim().toLowerCase(),
        String(state ?? '').trim().toLowerCase(),
      ] as const,
    comments: (postId: string | null | undefined) =>
      ['market-post-comments', normalizeId(postId)] as const,
  },

  sounds: {
    byId: (soundId: string | null | undefined) => ['sound', normalizeId(soundId)] as const,
    list: (searchTerm: string | null | undefined, limit = 60) =>
      ['sounds', 'list', String(searchTerm ?? '').trim().toLowerCase(), limit] as const,
    saved: (userId: string | null | undefined) =>
      ['sounds', 'saved', normalizeId(userId)] as const,
    savedIds: (userId: string | null | undefined) =>
      ['sounds', 'saved-ids', normalizeId(userId)] as const,
  },

  feed: {
    /** Stable root — session lives in infinite pageParam / page data, not the key. */
    infinite: (mode: 'forYou' | 'following' | 'public', userId?: string | null) =>
      ['feed', 'infinite', mode, normalizeId(userId) ?? 'guest'] as const,
  },

  chat: {
    inbox: (userId: string | null | undefined) => ['chat', 'inbox', normalizeId(userId)] as const,
    thread: (threadId: string | null | undefined) =>
      ['chat', 'thread', normalizeId(threadId)] as const,
    pendingThread: (postId: string | null | undefined, peerId: string | null | undefined) =>
      ['chat', 'thread', 'pending', normalizeId(postId), normalizeId(peerId)] as const,
  },

  orders: {
    byId: (orderId: string | null | undefined) => ['order', normalizeId(orderId)] as const,
    list: (userId: string | null | undefined, role: 'buyer' | 'seller' | 'all' = 'all') =>
      ['orders', normalizeId(userId), role] as const,
  },

  notifications: {
    list: (userId: string | null | undefined) =>
      ['notifications', normalizeId(userId)] as const,
  },
} as const;
