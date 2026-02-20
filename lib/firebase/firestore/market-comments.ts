// Client-side hooks for reading Market Comment data (read-only)
import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '../config';
import { MarketComment } from '@/types';

// Get comments for a Market Post with real-time updates
export function useMarketPostComments(postId: string | null) {
  const [comments, setComments] = useState<MarketComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!postId) {
      setComments([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'marketPostComments'),
      where('postId', '==', postId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const commentsList: MarketComment[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const comment: MarketComment = {
            id: doc.id,
            postId: data.postId || '',
            userId: data.userId || '',
            comment: data.comment || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate(),
          };
          commentsList.push(comment);
        });
        setComments(commentsList);
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

  return { comments, loading, error };
}
