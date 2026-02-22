// Client-side hooks for reading Market Post data (read-only)
import { useEffect, useState, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { firestore } from '../config';
import { MarketPost } from '@/types';
import { doc } from 'firebase/firestore';
import { cacheData, getCachedData } from '@/lib/utils/offline';

const MARKET_POSTS_CACHE_TTL_MS = 30 * 60 * 1000;
const MARKET_POST_CACHE_TTL_MS = 15 * 60 * 1000;

function asDate(value: any): Date {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// Get Market Posts with pagination and real-time updates
export function useMarketPosts() {
  const [posts, setPosts] = useState<MarketPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const PAGE_SIZE = 15;

  useEffect(() => {
    let isMounted = true;
    const cacheKey = 'market_posts_feed';

    (async () => {
      const cached = await getCachedData<MarketPost[]>(cacheKey);
      if (!isMounted || !cached || cached.length === 0) return;
      const normalizedCached = cached.map((item) => ({
        ...item,
        createdAt: asDate((item as any).createdAt),
        updatedAt: asDate((item as any).updatedAt),
        expiresAt: (item as any).expiresAt ? asDate((item as any).expiresAt) : undefined,
      }));
      setPosts(normalizedCached);
      setLoading(false);
    })();

    const q = query(
      collection(firestore, 'marketPosts'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const postsList: MarketPost[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const post: MarketPost = {
            id: doc.id,
            posterId: data.posterId || '',
            images: data.images || [],
            hashtags: data.hashtags || [],
            price: data.price,
            description: data.description,
            location: data.location,
            contactMethod: data.contactMethod || 'in-app',
            isNegotiable: Boolean(data.isNegotiable),
            likes: typeof data.likes === 'number' ? data.likes : 0,
            views: typeof data.views === 'number' ? data.views : 0,
            comments: typeof data.comments === 'number' ? data.comments : 0,
            likedBy: data.likedBy || [],
            status: data.status || 'active',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            expiresAt: data.expiresAt?.toDate(),
          };
          postsList.push(post);
        });
        
        // Update lastDocRef
        if (snapshot.docs.length > 0) {
          lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
          setHasMore(snapshot.docs.length === PAGE_SIZE);
        } else {
          setHasMore(false);
        }
        
        setPosts(postsList);
        cacheData(cacheKey, postsList, MARKET_POSTS_CACHE_TTL_MS).catch(() => {});
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
  }, []);

  const loadMore = () => {
    if (!hasMore || loading || !lastDocRef.current) return;

    setLoading(true);
    const q = query(
      collection(firestore, 'marketPosts'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      startAfter(lastDocRef.current),
      limit(PAGE_SIZE)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newPosts: MarketPost[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const post: MarketPost = {
            id: doc.id,
            posterId: data.posterId || '',
            images: data.images || [],
            hashtags: data.hashtags || [],
            price: data.price,
            description: data.description,
            location: data.location,
            contactMethod: data.contactMethod || 'in-app',
            isNegotiable: Boolean(data.isNegotiable),
            likes: typeof data.likes === 'number' ? data.likes : 0,
            views: typeof data.views === 'number' ? data.views : 0,
            comments: typeof data.comments === 'number' ? data.comments : 0,
            likedBy: data.likedBy || [],
            status: data.status || 'active',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            expiresAt: data.expiresAt?.toDate(),
          };
          newPosts.push(post);
        });

        if (snapshot.docs.length > 0) {
          lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
          setHasMore(snapshot.docs.length === PAGE_SIZE);
          setPosts((prev) => [...prev, ...newPosts]);
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
    setPosts([]);
    setHasMore(true);
    setLoading(true);
    // The useEffect will automatically refetch
  };

  return { posts, loading, error, loadMore, hasMore, refresh };
}

// Get user's Market Posts with real-time updates
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
      const normalizedCached = cached.map((item) => ({
        ...item,
        createdAt: asDate((item as any).createdAt),
        updatedAt: asDate((item as any).updatedAt),
        expiresAt: (item as any).expiresAt ? asDate((item as any).expiresAt) : undefined,
      }));
      setPosts(normalizedCached);
      setLoading(false);
    })();

    const q = query(
      collection(firestore, 'marketPosts'),
      where('posterId', '==', userId),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const postsList: MarketPost[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const post: MarketPost = {
            id: doc.id,
            posterId: data.posterId || '',
            images: data.images || [],
            hashtags: data.hashtags || [],
            price: data.price,
            description: data.description,
            location: data.location,
            contactMethod: data.contactMethod || 'in-app',
            isNegotiable: Boolean(data.isNegotiable),
            likes: typeof data.likes === 'number' ? data.likes : 0,
            views: typeof data.views === 'number' ? data.views : 0,
            comments: typeof data.comments === 'number' ? data.comments : 0,
            likedBy: data.likedBy || [],
            status: data.status || 'active',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            expiresAt: data.expiresAt?.toDate(),
          };
          postsList.push(post);
        });
        setPosts(postsList);
        cacheData(cacheKey, postsList, MARKET_POSTS_CACHE_TTL_MS).catch(() => {});
        setLoading(false);
        setError(null);
      },
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

// Get user's total likes count (sum of likes on all posts they've liked)
export function useUserLikesCount(userId: string | null) {
  const [likesCount, setLikesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLikesCount(0);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'marketPosts'),
      where('likedBy', 'array-contains', userId),
      where('status', '==', 'active')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
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

// Get single Market Post with real-time updates
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
        createdAt: asDate((cached as any).createdAt),
        updatedAt: asDate((cached as any).updatedAt),
        expiresAt: (cached as any).expiresAt ? asDate((cached as any).expiresAt) : undefined,
      });
      setLoading(false);
    })();

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'marketPosts', postId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const marketPost: MarketPost = {
            id: snapshot.id,
            posterId: data.posterId || '',
            images: data.images || [],
            hashtags: data.hashtags || [],
            price: data.price,
            description: data.description,
            location: data.location,
            contactMethod: data.contactMethod || 'in-app',
            isNegotiable: Boolean(data.isNegotiable),
            likes: typeof data.likes === 'number' ? data.likes : 0,
            views: typeof data.views === 'number' ? data.views : 0,
            comments: typeof data.comments === 'number' ? data.comments : 0,
            likedBy: data.likedBy || [],
            status: data.status || 'active',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            expiresAt: data.expiresAt?.toDate(),
          };
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

