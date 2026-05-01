import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  FieldPath,
  collection,
  doc,
  DocumentData,
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
  const coverImageUrl = String(data.coverImageUrl || '').trim();
  const soundTitle = String(data.soundMeta?.title || '').trim();
  const soundSourceUri = String(data.soundMeta?.sourceUri || '').trim();
  const images = asStringArray(data.images);

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
      where('status', '==', 'active'),
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

  const loadMore = () => {
    if (!hasMore || loading || !lastDocRef.current) return;

    setLoading(true);
    const nextQuery = query(
      collection(firestore, 'marketPosts'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      startAfter(lastDocRef.current),
      limit(MARKET_FEED_PAGE_SIZE)
    );

    const unsubscribe = onSnapshot(
      nextQuery,
      (snapshot) => {
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
        setLoading(false);
        unsubscribe();
      },
      (err) => {
        console.error('Error loading more market posts:', err);
        setError(err);
        setLoading(false);
        unsubscribe();
      }
    );
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

    let isMounted = true;
    const cacheKey = `market_posts_user_${userId}`;

    (async () => {
      const cached = await getCachedData<MarketPost[]>(cacheKey);
      if (!isMounted || !cached || cached.length === 0) return;
      setPosts(normalizeCachedPosts(cached));
      setLoading(false);
    })();

    const baseQuery = query(
      collection(firestore, 'marketPosts'),
      where('posterId', '==', userId),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      baseQuery,
      buildPostsCacheUpdater(setPosts, setLoading, setError, cacheKey),
      (err) => {
        console.error('Error fetching user market posts:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [userId]);

  return { posts, loading, error };
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
      where('likedBy', 'array-contains', userId),
      where('status', '==', 'active')
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

    let isMounted = true;
    const cacheKey = `market_post_${postId}`;

    (async () => {
      const cached = await getCachedData<MarketPost>(cacheKey);
      if (!isMounted || !cached) return;
      setPost({
        ...cached,
        createdAt: asDate(cached.createdAt),
        updatedAt: asDate(cached.updatedAt),
        expiresAt: cached.expiresAt ? asDate(cached.expiresAt) : undefined,
      });
      setLoading(false);
    })();

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'marketPosts', postId),
      (snapshot) => {
        if (snapshot.exists()) {
          const marketPost = normalizeMarketPostRecord(snapshot.id, snapshot.data());
          setPost(marketPost);
          cacheData(cacheKey, marketPost, MARKET_POST_CACHE_TTL_MS).catch(() => {});
        } else {
          setPost(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching market post:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
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

    setLoading(true);
    setError(null);

    const queryLower = searchQuery.trim().toLowerCase();
    const isHashtag = queryLower.startsWith('#');
    const hashtag = isHashtag ? queryLower.slice(1) : queryLower;

    if (isHashtag && hashtag) {
      const hashtagQuery = query(
        collection(firestore, 'marketPosts'),
        where('status', '==', 'active'),
        where('hashtags', 'array-contains', hashtag),
        orderBy('createdAt', 'desc'),
        limit(50)
      );

      const unsubscribe: Unsubscribe = onSnapshot(
        hashtagQuery,
        (snapshot) => {
          setPosts(snapshot.docs.map((documentSnapshot) => normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data())));
          setLoading(false);
          setError(null);
        },
        (err) => {
          console.error('Error searching market posts by hashtag:', err);
          setError(err);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    }

    const textSearchQuery = query(
      collection(firestore, 'marketPosts'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      textSearchQuery,
      (snapshot) => {
        const searchTerms = queryLower.split(' ').filter((term) => term.length > 0);
        const nextPosts = snapshot.docs
          .map((documentSnapshot) => normalizeMarketPostRecord(documentSnapshot.id, documentSnapshot.data()))
          .filter((post) => {
            const description = String(post.description || '').toLowerCase();
            const locationState = String(post.location?.state || '').toLowerCase();
            const locationCity = String(post.location?.city || '').toLowerCase();
            const hashtags = (post.hashtags || []).map((tag) => tag.toLowerCase());
            const soundTitle = String(post.soundMeta?.title || '').toLowerCase();

            return searchTerms.some((term) => {
              return (
                description.includes(term) ||
                locationState.includes(term) ||
                locationCity.includes(term) ||
                soundTitle.includes(term) ||
                hashtags.some((tag) => tag.includes(term))
              );
            });
          });

        setPosts(nextPosts);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error searching market posts:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
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
      where('status', '==', 'active'),
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
        where('status', '==', 'active'),
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
    where('status', '==', 'active'),
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
