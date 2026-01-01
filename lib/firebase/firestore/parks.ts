// Parks Firestore hooks
// Since parks are managed via Cloud Functions, we use API calls instead of Firestore listeners
import { useState, useEffect } from 'react';
import { parksApi } from '@/lib/api/parks';
import { Park } from '@/types';

/**
 * Hook to fetch all parks
 * Note: Parks are read-only via Cloud Functions, so we use API calls instead of Firestore listeners
 */
export function useParks() {
  const [parks, setParks] = useState<Park[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchParks() {
      try {
        setLoading(true);
        setError(null);
        const data = await parksApi.getAll();
        if (mounted) {
          setParks(data);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to fetch parks'));
          setLoading(false);
        }
      }
    }

    fetchParks();

    return () => {
      mounted = false;
    };
  }, []);

  return { parks, loading, error };
}

/**
 * Hook to fetch parks by state
 */
export function useParksByState(state: string | null) {
  const [parks, setParks] = useState<Park[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchParks() {
      if (!state) {
        if (mounted) {
          setParks([]);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const data = await parksApi.getByState(state);
        if (mounted) {
          setParks(data);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to fetch parks by state'));
          setLoading(false);
        }
      }
    }

    fetchParks();

    return () => {
      mounted = false;
    };
  }, [state]);

  return { parks, loading, error };
}

