import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import { auth } from '@/lib/firebase/config';
import type {
  ChatAttachment,
  ChatInboxItem,
  ChatMessage,
  ChatOffer,
  ChatPeerProfile,
  ChatThread,
} from '@/types/chat';

function wsBaseUrl(): string {
  const http = apiUrl('').replace(/\/v1\/?$/, '');
  return http.replace(/^http/, 'ws');
}

export const chatApi = {
  async getInbox(): Promise<ChatInboxItem[]> {
    const response = await coreCloudClient.request<{
      success: boolean;
      threads: ChatInboxItem[];
    }>(apiUrl('/chat/inbox'), { method: 'GET', requiresAuth: true });
    return Array.isArray(response.threads) ? response.threads : [];
  },

  async getOrCreateThread(postId: string, sellerId?: string): Promise<{
    thread: ChatThread;
    isNew: boolean;
  }> {
    const response = await coreCloudClient.request<{
      success: boolean;
      thread: ChatThread;
      isNew: boolean;
    }>(apiUrl('/chat/threads'), {
      method: 'POST',
      body: { postId, sellerId },
      requiresAuth: true,
    });
    return { thread: response.thread, isNew: Boolean(response.isNew) };
  },

  async getThread(threadId: string): Promise<{ thread: ChatThread; peer: ChatPeerProfile }> {
    const response = await coreCloudClient.request<{
      success: boolean;
      thread: ChatThread;
      peer: ChatPeerProfile;
    }>(apiUrl(`/chat/threads/${threadId}`), { method: 'GET', requiresAuth: true });
    return { thread: response.thread, peer: response.peer };
  },

  async getMessages(
    threadId: string,
    cursor?: string | null,
    limit = 50
  ): Promise<{ messages: ChatMessage[]; nextCursor: string | null; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (cursor) params.set('before', cursor);
    params.set('limit', String(limit));
    const qs = params.toString();
    const response = await coreCloudClient.request<{
      success: boolean;
      messages: ChatMessage[];
      nextCursor: string | null;
      hasMore: boolean;
    }>(apiUrl(`/chat/threads/${threadId}/messages${qs ? `?${qs}` : ''}`), {
      method: 'GET',
      requiresAuth: true,
    });
    return {
      messages: Array.isArray(response.messages) ? response.messages : [],
      nextCursor: response.nextCursor || null,
      hasMore: Boolean(response.hasMore),
    };
  },

  async sendMessage(
    threadId: string,
    body: {
      type?: string;
      body?: string;
      clientMsgId?: string;
      quote?: { postId?: string; previewText?: string; previewImage?: string };
      attachment?: Partial<ChatAttachment>;
      payload?: Record<string, unknown>;
    }
  ): Promise<ChatMessage> {
    const attachment = body.attachment
      ? {
          ...body.attachment,
          // Postgres chat_attachments.duration_sec is INT — never send floats like 0.767
          durationSec:
            body.attachment.durationSec == null || body.attachment.durationSec === ('' as any)
              ? body.attachment.durationSec
              : Math.max(1, Math.round(Number(body.attachment.durationSec))),
          sizeBytes:
            body.attachment.sizeBytes == null
              ? body.attachment.sizeBytes
              : Math.round(Number(body.attachment.sizeBytes)) || null,
          width:
            body.attachment.width == null
              ? body.attachment.width
              : Math.round(Number(body.attachment.width)) || null,
          height:
            body.attachment.height == null
              ? body.attachment.height
              : Math.round(Number(body.attachment.height)) || null,
        }
      : undefined;

    const response = await coreCloudClient.request<{ success: boolean; message: ChatMessage }>(
      apiUrl(`/chat/threads/${threadId}/messages`),
      { method: 'POST', body: { ...body, attachment }, requiresAuth: true }
    );
    return response.message;
  },

  async createOffer(
    threadId: string,
    body: { amount: number; currency?: string; note?: string; clientMsgId?: string }
  ): Promise<{ offer: ChatOffer; message: ChatMessage }> {
    const response = await coreCloudClient.request<{
      success: boolean;
      offer: ChatOffer;
      message: ChatMessage;
    }>(apiUrl(`/chat/threads/${threadId}/offers`), {
      method: 'POST',
      body,
      requiresAuth: true,
    });
    return { offer: response.offer, message: response.message };
  },

  async respondToOffer(
    threadId: string,
    offerId: string,
    action: 'accept' | 'counter' | 'decline',
    body?: { amount?: number; note?: string; clientMsgId?: string }
  ): Promise<{ offer: ChatOffer; message: ChatMessage; threadStatus?: string }> {
    const response = await coreCloudClient.request<{
      success: boolean;
      offer: ChatOffer;
      message: ChatMessage;
      threadStatus?: string;
    }>(apiUrl(`/chat/threads/${threadId}/offers/${offerId}`), {
      method: 'PATCH',
      body: { action, ...(body || {}) },
      requiresAuth: true,
    });
    return response;
  },

  async markRead(threadId: string): Promise<void> {
    await coreCloudClient.request(apiUrl(`/chat/threads/${threadId}/read`), {
      method: 'POST',
      requiresAuth: true,
    });
  },

  async reportMessage(threadId: string, messageId: string, reason: string): Promise<void> {
    await coreCloudClient.request(
      apiUrl(`/chat/threads/${threadId}/messages/${messageId}/report`),
      { method: 'POST', body: { reason }, requiresAuth: true }
    );
  },

  openThreadStream(
    threadId: string,
    handlers: {
      onEvent: (event: Record<string, unknown>) => void;
      onError?: (error: Error) => void;
      onClose?: () => void;
    }
  ): { close: () => void } {
    let closed = false;
    let socket: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const connect = async () => {
      if (closed) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        handlers.onError?.(new Error('Not authenticated'));
        return;
      }

      socket = new WebSocket(`${wsBaseUrl()}/v1/chat/threads/${threadId}/stream`);
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'auth', token }));
        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          handlers.onEvent(payload);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onerror = () => handlers.onError?.(new Error('WebSocket error'));
      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        handlers.onClose?.();
        if (!closed) setTimeout(connect, 2000);
      };
    };

    void connect();

    return {
      close: () => {
        closed = true;
        if (pingTimer) clearInterval(pingTimer);
        socket?.close();
      },
    };
  },
};
