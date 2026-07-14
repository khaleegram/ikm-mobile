import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  FieldPath,
  collection,
  doc,
  DocumentData,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  QueryDocumentSnapshot,
  query,
  startAfter,
  Unsubscribe,
  where,
} from 'firebase/firestore';

import { firestore } from '../config';
import type { MarketPost } from '@/types';
import { marketFeedApi } from '@/lib/api/market-feed';
import { cacheData, getCachedData } from '@/lib/utils/offline';

const MARKET_POSTS_CACHE_TTL_MS = 30 * 60 * 1000;
const MARKET_POST_CACHE_TTL_MS = 15 * 60 * 1000;

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];
}

export function normalizeMarketPostRecord(id: string, data: DocumentData): MarketPost {
  const videoUrl = String(data.videoUrl || '').trim();
  const soundTitle = String(data.soundMeta?.title || '').trim();
  const soundSourceUri = String(data.soundMeta?.sourceUri || '').trim();
  const images = asStringArray(data.images);
  const resolvedCoverImageUrl =
    String(data.coverImageUrl || '').trim() ||
    (videoUrl && images[0] ? images[0] : '');
  const coverImageUrl = resolvedCoverImageUrl;

  return {
    id,
    posterId: String(data.posterId || '').trim(),
    mediaType: data.mediaType || (videoUrl ? 'video' : 'image_gallery'),
    images,
    coverImageUrl: coverImageUrl || undefined,
    videoUrl: videoUrl || undefined,
    videoMeta:
      data.videoMeta || videoUrl
        ? {
            durationMs: Number.isFinite(data.videoMeta?.durationMs) ? Number(data.videoMeta.durationMs) : undefined,
            width: Number.isFinite(data.videoMeta?.width) ? Number(data.videoMeta.width) : undefined,
            height: Number.isFinite(data.videoMeta?.height) ? Number(data.videoMeta.height) : undefined,
            aspectRatio: Number.isFinite(data.videoMeta?.aspectRatio)
              ? Number(data.videoMeta.aspectRatio)
              : undefined,
            originalAudioMuted: Boolean(data.videoMeta?.originalAudioMuted),
          }
        : undefined,
    soundMeta:
      soundTitle || soundSourceUri
        ? {
            soundId: String(data.soundMeta?.soundId || '').trim() || undefined,
            title: soundTitle || 'Untitled sound',
            sourceUri: soundSourceUri || '',
            sourceType: data.soundMeta?.sourceType || 'uploaded',
            artworkUrl: String(data.soundMeta?.artworkUrl || '').trim() || undefined,
            durationMs: Number.isFinite(data.soundMeta?.durationMs) ? Number(data.soundMeta.durationMs) : undefined,
            startMs: Number.isFinite(data.soundMeta?.startMs) ? Number(data.soundMeta.startMs) : undefined,
            soundVolume: Number.isFinite(data.soundMeta?.soundVolume)
              ? Number(data.soundMeta.soundVolume)
              : undefined,
            originalAudioVolume: Number.isFinite(data.soundMeta?.originalAudioVolume)
              ? Number(data.soundMeta.originalAudioVolume)
              : undefined,
            useOriginalVideoAudio: Boolean(data.soundMeta?.useOriginalVideoAudio),
          }
        : undefined,
    hashtags: asStringArray(data.hashtags),
    price: Number.isFinite(data.price) ? Number(data.price) : undefined,
    isNegotiable: Boolean(data.isNegotiable),
    description: String(data.description || '').trim() || undefined,
    location:
      data.location && (data.location.state || data.location.city)
        ? {
            state: String(data.location.state || '').trim() || undefined,
            city: String(data.location.city || '').trim() || undefined,
          }
        : undefined,
    contactMethod: data.contactMethod || 'in-app',
    likes: typeof data.likes === 'number' ? data.likes : 0,
    views: typeof data.views === 'number' ? data.views : 0,
    comments: typeof data.comments === 'number' ? data.comments : 0,
    likedBy: asStringArray(data.likedBy),
    status: data.status || 'active',
    createdAt: asDate(data.createdAt),
    updatedAt: asDate(data.updatedAt),
    expiresAt: data.expiresAt ? asDate(data.expiresAt) : undefined,
  };
}

function normalizeCachedPosts(posts: MarketPost[]): MarketPost[] {
  return posts.map((item) => ({
    ...item,
    createdAt: asDate(item.createdAt),
    updatedAt: asDate(item.updatedAt),
    expiresAt: item.expiresAt ? asDate(item.expiresAt) : undefined,
  }));
}

