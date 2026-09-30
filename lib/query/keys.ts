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

  checkout: {
    // Offers are read on every sheet open, so they are cached briefly rather than
    // refetched each time — but short enough that toggling a campaign off in admin
    // takes effect while a buyer is still on the screen.
    livePromos: () => ['checkout', 'promos', 'live'] as const,
    // Keyed by the cart and the code, so a keystroke re-prices and a stale price is
    // never shown for a different cart.
    quote: (cartSignature: string, code: string | null) =>
      ['checkout', 'quote', cartSignature, code || ''] as const,
  },

  promo: {
    /** Root for operator-side campaign state, so one invalidation covers the screen. */
    all: ['promo', 'admin'] as const,
    campaigns: (includeArchived: boolean) =>
      ['promo', 'admin', 'campaigns', includeArchived ? 'with-archived' : 'active'] as const,
    campaign: (campaignId: string | null | undefined) =>
      ['promo', 'admin', 'campaign', normalizeId(campaignId)] as const,
    reconciliation: () => ['promo', 'admin', 'reconciliation'] as const,
  },
} as const;
