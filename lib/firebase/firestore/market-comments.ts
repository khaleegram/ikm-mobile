import { useEffect, useState } from 'react';

import { marketCommentsApi } from '@/lib/api/market-comments';
import { MarketComment } from '@/types';

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

    let cancelled = false;
    setLoading(true);
    marketCommentsApi
      .list(postId)
      .then((list) => {
        if (cancelled) return;
        setComments(list);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err?.message || 'Failed to load comments')));
        setComments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [postId]);

  const loadMore = async () => {
    // Pagination not required for v1 API list.
  };

  return { comments, loading, error, hasMore: false, loadingMore: false, loadMore };
}
