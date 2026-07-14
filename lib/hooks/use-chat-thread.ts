import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { chatApi } from '@/lib/api/chat';
import { isPostgresChatBackend } from '@/lib/config/chat-backend';
import { chatThreadCache } from '@/lib/stores/chat-thread-cache';
import { uploadAudio } from '@/lib/utils/image-upload';
import type { ChatMessage, ChatPeerProfile, ChatThread } from '@/types/chat';

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
  appendMessage: (message: ChatMessage) => void;
  removeMessage: (messageId: string) => void;
  usingPostgres: boolean;
};

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  const clientIdToKey = new Map<string, string>();

  const put = (message: ChatMessage) => {
    const clientId = String(message.clientMsgId || '').trim();
    if (clientId) {
      const priorKey = clientIdToKey.get(clientId);
      if (priorKey && priorKey !== message.id) {
        map.delete(priorKey);
      }
      // Prefer real server ids over local-* optimistic ids
      if (priorKey?.startsWith('local-') && !message.id.startsWith('local-')) {
        map.delete(priorKey);
      }
      clientIdToKey.set(clientId, message.id);
    }
    map.set(message.id, message);
  };

  for (const message of existing) put(message);
  for (const message of incoming) put(message);
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export function useChatThread({
  threadId,
  userId,
  enabled = true,
}: UseChatThreadParams): UseChatThreadResult {
  const usingPostgres = isPostgresChatBackend();
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [peer, setPeer] = useState<ChatPeerProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const streamRef = useRef<{ close: () => void } | null>(null);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!threadId || !userId || !usingPostgres || !enabled) return;
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [meta, page] = await Promise.all([
        chatApi.getThread(threadId),
        chatApi.getMessages(threadId),
      ]);
      setThread(meta.thread);
      setPeer(meta.peer);
      setMessages(page.messages);
      chatThreadCache.set(threadId, {
        thread: meta.thread,
        peer: meta.peer,
        messages: page.messages,
      });
    } catch (err: any) {
      if (!silent) {
        setError(err instanceof Error ? err : new Error(String(err?.message || 'Failed to load chat')));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [threadId, userId, usingPostgres, enabled]);

  useEffect(() => {
    if (!threadId || !userId || !usingPostgres || !enabled) {
      setThread(null);
      setPeer(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    const cached = chatThreadCache.get(threadId);
    setThread(cached?.thread ?? null);
    setPeer(cached?.peer ?? null);
    setMessages(cached?.messages ?? []);
    setError(null);
    setLoading(!cached?.messages?.length);
    void refresh({ silent: Boolean(cached?.messages?.length) });
  }, [threadId, userId, usingPostgres, enabled, refresh]);

  useEffect(() => {
    if (!threadId || !userId || !usingPostgres || !enabled) return;

    streamRef.current?.close();
    streamRef.current = chatApi.openThreadStream(threadId, {
      onEvent: (event) => {
        if (event.event === 'message' && event.message) {
          setMessages((prev) => mergeMessages(prev, [event.message as ChatMessage]));
        }
        if (event.event === 'offer_updated' && event.message) {
          setMessages((prev) => mergeMessages(prev, [event.message as ChatMessage]));
        }
        if (event.event === 'thread_status' && typeof event.status === 'string') {
          setThread((prev) => (prev ? { ...prev, status: event.status as ChatThread['status'] } : prev));
        }
      },
    });

    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [threadId, userId, usingPostgres, enabled]);

  // Poll fallback — Cloud Run WS is single-instance; catches missed events
  useEffect(() => {
    if (!threadId || !userId || !usingPostgres || !enabled) return;

    let active = true;
    const poll = async () => {
      if (!active || AppState.currentState !== 'active') return;
      try {
        const page = await chatApi.getMessages(threadId);
        if (!active) return;
        setMessages((prev) => {
          const merged = mergeMessages(prev, page.messages);
          if (merged.length !== prev.length) return merged;
          const lastIncoming = page.messages[page.messages.length - 1];
          const lastLocal = prev[prev.length - 1];
          if (lastIncoming?.id !== lastLocal?.id) return merged;
          return prev;
        });
      } catch {
        // silent — WS or next poll will retry
      }
    };

    const timer = setInterval(() => void poll(), 4000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });

    return () => {
      active = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [threadId, userId, usingPostgres, enabled]);

  useEffect(() => {
    if (!threadId || !usingPostgres || !enabled) return;
    if (!messages.length && !thread) return;
    chatThreadCache.set(threadId, { thread, peer, messages });
  }, [threadId, thread, peer, messages, usingPostgres, enabled]);

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
      setMessages((prev) => mergeMessages(prev, [optimistic]));
      try {
        const saved = await chatApi.sendMessage(threadId, {
          type: 'text',
          body,
          clientMsgId: optimisticId,
        });
        setMessages((prev) =>
          mergeMessages(
            prev.filter((m) => m.id !== optimisticId),
            [saved]
          )
        );
        return saved;
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        throw err;
      }
    },
    [threadId, userId, usingPostgres]
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
      setMessages((prev) => mergeMessages(prev, [saved]));
      return saved;
    },
    [threadId, usingPostgres]
  );

  /**
   * Optimistic voice send (WhatsApp-style):
   * 1) Insert local-URI bubble immediately
   * 2) Upload + POST in background (keep local URI so playback never remounts)
   * 3) Swap to server message on success; mark failed (keep bubble) on error
   */
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
        payload: { sendStatus: 'sending' },
        createdAt: new Date().toISOString(),
      };

      // Paint first — never await before this.
      setMessages((prev) => mergeMessages(prev, [optimistic]));

      try {
        const uploaded = await uploadAudio(
          input.localUri,
          `chatVoice/${userId}/${Date.now()}_voice.m4a`
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

        setMessages((prev) =>
          mergeMessages(
            prev.filter((m) => m.id !== optimisticId),
            [saved]
          )
        );
        return saved;
      } catch (err) {
        setMessages((prev) =>
          mergeMessages(prev, [
            {
              ...optimistic,
              payload: { sendStatus: 'failed' },
            },
          ])
        );
        throw err;
      }
    },
    [threadId, userId, usingPostgres]
  );

  const createOfferFn = useCallback(
    async (amount: number, note?: string, clientMsgId?: string) => {
      if (!threadId || !usingPostgres) return null;
      const result = await chatApi.createOffer(threadId, { amount, note, clientMsgId });
      setMessages((prev) => mergeMessages(prev, [result.message]));
      setThread((prev) => (prev ? { ...prev, status: 'offer_sent' } : prev));
      return result;
    },
    [threadId, usingPostgres]
  );

  const respondToOfferFn = useCallback(
    async (
      offerId: string,
      action: 'accept' | 'counter' | 'decline',
      options?: { amount?: number; note?: string; clientMsgId?: string }
    ) => {
      if (!threadId || !usingPostgres) return;
      const result = await chatApi.respondToOffer(threadId, offerId, action, options);
      setMessages((prev) => mergeMessages(prev, [result.message]));
      if (result.threadStatus) {
        setThread((prev) =>
          prev ? { ...prev, status: result.threadStatus as ChatThread['status'] } : prev
        );
      }
    },
    [threadId, usingPostgres]
  );

  const markRead = useCallback(async () => {
    if (!threadId || !usingPostgres) return;
    await chatApi.markRead(threadId);
  }, [threadId, usingPostgres]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => mergeMessages(prev, [message]));
  }, []);

  const removeMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  return useMemo(
    () => ({
      thread,
      peer,
      messages,
      loading,
      error,
      sendText,
      sendQuote,
      sendVoice,
      createOffer: createOfferFn,
      respondToOffer: respondToOfferFn,
      markRead,
      refresh,
      appendMessage,
      removeMessage,
      usingPostgres,
    }),
    [
      thread,
      peer,
      messages,
      loading,
      error,
      sendText,
      sendQuote,
      sendVoice,
      createOfferFn,
      respondToOfferFn,
      markRead,
      refresh,
      appendMessage,
      removeMessage,
      usingPostgres,
    ]
  );
}
