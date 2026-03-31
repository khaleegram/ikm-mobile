// Local (+ optional Firestore) notifications for new Market direct messages when the chat is not open.
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';

import { resolveDirectConversationPeerId } from '@/lib/api/market-messages';
import { firestore } from '@/lib/firebase/config';
import { createNotification } from '@/lib/firebase/firestore/notifications';
import type { NotificationData } from '@/lib/hooks/use-notifications';
import { scheduleNotification } from '@/lib/hooks/use-notifications';
import { useMarketChatStore } from '@/lib/stores/marketChatStore';

function previewText(text: string, max = 120): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'New message';
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function ensureMessagesChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    description: 'New chat messages',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    sound: 'default',
  });
}

/**
 * Call from the Market tab layout once (logged-in users only).
 */
export function useMarketChatMessageNotifications(userId: string | null): void {
  const conversationsPrimed = useRef(false);
  const lastMessageIdByConv = useRef<Map<string, string>>(new Map());
  const legacyMessageIds = useRef<Set<string>>(new Set());
  const legacyPrimed = useRef(false);

  useEffect(() => {
    void ensureMessagesChannel();
  }, []);

  useEffect(() => {
    if (!userId) {
      conversationsPrimed.current = false;
      legacyPrimed.current = false;
      lastMessageIdByConv.current.clear();
      legacyMessageIds.current.clear();
      return;
    }

    const conversationsQuery = query(
      collection(firestore, 'conversations'),
      where('participantIds', 'array-contains', userId),
      limit(250)
    );

    const unsubscribeConversations = onSnapshot(
      conversationsQuery,
      (snapshot) => {
        if (!conversationsPrimed.current) {
          snapshot.docs.forEach((docSnap) => {
            const lm = docSnap.data()?.lastMessage as Record<string, unknown> | undefined;
            const mid = String(lm?.id || '').trim();
            lastMessageIdByConv.current.set(docSnap.id, mid);
          });
          conversationsPrimed.current = true;
          return;
        }

        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'modified' && change.type !== 'added') return;
          const docSnap = change.doc;
          const convId = docSnap.id;
          const data = docSnap.data();
          const lm = data?.lastMessage as Record<string, unknown> | undefined;
          const nextId = String(lm?.id || '').trim();
          const senderId = String(lm?.senderId || '').trim();
          const text = previewText(String(lm?.text || ''));

          const prevId = lastMessageIdByConv.current.get(convId) || '';
          if (!nextId || nextId === prevId) return;
          lastMessageIdByConv.current.set(convId, nextId);

          if (!senderId || senderId === userId) return;
          if (useMarketChatStore.getState().getActiveMarketConversationId() === convId) return;

          const peerId = resolveDirectConversationPeerId(convId, userId) || '';

          const payload: NotificationData = {
            type: 'chat_message',
            chatId: convId,
            peerId: peerId || undefined,
          };

          void scheduleNotification('New message', text, payload, {
            subtitle: 'Market',
          });

          void createNotification({
            userId,
            title: 'New message',
            message: text,
            type: 'chat_message',
            read: false,
            chatId: convId,
            peerId: peerId || undefined,
          }).catch(() => {});
        });
      },
      () => {}
    );

    const legacyMessagesQuery = query(
      collection(firestore, 'marketMessages'),
      where('receiverId', '==', userId),
      limit(100)
    );

    const unsubscribeLegacy = onSnapshot(
      legacyMessagesQuery,
      (snapshot) => {
        if (!legacyPrimed.current) {
          snapshot.docs.forEach((d) => legacyMessageIds.current.add(d.id));
          legacyPrimed.current = true;
          return;
        }

        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const docSnap = change.doc;
          const id = docSnap.id;
          if (legacyMessageIds.current.has(id)) return;
          legacyMessageIds.current.add(id);

          const data = docSnap.data();
          const senderId = String(data?.senderId || '').trim();
          const chatId = String(data?.chatId || data?.conversationId || data?.threadId || '').trim();
          const text = previewText(String(data?.text || data?.message || ''));

          if (!senderId || senderId === userId) return;
          if (chatId && useMarketChatStore.getState().getActiveMarketConversationId() === chatId) return;

          const peerId =
            (chatId.startsWith('direct_') ? resolveDirectConversationPeerId(chatId, userId) : '') || senderId;

          const payload: NotificationData = {
            type: 'chat_message',
            chatId: chatId || undefined,
            peerId: peerId || undefined,
          };

          void scheduleNotification('New message', text, payload);

          void createNotification({
            userId,
            title: 'New message',
            message: text,
            type: 'chat_message',
            read: false,
            chatId: chatId || undefined,
            peerId: peerId || undefined,
          }).catch(() => {});
        });
      },
      () => {}
    );

    return () => {
      unsubscribeConversations();
      unsubscribeLegacy();
    };
  }, [userId]);
}

/**
 * Registers tap handling for local notifications (Market variant skips the root seller hook).
 */
export function useMarketChatNotificationTapNavigation(): void {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response.notification.request.content.data as NotificationData;
        if (data?.type !== 'chat_message' || !data.chatId) return;
        if (AppState.currentState !== 'active' && AppState.currentState !== 'background') return;

        const chatId = String(data.chatId);
        const peer = String(data.peerId || '').trim();
        const qs = peer ? `?peerId=${encodeURIComponent(peer)}` : '';
        router.push(`/(market)/messages/${encodeURIComponent(chatId)}${qs}` as any);
      } catch {
        // ignore
      }
    });
    return () => {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    };
  }, []);
}
