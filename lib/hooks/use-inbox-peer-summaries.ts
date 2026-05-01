import { useEffect, useState } from 'react';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';

import { firestore } from '@/lib/firebase/config';

export type InboxPeerSummary = {
  displayName: string;
  avatarUri?: string;
};

function summaryFromUserDoc(data: Record<string, unknown> | undefined): InboxPeerSummary | null {
  if (!data) return null;
  const first = String(data.firstName || '').trim();
  const last = String(data.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  const displayName =
    full ||
    String(data.displayName || '').trim() ||
    String(data.storeName || '').trim() ||
    '';
  if (!displayName) return null;
  const storeLogo = typeof data.storeLogoUrl === 'string' ? data.storeLogoUrl : '';
  const photo = typeof data.photoURL === 'string' ? data.photoURL : '';
  const avatarUri = storeLogo || photo || undefined;
  return { displayName, avatarUri };
}

function peerIdsContentKey(peerIds: (string | null | undefined)[]): string {
  const set = new Set<string>();
  peerIds.forEach((id) => {
    const s = String(id || '').trim();
    if (s) set.add(s);
  });
  return [...set].sort().join(',');
}

/**
 * Hydrates inbox peer names/avatars in one batched layer instead of N× useUserProfile in rows.
 */
export function useInboxPeerSummaries(peerIds: (string | null | undefined)[]): Record<string, InboxPeerSummary> {
  const stableIdsKey = peerIdsContentKey(peerIds);

  const [map, setMap] = useState<Record<string, InboxPeerSummary>>({});

  useEffect(() => {
    const stableIds = stableIdsKey ? stableIdsKey.split(',').filter(Boolean) : [];
    if (stableIds.length === 0) {
      setMap({});
      return;
    }

    const wanted = new Set(stableIds);
    setMap((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (!wanted.has(k)) delete next[k];
      });
      return next;
    });

    const unsubs: Unsubscribe[] = stableIds.map((id) =>
      onSnapshot(
        doc(firestore, 'users', id),
        (snap) => {
          if (!snap.exists()) {
            setMap((prev) => {
              if (!prev[id]) return prev;
              const { [id]: _, ...rest } = prev;
              return rest;
            });
            return;
          }
          const summary = summaryFromUserDoc(snap.data() as Record<string, unknown>);
          if (!summary) return;
          setMap((prev) => {
            const cur = prev[id];
            if (
              cur &&
              cur.displayName === summary.displayName &&
              cur.avatarUri === summary.avatarUri
            ) {
              return prev;
            }
            return { ...prev, [id]: summary };
          });
        },
        () => {
          setMap((prev) => {
            if (!prev[id]) return prev;
            const { [id]: _, ...rest } = prev;
            return rest;
          });
        },
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, [stableIdsKey]);

  return map;
}
