import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// Note: do not add a default `import React` — hooks import above is enough.

import { chatApi } from '@/lib/api/chat';
import { isPostgresChatBackend } from '@/lib/config/chat-backend';
import { queryClient as appQueryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { useChatInboxCache } from '@/lib/stores/chat-inbox-cache';
import { chatThreadCache, mergeThreadMessages } from '@/lib/stores/chat-thread-cache';
import { buildUserMediaPath } from '@/lib/utils/media-path';
import { uploadAudio } from '@/lib/utils/image-upload';
import type { ChatMessage, ChatPeerProfile, ChatThread, ChatOfferStatus } from '@/types/chat';

function preferStorePeer(
  next: ChatPeerProfile | null | undefined,
  prev: ChatPeerProfile | null | undefined
): ChatPeerProfile | null {
  if (!next) return prev ?? null;
  if (!prev || prev.id !== next.id) {
    const store = String(next.storeName || '').trim();
    const avatarUrl = next.avatarUrl || null;
    if (store) return { ...next, storeName: store, displayName: store, avatarUrl };
    return { ...next, avatarUrl };
  }
  const store = String(next.storeName || prev.storeName || '').trim();
  const avatarUrl = next.avatarUrl || prev.avatarUrl || null;
  if (store) {
    return {
      ...next,
      storeName: store,
      displayName: store,
      avatarUrl,
    };
  }
  return {
    ...next,
    storeName: prev.storeName || next.storeName,
    displayName: prev.displayName || next.displayName,
    avatarUrl,
  };
}

type UseChatThreadParams = {
  threadId: string | null;
  userId: string | null;
  enabled?: boolean;
};

type SendVoiceInput = {
  localUri: string;
  durationMs: number;
  mime?: string;
  clientMsgId?: string;
  /** Reuse an existing optimistic bubble id when retrying. */
  optimisticId?: string;
};

type UseChatThreadResult = {
  thread: ChatThread | null;
  peer: ChatPeerProfile | null;
  messages: ChatMessage[];
  loading: boolean;
  error: Error | null;
  sendText: (body: string, clientMsgId?: string) => Promise<ChatMessage | null>;
  sendQuote: (
    quote: { postId?: string; previewText: string; previewImage?: string },
    body: string,
    clientMsgId?: string
  ) => Promise<ChatMessage | null>;
  /** Avatar-only peer signal — never gated behind store-name resolution. */
  peerAvatarUrl: string | null;
  sendVoice: (input: SendVoiceInput) => Promise<ChatMessage | null>;
  createOffer: (
    amount: number,
    note?: string,
    clientMsgId?: string
  ) => Promise<{ offer: any; message: ChatMessage } | null>;
  respondToOffer: (
    offerId: string,
    action: 'accept' | 'counter' | 'decline',
    options?: { amount?: number; note?: string; clientMsgId?: string }
  ) => Promise<void>;
  markRead: () => Promise<void>;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  loadOlder: () => Promise<void>;
  hasMore: boolean;
  loadingOlder: boolean;
  appendMessage: (message: ChatMessage) => void;
  removeMessage: (messageId: string) => void;
  usingPostgres: boolean;
};

/** Server + optimistic thread snapshot owned by TanStack Query. */
export type ChatThreadQueryData = {
  thread: ChatThread | null;
  peer: ChatPeerProfile | null;
  messages: ChatMessage[];
  olderCursor: string | null;
  hasMore: boolean;
};

const mergeMessages = mergeThreadMessages;

function withOfferStatus(
  messages: ChatMessage[],
  offerId: string,
  status: ChatOfferStatus
): ChatMessage[] {
  const id = String(offerId || '').trim();
  if (!id) return messages;
  return messages.map((message) => {
    if (!message.offer || message.offer.id !== id) return message;
    return { ...message, offer: { ...message.offer, status } };
  });
}

function emptyThreadData(): ChatThreadQueryData {
  return {
    thread: null,
    peer: null,
    messages: [],
    olderCursor: null,
    hasMore: false,
  };
}

function seedFromMmkv(threadId: string): ChatThreadQueryData | undefined {
  const cached = chatThreadCache.get(threadId);
  if (!cached) return undefined;
  // Keep peer even when storeName is empty — avatar must still paint in the header.
  const peer = preferStorePeer(cached.peer ?? null, null);
  return {
    thread: cached.thread ?? null,
    peer,
    messages: cached.messages ?? [],
    olderCursor: null,
    hasMore: false,
  };
}

function patchThreadData(
  prev: ChatThreadQueryData | undefined,
  patch: Partial<ChatThreadQueryData> & {
    mergeMessages?: ChatMessage[];
    replaceMessages?: ChatMessage[];
  }
): ChatThreadQueryData {
  const base = prev ?? emptyThreadData();
  let messages = base.messages;
  if (patch.replaceMessages) {
    messages = patch.replaceMessages;
  } else if (patch.mergeMessages?.length) {
    messages = mergeMessages(base.messages, patch.mergeMessages);
  }
  return {
    thread: patch.thread !== undefined ? patch.thread : base.thread,
    peer: patch.peer !== undefined ? patch.peer : base.peer,
    messages,
    olderCursor: patch.olderCursor !== undefined ? patch.olderCursor : base.olderCursor,
    hasMore: patch.hasMore !== undefined ? patch.hasMore : base.hasMore,
  };
}

/** Move Query entry when a pending thread resolves to a real UUID. */
export function migrateChatThreadQuery(fromThreadId: string, toThreadId: string) {
  const from = String(fromThreadId || '').trim();
  const to = String(toThreadId || '').trim();
  if (!from || !to || from === to) return;
  const prev = appQueryClient.getQueryData<ChatThreadQueryData>(queryKeys.chat.thread(from));
  if (prev) {
    appQueryClient.setQueryData<ChatThreadQueryData>(queryKeys.chat.thread(to), {
      ...prev,
      thread: prev.thread ? { ...prev.thread, id: to } : prev.thread,
      messages: prev.messages.map((m) => ({ ...m, threadId: to })),
    });
    appQueryClient.removeQueries({ queryKey: queryKeys.chat.thread(from) });
  }
}

/**
 * Deal-room thread: TanStack Query owns the visible snapshot (`queryKeys.chat.thread`).
 * MMKV `chatThreadCache` remains the cold-start seed + cross-screen optimistic bridge
 * (inbox prefetch, ask-price, pending→real migrate) — same split as inbox Query + Zustand.
 */
export function useChatThread({
  threadId,
  userId,
  enabled = true,
}: UseChatThreadParams): UseChatThreadResult {
  const usingPostgres = isPostgresChatBackend();
  const queryClient = useQueryClient();
  const streamRef = useRef<{ close: () => void } | null>(null);
  const streamHealthRef = useRef<(() => void) | null>(null);
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const isPendingId = Boolean(threadId && String(threadId).startsWith('pending:'));
  const queryEnabled = Boolean(threadId && userId && usingPostgres && enabled && !isPendingId);
  const threadKey = useMemo(() => queryKeys.chat.thread(threadId), [threadId]);

  // Seed Query from MMKV so cold opens / pending rooms paint before network.
  useEffect(() => {
    if (!threadId || !usingPostgres || !enabled) return;
    const seed = seedFromMmkv(threadId);
    if (!seed) return;
    const existing = queryClient.getQueryData<ChatThreadQueryData>(threadKey);
    if (!existing) {
      queryClient.setQueryData(threadKey, seed);
      return;
    }
    // Merge MMKV into Query without wiping newer Query bubbles.
    queryClient.setQueryData<ChatThreadQueryData>(threadKey, (prev) => {
      const next = patchThreadData(prev, {
        thread: prev?.thread || seed.thread,
        peer: preferStorePeer(seed.peer, prev?.peer) || prev?.peer || seed.peer,
        mergeMessages: seed.messages,
      });
      const prevMsgs = prev?.messages ?? [];
      const nextMsgs = next.messages ?? [];
      if (
        prevMsgs.length === nextMsgs.length &&
        prevMsgs[nextMsgs.length - 1]?.id === nextMsgs[nextMsgs.length - 1]?.id &&
        prev?.thread?.id === next.thread?.id &&
        prev?.peer?.id === next.peer?.id
      ) {
        return prev ?? next;
      }
      return next;
    });
  }, [threadId, usingPostgres, enabled, queryClient, threadKey]);

  const query = useQuery({
    queryKey: threadKey,
    enabled: queryEnabled,
    staleTime: 15_000,
    // Paint from MMKV on the first frame — avoids the center "Loading messages…" flash.
    initialData: () => (threadId ? seedFromMmkv(threadId) : undefined),
    initialDataUpdatedAt: () => (threadId && seedFromMmkv(threadId) ? Date.now() - 60_000 : undefined),
    placeholderData: () => (threadId ? seedFromMmkv(threadId) : undefined),
    queryFn: async (): Promise<ChatThreadQueryData> => {
      if (!threadId) return emptyThreadData();
      const [meta, page] = await Promise.all([
        chatApi.getThread(threadId),
        chatApi.getMessages(threadId),
      ]);
      const prev = queryClient.getQueryData<ChatThreadQueryData>(threadKey);
      const mmkv = chatThreadCache.get(threadId);
      const merged = mergeMessages(
        mergeMessages(mmkv?.messages || [], prev?.messages || []),
        page.messages
      );
      const peer = preferStorePeer(meta.peer, prev?.peer || mmkv?.peer || null);
      const next: ChatThreadQueryData = {
        thread: meta.thread,
        peer,
        messages: merged,
        olderCursor: page.nextCursor,
        hasMore: Boolean(page.hasMore),
      };
      chatThreadCache.set(
        threadId,
        { thread: meta.thread, peer, messages: merged },
        { notify: false }
      );
      return next;
    },
  });

  const data = query.data;
  const thread = data?.thread ?? null;
  const peer = data?.peer ?? null;
  const messages = data?.messages ?? [];
  const hasMore = Boolean(data?.hasMore);
  const peerAvatarUrl = peer?.avatarUrl ?? null;

  const setThreadData = useCallback(
    (updater: (prev: ChatThreadQueryData | undefined) => ChatThreadQueryData) => {
      if (!threadId) return;
      queryClient.setQueryData<ChatThreadQueryData>(threadKey, updater);
    },
    [threadId, queryClient, threadKey]
  );

  // External MMKV writes (prefetch / ask-price / migrate) → merge into Query.
  useEffect(() => {
    if (!threadId || !usingPostgres || !enabled) return;
    return chatThreadCache.subscribe((id) => {
      if (id !== threadId) return;
      const cached = chatThreadCache.get(threadId);
      if (!cached) return;
      setThreadData((prev) => {
        const next = patchThreadData(prev, {
          thread: cached.thread || prev?.thread || null,
          peer: preferStorePeer(cached.peer, prev?.peer) || prev?.peer || null,
          mergeMessages: cached.messages,
        });
        const prevMsgs = prev?.messages ?? [];
        const nextMsgs = next.messages ?? [];
        if (
          prevMsgs.length === nextMsgs.length &&
          prevMsgs[nextMsgs.length - 1]?.id === nextMsgs[nextMsgs.length - 1]?.id &&
          (prev?.peer?.avatarUrl || '') === (next.peer?.avatarUrl || '')
        ) {
          return prev ?? next;
        }
        return next;
      });
    });
  }, [threadId, usingPostgres, enabled, setThreadData]);

  // Persist Query snapshot to MMKV without re-notifying (avoids update loops).
  useEffect(() => {
    if (!threadId || !usingPostgres || !enabled) return;
    if (!messages.length && !thread) return;
    chatThreadCache.set(threadId, { thread, peer, messages }, { notify: false });
  }, [threadId, thread, peer, messages, usingPostgres, enabled]);

  // WebSocket realtime → Query.
  useEffect(() => {
    if (!threadId || !userId || !usingPostgres || !enabled) return;
    if (isPendingId) return;

    streamRef.current?.close();
    streamRef.current = chatApi.openThreadStream(threadId, {
      onEvent: (event) => {
        streamHealthRef.current?.();
        if (event.event === 'message' && event.message) {
          setThreadData((prev) =>
            patchThreadData(prev, { mergeMessages: [event.message as ChatMessage] })
          );
        }
        if (event.event === 'offer_updated' && event.message) {
          const msg = event.message as ChatMessage;
          const offerId = String((event as any).offerId || msg.offer?.id || '').trim();
          const status = String((event as any).status || msg.offer?.status || '').trim();
          setThreadData((prev) => {
            let nextMsgs = prev?.messages || [];
            if (msg.type === 'counter' && msg.offer?.parentOfferId) {
              nextMsgs = withOfferStatus(nextMsgs, msg.offer.parentOfferId, 'countered');
            } else if (
              offerId &&
              (status === 'accepted' || status === 'declined' || status === 'countered')
            ) {
              nextMsgs = withOfferStatus(nextMsgs, offerId, status as ChatOfferStatus);
            } else if (msg.type === 'accept' || msg.type === 'decline') {
              const targetId = String(
                (msg.payload as any)?.offer_id || offerId || ''
              ).trim();
              if (targetId) {
                nextMsgs = withOfferStatus(
                  nextMsgs,
                  targetId,
                  msg.type === 'accept' ? 'accepted' : 'declined'
                );
              }
            }
            return patchThreadData(
              { ...(prev || emptyThreadData()), messages: nextMsgs },
              { mergeMessages: [msg] }
            );
          });
        }
        if (event.event === 'thread_status' && typeof event.status === 'string') {
          setThreadData((prev) =>
            patchThreadData(prev, {
              thread: prev?.thread
                ? { ...prev.thread, status: event.status as ChatThread['status'] }
                : prev?.thread || null,
            })
          );
        }
      },
    });

    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [threadId, userId, usingPostgres, enabled, isPendingId, setThreadData]);

  // Quiet poll when WS is silent (Cloud Run multi-instance).
  useEffect(() => {
    if (!threadId || !userId || !usingPostgres || !enabled) return;
    if (isPendingId) return;

    let active = true;
    let lastWsAt = 0;
    const poll = async () => {
      if (!active || AppState.currentState !== 'active') return;
      if (lastWsAt > 0 && Date.now() - lastWsAt < 30000) return;
      try {
        const page = await chatApi.getMessages(threadId);
        if (!active) return;
        setThreadData((prev) => {
          const merged = mergeMessages(prev?.messages || [], page.messages);
          if (
            merged.length === (prev?.messages.length || 0) &&
            merged[merged.length - 1]?.id === prev?.messages[prev.messages.length - 1]?.id
          ) {
            return prev || emptyThreadData();
          }
          return patchThreadData(prev, { replaceMessages: merged });
        });
      } catch {
        // silent
      }
    };

    streamHealthRef.current = () => {
      lastWsAt = Date.now();
    };

    const timer = setInterval(() => void poll(), 12000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });

    return () => {
      active = false;
      streamHealthRef.current = null;
      clearInterval(timer);
      sub.remove();
    };
  }, [threadId, userId, usingPostgres, enabled, isPendingId, setThreadData]);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!threadId || !userId || !usingPostgres || !enabled || isPendingId) return;
      if (options?.silent) {
        await queryClient.invalidateQueries({ queryKey: threadKey });
        return;
      }
      await query.refetch();
    },
    [threadId, userId, usingPostgres, enabled, isPendingId, queryClient, threadKey, query]
  );

  const loadOlder = useCallback(async () => {
    if (!threadId || !userId || !usingPostgres || !enabled || isPendingId) return;
    if (loadingOlderRef.current) return;
    const cursor = queryClient.getQueryData<ChatThreadQueryData>(threadKey)?.olderCursor;
    if (!cursor) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await chatApi.getMessages(threadId, cursor, 50);
      setThreadData((prev) => {
        const merged = mergeMessages(prev?.messages || [], page.messages);
        chatThreadCache.set(threadId, { messages: merged }, { notify: false });
        return patchThreadData(prev, {
          replaceMessages: merged,
          olderCursor: page.nextCursor,
          hasMore: Boolean(page.hasMore),
        });
      });
    } catch {
      // silent
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [
    threadId,
    userId,
    usingPostgres,
    enabled,
    isPendingId,
    queryClient,
    threadKey,
    setThreadData,
  ]);

  const sendText = useCallback(
    async (body: string, clientMsgId?: string) => {
      if (!threadId || !usingPostgres) return null;
      const optimisticId = clientMsgId || `local-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: optimisticId,
        threadId,
        senderId: userId,
        type: 'text',
        body,
        clientMsgId: optimisticId,
        createdAt: new Date().toISOString(),
      };
      setThreadData((prev) => patchThreadData(prev, { mergeMessages: [optimistic] }));
      try {
        const saved = await chatApi.sendMessage(threadId, {
          type: 'text',
          body,
          clientMsgId: optimisticId,
        });
        setThreadData((prev) =>
          patchThreadData(
            {
              ...(prev || emptyThreadData()),
              messages: (prev?.messages || []).filter((m) => m.id !== optimisticId),
            },
            { mergeMessages: [saved] }
          )
        );
        return saved;
      } catch (err) {
        setThreadData((prev) =>
          patchThreadData(prev, {
            replaceMessages: (prev?.messages || []).filter((m) => m.id !== optimisticId),
          })
        );
        throw err;
      }
    },
    [threadId, userId, usingPostgres, setThreadData]
  );

  const sendQuote = useCallback(
    async (
      quote: { postId?: string; previewText: string; previewImage?: string },
      body: string,
      clientMsgId?: string
    ) => {
      if (!threadId || !usingPostgres) return null;
      const saved = await chatApi.sendMessage(threadId, {
        type: 'quote',
        body,
        quote,
        clientMsgId,
      });
      setThreadData((prev) => patchThreadData(prev, { mergeMessages: [saved] }));
      return saved;
    },
    [threadId, usingPostgres, setThreadData]
  );

  const sendVoice = useCallback(
    async (input: SendVoiceInput) => {
      if (!threadId || !usingPostgres || !userId) return null;

      const clientMsgId =
        input.clientMsgId ||
        input.optimisticId?.replace(/^local-voice-/, '') ||
        `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticId = input.optimisticId || `local-voice-${clientMsgId}`;
      const durationSec = Math.max(1, Math.round(input.durationMs / 1000));
      const mime = input.mime || 'audio/m4a';

      const optimistic: ChatMessage = {
        id: optimisticId,
        threadId,
        senderId: userId,
        type: 'voice',
        body: null,
        clientMsgId,
        attachment: {
          id: optimisticId,
          type: 'voice',
          url: input.localUri,
          mimeType: mime,
          durationSec,
        },
        payload: {
          sendStatus: 'sending',
          localUri: input.localUri,
        },
        createdAt: new Date().toISOString(),
      };

      setThreadData((prev) => patchThreadData(prev, { mergeMessages: [optimistic] }));

      try {
        const uploaded = await uploadAudio(
          input.localUri,
          buildUserMediaPath('chatVoice', userId, `${Date.now()}_voice.m4a`)
        );

        const saved = await chatApi.sendMessage(threadId, {
          type: 'voice',
          attachment: {
            url: uploaded.url,
            mimeType: mime,
            durationSec,
          },
          clientMsgId,
        });

        const confirmed: ChatMessage = {
          ...saved,
          clientMsgId: saved.clientMsgId || clientMsgId,
          payload: {
            ...(saved.payload || {}),
            localUri: input.localUri,
          },
          attachment: saved.attachment
            ? {
                ...saved.attachment,
                durationSec: saved.attachment.durationSec ?? durationSec,
              }
            : {
                id: saved.id,
                type: 'voice',
                url: uploaded.url,
                mimeType: mime,
                durationSec,
              },
        };

        setThreadData((prev) =>
          patchThreadData(
            {
              ...(prev || emptyThreadData()),
              messages: (prev?.messages || []).filter(
                (m) => m.id !== optimisticId && m.clientMsgId !== clientMsgId
              ),
            },
            { mergeMessages: [confirmed] }
          )
        );
        return confirmed;
      } catch (err) {
        setThreadData((prev) =>
          patchThreadData(prev, {
            mergeMessages: [
              {
                ...optimistic,
                payload: {
                  sendStatus: 'failed',
                  localUri: input.localUri,
                },
              },
            ],
          })
        );
        throw err;
      }
    },
    [threadId, userId, usingPostgres, setThreadData]
  );

  const createOfferFn = useCallback(
    async (amount: number, note?: string, clientMsgId?: string) => {
      if (!threadId || !usingPostgres) return null;
      const result = await chatApi.createOffer(threadId, { amount, note, clientMsgId });
      setThreadData((prev) =>
        patchThreadData(prev, {
          mergeMessages: [result.message],
          thread: prev?.thread ? { ...prev.thread, status: 'offer_sent' } : prev?.thread || null,
        })
      );
      return result;
    },
    [threadId, usingPostgres, setThreadData]
  );

  const respondToOfferFn = useCallback(
    async (
      offerId: string,
      action: 'accept' | 'counter' | 'decline',
      options?: { amount?: number; note?: string; clientMsgId?: string }
    ) => {
      if (!threadId || !usingPostgres) return;
      const result = await chatApi.respondToOffer(threadId, offerId, action, options);
      const nextStatus: ChatOfferStatus =
        action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'countered';
      setThreadData((prev) => {
        const withStatus = withOfferStatus(prev?.messages || [], offerId, nextStatus);
        return patchThreadData(
          { ...(prev || emptyThreadData()), messages: withStatus },
          {
            mergeMessages: [result.message],
            thread:
              result.threadStatus && prev?.thread
                ? { ...prev.thread, status: result.threadStatus as ChatThread['status'] }
                : prev?.thread || null,
          }
        );
      });
    },
    [threadId, usingPostgres, setThreadData]
  );

  const markRead = useCallback(async () => {
    if (!threadId || !usingPostgres) return;
    if (isPendingId) return;
    if (userId) {
      useChatInboxCache.getState().patchThread(userId, threadId, { unreadCount: 0 });
      queryClient.setQueryData(queryKeys.chat.inbox(userId), (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((item: any) =>
          item?.threadId === threadId ? { ...item, unreadCount: 0 } : item
        );
      });
    }
    await chatApi.markRead(threadId);
  }, [threadId, userId, usingPostgres, isPendingId, queryClient]);

  const appendMessage = useCallback(
    (message: ChatMessage) => {
      setThreadData((prev) => patchThreadData(prev, { mergeMessages: [message] }));
    },
    [setThreadData]
  );

  const removeMessage = useCallback(
    (messageId: string) => {
      setThreadData((prev) =>
        patchThreadData(prev, {
          replaceMessages: (prev?.messages || []).filter((m) => m.id !== messageId),
        })
      );
    },
    [setThreadData]
  );

  const hasLocalShell = Boolean(thread || messages.length || peer);
  const loading =
    Boolean(threadId && userId && enabled) &&
    !isPendingId &&
    query.isPending &&
    !hasLocalShell;

  return useMemo(
    () => ({
      thread,
      peer,
      peerAvatarUrl,
      messages,
      loading,
      error: query.error instanceof Error ? query.error : null,
      sendText,
      sendQuote,
      sendVoice,
      createOffer: createOfferFn,
      respondToOffer: respondToOfferFn,
      markRead,
      refresh,
      loadOlder,
      hasMore,
      loadingOlder,
      appendMessage,
      removeMessage,
      usingPostgres,
    }),
    [
      thread,
      peer,
      peerAvatarUrl,
      messages,
      loading,
      query.error,
      sendText,
      sendQuote,
      sendVoice,
      createOfferFn,
      respondToOfferFn,
      markRead,
      refresh,
      loadOlder,
      hasMore,
      loadingOlder,
      appendMessage,
      removeMessage,
      usingPostgres,
    ]
  );
}
