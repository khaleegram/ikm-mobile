import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { BackHandler, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import {
  buildDirectConversationId,
  resolveDirectConversationPeerId,
} from '@/lib/chat/conversation-ids';
import { isPostgresChatBackend } from '@/lib/config/chat-backend';
import { isPendingThreadId } from '@/lib/stores/chat-thread-cache';

const THREAD_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChatRouteParams = {
  chatId: string;
  peerId?: string;
  legacyChatId?: string;
};

type UseChatRouteResult = {
  activeChatId: string | null;
  directConversationId: string | null;
  legacyChatId: string | null;
  resolvedPeerId: string | null;
  setActiveChatId: Dispatch<SetStateAction<string | null>>;
  goBack: () => void;
  syncRouteChatId: (chatId: string) => void;
};

export function useChatRoute(userId: string | null): UseChatRouteResult {
  const params = useLocalSearchParams<ChatRouteParams>();

  const routeChatId = useMemo(() => {
    const value = Array.isArray(params.chatId) ? params.chatId[0] : params.chatId;
    const normalized = String(value || '').trim();
    return normalized || null;
  }, [params.chatId]);

  const peerIdParam = useMemo(() => {
    const value = Array.isArray(params.peerId) ? params.peerId[0] : params.peerId;
    const normalized = String(value || '').trim();
    return normalized || null;
  }, [params.peerId]);

  const legacyChatIdParam = useMemo(() => {
    const value = Array.isArray(params.legacyChatId) ? params.legacyChatId[0] : params.legacyChatId;
    const normalized = String(value || '').trim();
    return normalized || null;
  }, [params.legacyChatId]);

  const peerFromRouteConversation = useMemo(() => {
    if (!userId || !routeChatId) return null;
    return resolveDirectConversationPeerId(routeChatId, userId);
  }, [routeChatId, userId]);

  const resolvedPeerId = useMemo(
    () => peerIdParam || peerFromRouteConversation,
    [peerFromRouteConversation, peerIdParam]
  );

  const directConversationId = useMemo(() => {
    if (!userId || !resolvedPeerId) return null;
    return buildDirectConversationId(userId, resolvedPeerId);
  }, [resolvedPeerId, userId]);

  const legacyChatId = useMemo(() => {
    if (legacyChatIdParam) return legacyChatIdParam;
    return routeChatId && !routeChatId.startsWith('direct_') ? routeChatId : null;
  }, [legacyChatIdParam, routeChatId]);

  const preferredChatId = useMemo(() => {
    if (isPostgresChatBackend()) {
      if (!routeChatId) return null;
      // Feed / optimistic opens navigate with a `pending:{postId}:{peerId}` id before the
      // real thread exists. Pass it through so the detail screen can resolve it into a UUID.
      if (isPendingThreadId(routeChatId)) return routeChatId;
      if (!THREAD_UUID_RE.test(routeChatId)) return null;
      return routeChatId;
    }
    if (directConversationId) return directConversationId;
    return routeChatId || null;
  }, [directConversationId, routeChatId]);

  const [activeChatId, setActiveChatId] = useState<string | null>(preferredChatId);

  useEffect(() => {
    setActiveChatId(preferredChatId);
  }, [preferredChatId]);

  const goBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(market)/messages' as any);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack();
        return true;
      });
      return () => subscription.remove();
    }, [goBack])
  );

  const syncRouteChatId = useCallback(
    (chatId: string) => {
      const normalized = String(chatId || '').trim();
      if (!normalized) return;
      if (routeChatId === normalized) return;
      if (typeof (router as any).setParams !== 'function') return;
      (router as any).setParams({ chatId: normalized });
    },
    [routeChatId]
  );

  return {
    activeChatId,
    directConversationId,
    legacyChatId,
    resolvedPeerId,
    setActiveChatId,
    goBack,
    syncRouteChatId,
  };
}
