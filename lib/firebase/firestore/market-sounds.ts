import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Unsubscribe,
  where,
} from 'firebase/firestore';

import { firestore } from '../config';
import type { MarketSound } from '@/types';

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

export function normalizeMarketSoundRecord(id: string, data: any): MarketSound {
  return {
    id,
    title: String(data.title || '').trim() || 'Untitled sound',
    createdBy: String(data.createdBy || '').trim(),
    creatorName: String(data.creatorName || '').trim() || undefined,
    sourceType: data.sourceType || 'uploaded',
    sourceUri: String(data.sourceUri || '').trim(),
    artworkUrl: String(data.artworkUrl || '').trim() || undefined,
    durationMs: Number.isFinite(data.durationMs) ? Number(data.durationMs) : undefined,
    usageCount: typeof data.usageCount === 'number' ? data.usageCount : 0,
    savedCount: typeof data.savedCount === 'number' ? data.savedCount : 0,
    rightsStatus: data.rightsStatus || 'owned',
    status: data.status || 'active',
    createdAt: asDate(data.createdAt),
    updatedAt: asDate(data.updatedAt),
  };
}

export function useMarketSounds(searchQuery?: string | null, maxItems: number = 60) {
  const [sounds, setSounds] = useState<MarketSound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const soundsQuery = query(
      collection(firestore, 'marketSounds'),
      where('status', '==', 'active'),
      orderBy('usageCount', 'desc'),
      limit(maxItems)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      soundsQuery,
      (snapshot) => {
        setSounds(snapshot.docs.map((documentSnapshot) => normalizeMarketSoundRecord(documentSnapshot.id, documentSnapshot.data())));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching market sounds:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [maxItems]);

  const filteredSounds = useMemo(() => {
    const normalizedQuery = String(searchQuery || '').trim().toLowerCase();
    if (!normalizedQuery) return sounds;

    const searchTerms = normalizedQuery.split(/\s+/).filter(Boolean);
    return sounds.filter((sound) => {
      const title = String(sound.title || '').toLowerCase();
      const creatorName = String(sound.creatorName || '').toLowerCase();
      return searchTerms.every((term) => title.includes(term) || creatorName.includes(term));
    });
  }, [searchQuery, sounds]);

  return { sounds: filteredSounds, loading, error };
}

export function useMarketSound(soundId: string | null) {
  const [sound, setSound] = useState<MarketSound | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!soundId) {
      setSound(null);
      setLoading(false);
      return;
    }

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'marketSounds', soundId),
      (snapshot) => {
        if (snapshot.exists()) {
          setSound(normalizeMarketSoundRecord(snapshot.id, snapshot.data()));
        } else {
          setSound(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching market sound:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [soundId]);

  return { sound, loading, error };
}

export function useUserSavedSoundIds(userId: string | null) {
  const [soundIds, setSoundIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setSoundIds([]);
      setLoading(false);
      return;
    }

    const savesQuery = query(
      collection(firestore, 'marketSoundSaves'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(150)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      savesQuery,
      (snapshot) => {
        setSoundIds(
          snapshot.docs
            .map((documentSnapshot) => String(documentSnapshot.data()?.soundId || '').trim())
            .filter(Boolean)
        );
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching saved market sounds:', err);
        setSoundIds([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { soundIds, loading };
}

export function useSavedMarketSounds(userId: string | null) {
  const { sounds, loading: soundsLoading, error } = useMarketSounds(null, 120);
  const { soundIds, loading: savesLoading } = useUserSavedSoundIds(userId);

  const savedSounds = useMemo(() => {
    if (!soundIds.length) return [];
    const soundIdSet = new Set(soundIds);
    return sounds.filter((sound) => sound.id && soundIdSet.has(sound.id));
  }, [soundIds, sounds]);

  return {
    sounds: savedSounds,
    loading: soundsLoading || savesLoading,
    error,
  };
}

export function useIsMarketSoundSaved(soundId: string | null, userId: string | null) {
  const { soundIds, loading } = useUserSavedSoundIds(userId);
  const isSaved = Boolean(soundId && soundIds.includes(soundId));
  return { isSaved, loading };
}
