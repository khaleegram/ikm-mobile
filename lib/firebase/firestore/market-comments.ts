import { useEffect, useRef, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  Unsubscribe,
  where,
  DocumentData,
} from 'firebase/firestore';
import { firestore } from '../config';
import { MarketComment } from '@/types';

const COMMENTS_PAGE_SIZE = 30;

function buildComment(docSnap: QueryDocumentSnapshot<DocumentData>): MarketComment {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    postId: data.postId || '',
    userId: data.userId || '',
    comment: data.comment || '',
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate(),
  };
}

export function useMarketPostComments(postId: string | null) {
  const [comments, setComments] = useState<MarketComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    if (!postId) {
      setComments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(firestore, 'marketPostComments'),
      where('postId', '==', postId),
      orderBy('createdAt', 'desc'),
      limit(COMMENTS_PAGE_SIZE)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map(buildComment);
        if (snapshot.docs.length > 0) {
          lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
          setHasMore(snapshot.docs.length === COMMENTS_PAGE_SIZE);
        } else {
          lastDocRef.current = null;
          setHasMore(false);
        }
        setComments(list);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching market post comments:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [postId]);

  const loadMore = async () => {
    if (!postId || !hasMore || loadingMore || !lastDocRef.current) return;
    setLoadingMore(true);

    const nextQuery = query(
      collection(firestore, 'marketPostComments'),
      where('postId', '==', postId),
      orderBy('createdAt', 'desc'),
      startAfter(lastDocRef.current),
      limit(COMMENTS_PAGE_SIZE)
    );

    try {
      const snapshot = await getDocs(nextQuery);
      const nextComments = snapshot.docs.map(buildComment);
      if (snapshot.docs.length > 0) {
        lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
        setHasMore(snapshot.docs.length === COMMENTS_PAGE_SIZE);
        setComments((prev) => [...prev, ...nextComments]);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Error loading more comments:', err);
      setError(err as Error);
    } finally {
      setLoadingMore(false);
    }
  };

  return { comments, loading, error, hasMore, loadingMore, loadMore };
}
