import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { BackHandler, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';

import {
  buildDirectConversationId,
  resolveDirectConversationPeerId,
} from '@/lib/api/market-messages';

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
  goBackToInbox: () => void;
  syncRouteChatId: (chatId: string) => void;
};

export function useChatRoute(userId: string | null): UseChatRouteResult {
  const params = useLocalSearchParams<ChatRouteParams>();
  const navigation = useNavigation<NavigationProp<any>>();

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
    if (directConversationId) return directConversationId;
    return routeChatId || null;
  }, [directConversationId, routeChatId]);

  const [activeChatId, setActiveChatId] = useState<string | null>(preferredChatId);

  useEffect(() => {
    setActiveChatId(preferredChatId);
  }, [preferredChatId]);

  const goBackToInbox = useCallback(() => {
    const navState = navigation.getState();
    const routes = navState?.routes || [];
    const index = typeof navState?.index === 'number' ? navState.index : 0;
    const previousRoute = index > 0 ? routes[index - 1] : undefined;
    const previousName = String(previousRoute?.name || '').toLowerCase();

    if (previousName.includes('messages')) {
      navigation.goBack();
      return;
    }

    router.replace('/(market)/messages' as any);
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackToInbox();
        return true;
      });
      return () => subscription.remove();
    }, [goBackToInbox])
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
    goBackToInbox,
    syncRouteChatId,
  };
}
