import { useMemo } from 'react';

import { useUserProfile } from '@/lib/firebase/firestore/users';

import { resolveProfileName } from './utils';

type UseChatHeaderParams = {
  legacyChat: any;
  resolvedPeerId: string | null;
  userId: string | null;
};

type UseChatHeaderResult = {
  headerAvatarUri: string | undefined;
  headerName: string;
};

export function useChatHeader({
  legacyChat,
  resolvedPeerId,
  userId,
}: UseChatHeaderParams): UseChatHeaderResult {
  const headerPeerId = useMemo(() => {
    if (resolvedPeerId) return resolvedPeerId;
    if (!userId) return null;

    const participants = Array.isArray((legacyChat as any)?.participants)
      ? ((legacyChat as any).participants as string[])
      : [];
    const other = participants.find((participantId) => participantId && participantId !== userId);
    return other || null;
  }, [legacyChat, resolvedPeerId, userId]);

  const { user: headerPeerProfile } = useUserProfile(headerPeerId);

  const headerName = useMemo(() => {
    const fallback = headerPeerId ? 'Conversation' : 'Messages';
    return resolveProfileName(headerPeerProfile, fallback);
  }, [headerPeerId, headerPeerProfile]);

  const headerAvatarUri = useMemo(
    () => headerPeerProfile?.storeLogoUrl || (headerPeerProfile as any)?.photoURL || undefined,
    [headerPeerProfile]
  );

  return {
    headerAvatarUri,
    headerName,
  };
}