// Track likes for a post
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
          setLikedBy(data.likedBy || []);
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

  const isLiked = userId ? likedBy.includes(userId) : false;

  return { likes, likedBy, isLiked, loading };
}

// Search Market Posts by hashtag or text
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

    // If it's a hashtag search, use array-contains
    if (isHashtag && hashtag) {
      const q = query(
        collection(firestore, 'marketPosts'),
        where('status', '==', 'active'),
        where('hashtags', 'array-contains', hashtag),
        orderBy('createdAt', 'desc'),
        limit(50) // Limit search results
      );

      const unsubscribe: Unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const postsList: MarketPost[] = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            const post: MarketPost = {
              id: doc.id,
              posterId: data.posterId || '',
              images: data.images || [],
              hashtags: data.hashtags || [],
              price: data.price,
              description: data.description,
              location: data.location,
              contactMethod: data.contactMethod || 'in-app',
            isNegotiable: Boolean(data.isNegotiable),
              likes: typeof data.likes === 'number' ? data.likes : 0,
              views: typeof data.views === 'number' ? data.views : 0,
              comments: typeof data.comments === 'number' ? data.comments : 0,
              likedBy: data.likedBy || [],
              status: data.status || 'active',
              createdAt: data.createdAt?.toDate() || new Date(),
              updatedAt: data.updatedAt?.toDate() || new Date(),
              expiresAt: data.expiresAt?.toDate(),
            };
            postsList.push(post);
          });
          setPosts(postsList);
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
    } else {
      // Text search - fetch all active posts and filter client-side
      // Note: For production, consider using Algolia or similar for full-text search
      const q = query(
        collection(firestore, 'marketPosts'),
        where('status', '==', 'active'),
        orderBy('createdAt', 'desc'),
        limit(100) // Fetch more for text search filtering
      );

      const unsubscribe: Unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const postsList: MarketPost[] = [];
          const searchTerms = queryLower.split(' ').filter((term) => term.length > 0);

          snapshot.forEach((doc) => {
            const data = doc.data();
            const description = (data.description || '').toLowerCase();
            const locationState = (data.location?.state || '').toLowerCase();
            const locationCity = (data.location?.city || '').toLowerCase();
            const hashtags = (data.hashtags || []).map((tag: string) => tag.toLowerCase());

            // Check if any search term matches description, location, or hashtags
            const matches = searchTerms.some((term) => {
              return (
                description.includes(term) ||
                locationState.includes(term) ||
                locationCity.includes(term) ||
                hashtags.some((tag: string) => tag.includes(term))
              );
            });

            if (matches) {
              const post: MarketPost = {
                id: doc.id,
                posterId: data.posterId || '',
                images: data.images || [],
                hashtags: data.hashtags || [],
                price: data.price,
                description: data.description,
                location: data.location,
                contactMethod: data.contactMethod || 'in-app',
            isNegotiable: Boolean(data.isNegotiable),
                likes: typeof data.likes === 'number' ? data.likes : 0,
                views: typeof data.views === 'number' ? data.views : 0,
                comments: typeof data.comments === 'number' ? data.comments : 0,
                likedBy: data.likedBy || [],
                status: data.status || 'active',
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
                expiresAt: data.expiresAt?.toDate(),
              };
              postsList.push(post);
            }
          });

          setPosts(postsList);
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
    }
  }, [searchQuery]);

  return { posts, loading, error };
}

