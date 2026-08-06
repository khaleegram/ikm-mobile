import { useMemo } from 'react';

import {
  avatarUriFromProfile,
  displayNameFromProfile,
  useUsersBatch,
} from '@/lib/hooks/use-user-identity';

export type InboxPeerSummary = {
  displayName: string;
  storeName?: string;
  avatarUri?: string;
  isVerified?: boolean;
};

/**
 * Hydrates inbox peer names/avatars via one batched Query (`GET /v1/users/batch`).
 * Replaces the previous N× Firestore onSnapshot listeners per peer row.
 */
export function useInboxPeerSummaries(
  peerIds: (string | null | undefined)[]
): Record<string, InboxPeerSummary> {
  const { byId } = useUsersBatch(peerIds);

  return useMemo(() => {
    const map: Record<string, InboxPeerSummary> = {};
    for (const [id, profile] of Object.entries(byId)) {
      // Always emit a row so avatar can paint even when name falls back.
      map[id] = {
        displayName: displayNameFromProfile(profile, 'Store'),
        storeName: String(profile.storeName || '').trim() || undefined,
        avatarUri: avatarUriFromProfile(profile),
      };
    }
    return map;
  }, [byId]);
}
