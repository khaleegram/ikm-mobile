import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { firestore } from '../config';

export interface MarketStatus {
  id: string;
  sellerId: string;
  mediaUrl: string;
  createdAt: number;
  expiresAt: number;
}

export async function addMarketStatus(sellerId: string, mediaUrl: string) {
  const statusRef = doc(collection(firestore, 'marketStatuses'));
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours from now

  await setDoc(statusRef, {
    sellerId,
    mediaUrl,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAt),
  });
  
  return statusRef.id;
}

export function useActiveStatuses(sellerIds: string[]) {
  const [statuses, setStatuses] = useState<Record<string, MarketStatus[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const validIds = Array.from(new Set(sellerIds.filter(Boolean))).slice(0, 10);
    
    if (validIds.length === 0) {
      setStatuses({});
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(firestore, 'marketStatuses'),
      where('sellerId', 'in', validIds),
      where('expiresAt', '>', Timestamp.now()),
      orderBy('expiresAt', 'desc'),
      orderBy('createdAt', 'asc') // chronological order per seller
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const grouped: Record<string, MarketStatus[]> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const status: MarketStatus = {
            id: docSnap.id,
            sellerId: data.sellerId,
            mediaUrl: data.mediaUrl,
            createdAt: data.createdAt?.toMillis() || 0,
            expiresAt: data.expiresAt?.toMillis() || 0,
          };
          
          if (!grouped[status.sellerId]) {
            grouped[status.sellerId] = [];
          }
          grouped[status.sellerId].push(status);
        });
        
        setStatuses(grouped);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching market statuses:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [JSON.stringify(sellerIds)]);

  return { statuses, loading };
}

export function useMyActiveStatuses(userId: string | null) {
  const [myStatuses, setMyStatuses] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setMyStatuses([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(firestore, 'marketStatuses'),
      where('sellerId', '==', userId),
      where('expiresAt', '>', Timestamp.now()),
      orderBy('expiresAt', 'desc'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const results: MarketStatus[] = [];
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          results.push({
            id: docSnap.id,
            sellerId: data.sellerId,
            mediaUrl: data.mediaUrl,
            createdAt: data.createdAt?.toMillis() || 0,
            expiresAt: data.expiresAt?.toMillis() || 0,
          });
        });
        
        setMyStatuses(results);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching my market statuses:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { myStatuses, loading };
}