function buildPostsCacheUpdater(
  setPosts: Dispatch<SetStateAction<MarketPost[]>>,
  setLoading: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<Error | null>>,
  cacheKey?: string
) {
  return (snapshot: { forEach: (callback: (doc: QueryDocumentSnapshot<DocumentData>) => void) => void }) => {
    const postsList: MarketPost[] = [];
    snapshot.forEach((documentSnapshot) => {
      postsList.push(normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data()));
    });
    setPosts(postsList);
    if (cacheKey) {
      cacheData(cacheKey, postsList, MARKET_POSTS_CACHE_TTL_MS).catch(() => {});
    }
    setLoading(false);
    setError(null);
  };
}

const MARKET_FEED_PAGE_SIZE = 15;
const PERSONALIZED_FEED_PAGE_SIZE = 25;

export function usePersonalizedMarketFeed(userId: string | null) {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const buildExcludeIds = useCallback(() => {
    return Array.from(seenIdsRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      const cacheKey = 'market_posts_feed';
      setLoading(true);
      setError(null);

      (async () => {
        const cached = await getCachedData<MarketPost[]>(cacheKey);
        if (!cancelled && cached && cached.length > 0) {
          setPosts(normalizeCachedPosts(cached));
          setLoading(false);
        }
      })();

      const baseQuery = query(
        collection(firestore, 'marketPosts'),
        orderBy('createdAt', 'desc'),
        limit(MARKET_FEED_PAGE_SIZE)
      );

      const unsubscribe = onSnapshot(
        baseQuery,
        (snapshot) => {
          const nextPosts = snapshot.docs.map((documentSnapshot) =>
            normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data())
          );
          if (snapshot.docs.length > 0) {
            lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
            setHasMore(snapshot.docs.length === MARKET_FEED_PAGE_SIZE);
          } else {
            lastDocRef.current = null;
            setHasMore(false);
          }
          setPosts(nextPosts);
          cacheData(cacheKey, nextPosts, MARKET_POSTS_CACHE_TTL_MS).catch(() => {});
          setLoading(false);
          setError(null);
        },
        (err) => {
          console.error('Error fetching market posts:', err);
          setError(err);
          setLoading(false);
        }
      );

      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    setLoading(true);
    setError(null);
    lastDocRef.current = null;

    (async () => {
      try {
        const result = await marketFeedApi.getPersonalizedFeed(buildExcludeIds());
        if (cancelled) return;
        const nextPosts = result.posts.map((post) =>
          normalizeMarketPostRecord(String(post.id || ''), post as DocumentData)
        );
        nextPosts.forEach((post) => {
          if (post.id) seenIdsRef.current.add(post.id);
        });
        setPosts(nextPosts);
        setHasMore(nextPosts.length >= PERSONALIZED_FEED_PAGE_SIZE);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching personalized market feed:', err);
          setError(err as Error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildExcludeIds, userId, refreshKey]);

  const loadMore = async () => {
    if (!hasMore || loading) return;

    if (!userId) {
      if (!lastDocRef.current) return;
      setLoading(true);
      const nextQuery = query(
        collection(firestore, 'marketPosts'),
        orderBy('createdAt', 'desc'),
        startAfter(lastDocRef.current),
        limit(MARKET_FEED_PAGE_SIZE)
      );

      try {
        const snapshot = await getDocs(nextQuery);
        const nextPosts = snapshot.docs.map((documentSnapshot) =>
          normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data())
        );
        if (snapshot.docs.length > 0) {
          lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
          setHasMore(snapshot.docs.length === MARKET_FEED_PAGE_SIZE);
          setPosts((previous) => [...previous, ...nextPosts]);
        } else {
          setHasMore(false);
        }
      } catch (err) {
        console.error('Error loading more market posts:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const result = await marketFeedApi.getPersonalizedFeed(buildExcludeIds());
      const nextPosts = result.posts
        .map((post) => normalizeMarketPostRecord(String(post.id || ''), post as DocumentData))
        .filter((post) => post.id && !seenIdsRef.current.has(post.id));

      nextPosts.forEach((post) => {
        if (post.id) seenIdsRef.current.add(post.id);
      });

      if (nextPosts.length > 0) {
        setPosts((previous) => [...previous, ...nextPosts]);
      }
      setHasMore(nextPosts.length >= PERSONALIZED_FEED_PAGE_SIZE / 2);
      setError(null);
    } catch (err) {
      console.error('Error loading more personalized feed:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const markSeen = useCallback((postIds: string[], dwellSec?: number) => {
    if (!postIds.length || !userId) return;
    postIds.forEach((id) => seenIdsRef.current.add(id));
    marketFeedApi.markSeen(postIds, dwellSec).catch(() => {});
  }, [userId]);

  return { posts, loading, error, loadMore, hasMore, refresh, markSeen };
}

export function useMarketPosts() {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    let isMounted = true;
    const cacheKey = 'market_posts_feed';

    setLoading(true);
    setError(null);

    (async () => {
      const cached = await getCachedData<MarketPost[]>(cacheKey);
      if (!isMounted || !cached || cached.length === 0) return;
      setPosts(normalizeCachedPosts(cached));
      setLoading(false);
    })();

    const baseQuery = query(
      collection(firestore, 'marketPosts'),
      orderBy('createdAt', 'desc'),
      limit(MARKET_FEED_PAGE_SIZE)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      baseQuery,
      (snapshot) => {
        const nextPosts: MarketPost[] = snapshot.docs.map((documentSnapshot) =>
          normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data())
        );
        if (snapshot.docs.length > 0) {
          lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
          setHasMore(snapshot.docs.length === MARKET_FEED_PAGE_SIZE);
        } else {
          lastDocRef.current = null;
          setHasMore(false);
        }
        setPosts(nextPosts);
        cacheData(cacheKey, nextPosts, MARKET_POSTS_CACHE_TTL_MS).catch(() => {});
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching market posts:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [refreshKey]);

  const loadMore = async () => {
    if (!hasMore || loading || !lastDocRef.current) return;

    setLoading(true);
    const nextQuery = query(
      collection(firestore, 'marketPosts'),
      orderBy('createdAt', 'desc'),
      startAfter(lastDocRef.current),
      limit(MARKET_FEED_PAGE_SIZE)
    );

    try {
      const snapshot = await getDocs(nextQuery);
      const nextPosts = snapshot.docs.map((documentSnapshot) =>
        normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data())
      );
      if (snapshot.docs.length > 0) {
        lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
        setHasMore(snapshot.docs.length === MARKET_FEED_PAGE_SIZE);
        setPosts((previous) => [...previous, ...nextPosts]);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Error loading more market posts:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    lastDocRef.current = null;
    setHasMore(true);
    setError(null);
    setRefreshKey((previous) => previous + 1);
  };

  return { posts, loading, error, loadMore, hasMore, refresh };
}

export function useUserMarketPosts(userId: string | null) {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setPosts([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { apiUrl } = await import('@/lib/api/api-base');
        const { coreCloudClient } = await import('@/lib/api/core-cloud-client');
        const response = await coreCloudClient.request<{ posts?: MarketPost[] }>(
          apiUrl(`/posts?posterId=${encodeURIComponent(userId)}&limit=60`),
          { method: 'GET', requiresAuth: true }
        );
        if (cancelled) return;
        const next = Array.isArray(response.posts)
          ? response.posts.map((p) => ({
              ...p,
              createdAt: asDate(p.createdAt),
              updatedAt: asDate(p.updatedAt),
            }))
          : [];
        setPosts(next);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err?.message || 'Failed to load posts')));
        setPosts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { posts, loading, error };
}

export function useUserLikedPostIds(userId: string | null) {
  const [likedPostIds, setLikedPostIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLikedPostIds([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { apiUrl } = await import('@/lib/api/api-base');
        const { coreCloudClient } = await import('@/lib/api/core-cloud-client');
        const response = await coreCloudClient.request<{ ids?: string[] }>(apiUrl('/social/liked'), {
          method: 'GET',
          requiresAuth: true,
        });
        if (!cancelled) setLikedPostIds(Array.isArray(response.ids) ? response.ids : []);
      } catch {
        if (!cancelled) setLikedPostIds([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { likedPostIds, idSet: new Set(likedPostIds), loading };
}

export function useUserLikesCount(userId: string | null) {
  const [likesCount, setLikesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLikesCount(0);
      setLoading(false);
      return;
    }

    const likesQuery = query(
      collection(firestore, 'marketPosts'),
      where('likedBy', 'array-contains', userId)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      likesQuery,
      (snapshot) => {
        setLikesCount(snapshot.size);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching user likes count:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { likesCount, loading };
}

export function useMarketPost(postId: string | null) {
  const [post, setPost] = useState<MarketPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!postId) {
      setPost(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { marketPostsApi } = await import('@/lib/api/market-posts');
        const next = await marketPostsApi.getById(postId);
        if (cancelled) return;
        setPost(next);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err?.message || 'Failed to load post')));
        setPost(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [postId]);

  return { post, loading, error };
}

export function useMarketPostLikes(postId: string | null, userId: string | null) {
  const [likes, setLikes] = useState(0);
  const [likedBy, setLikedBy] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) {
      setLikes(0);
      setLikedBy([]);
      setLoading(false);
      return;
    }

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'marketPosts', postId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setLikes(typeof data.likes === 'number' ? data.likes : 0);
          setLikedBy(asStringArray(data.likedBy));
        } else {
          setLikes(0);
          setLikedBy([]);
        }
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching post likes:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [postId]);

  return {
    likes,
    likedBy,
    isLiked: userId ? likedBy.includes(userId) : false,
    loading,
  };
}

export function useMarketPostsSearch(searchQuery: string | null) {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!searchQuery || !searchQuery.trim()) {
      setPosts([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { marketPostsApi } = await import('@/lib/api/market-posts');
        const next = await marketPostsApi.search(searchQuery.trim(), 50);
        if (!cancelled) {
          setPosts(next);
          setError(null);
        }
      } catch (err: any) {
        console.error('Error searching market posts:', err);
        if (!cancelled) {
          setPosts([]);
          setError(err instanceof Error ? err : new Error(String(err?.message || err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  return { posts, loading, error };
}

export function useMarketPostsBySound(soundId: string | null) {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!soundId) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const soundPostsQuery = query(
      collection(firestore, 'marketPosts'),
      where('soundMeta.soundId', '==', soundId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      soundPostsQuery,
      (snapshot) => {
        setPosts(snapshot.docs.map((documentSnapshot) => normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data())));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching posts by sound:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [soundId]);

  return { posts, loading, error };
}

export function useMarketPostsByPosterIds(posterIds: string[], maxItems: number = 60) {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const cleanIds = Array.from(new Set(posterIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 30);
    if (cleanIds.length === 0) {
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Firestore `in` supports max 10 values; subscribe to chunks and merge.
    const chunks: string[][] = [];
    for (let i = 0; i < cleanIds.length; i += 10) {
      chunks.push(cleanIds.slice(i, i + 10));
    }

    const unsubs: Unsubscribe[] = [];
    const chunkResults = new Map<number, MarketPost[]>();

    const recompute = () => {
      const combined = Array.from(chunkResults.values()).flat();
      const dedup = new Map<string, MarketPost>();
      combined.forEach((post) => {
        if (post.id) dedup.set(post.id, post);
      });
      const sorted = Array.from(dedup.values()).sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      });
      setPosts(sorted.slice(0, Math.max(1, maxItems)));
      setLoading(false);
    };

    chunks.forEach((chunk, chunkIndex) => {
      const q = query(
        collection(firestore, 'marketPosts'),
        where(new FieldPath('posterId'), 'in', chunk),
        orderBy('createdAt', 'desc'),
        limit(Math.min(50, maxItems))
      );

      const unsub = onSnapshot(
        q,
        (snapshot) => {
          chunkResults.set(
            chunkIndex,
            snapshot.docs.map((docSnap) => normalizeMarketPostRecord(docSnap.id, docSnap.data()))
          );
          recompute();
        },
        (err) => {
          console.error('Error fetching market posts by poster ids:', err);
          setError(err);
          chunkResults.set(chunkIndex, []);
          recompute();
        }
      );
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [maxItems, posterIds]);

  return { posts, loading, error };
}

// Atomic pure JS subscription to avoid React mount leaks
export function subscribeToMarketPosts(onPostsUpdate: (posts: MarketPost[]) => void): Unsubscribe {
  const q = query(
    collection(firestore, 'marketPosts'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const postsList: MarketPost[] = [];
      snapshot.forEach((documentSnapshot) => {
        postsList.push(normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data()));
      });
      onPostsUpdate(postsList);
    },
    (err) => {
      console.error('Error in atomic market posts sub:', err);
    }
  );
}

export function useMarketPostsByIds(postIds: string[], maxItems: number = 20) {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const idsKey = postIds.filter(Boolean).join('|');

  useEffect(() => {
    const validIds = Array.from(new Set(postIds.filter(Boolean))).slice(0, Math.max(1, maxItems));
    if (validIds.length === 0) {
      setPosts([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { marketPostsApi } = await import('@/lib/api/market-posts');
        const next = await marketPostsApi.getBatch(validIds);
        if (cancelled) return;
        const byId = new Map(next.map((p) => [String(p.id), p]));
        setPosts(validIds.map((id) => byId.get(id)).filter(Boolean) as MarketPost[]);
      } catch (err: any) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err?.message || 'Failed to load posts')));
        setPosts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idsKey, maxItems]);

  return { posts, loading, error };
}
