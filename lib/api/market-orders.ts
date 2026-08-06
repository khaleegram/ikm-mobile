import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import type { Order, OrderTimelineEvent } from '@/types';

function normalizeOrder(raw: any): Order {
  return {
    ...raw,
    id: String(raw?.id || ''),
    createdAt: raw?.createdAt ? new Date(raw.createdAt) : undefined,
    updatedAt: raw?.updatedAt ? new Date(raw.updatedAt) : undefined,
    sentAt: raw?.sentAt ? new Date(raw.sentAt) : undefined,
    receivedAt: raw?.receivedAt ? new Date(raw.receivedAt) : undefined,
    autoReleaseDate: raw?.autoReleaseDate ? new Date(raw.autoReleaseDate) : undefined,
    fundsReleasedAt: raw?.fundsReleasedAt ? new Date(raw.fundsReleasedAt) : undefined,
    sellerAcceptedAt: raw?.sellerAcceptedAt ? new Date(raw.sellerAcceptedAt) : undefined,
    preparingAt: raw?.preparingAt ? new Date(raw.preparingAt) : undefined,
    paymentVerifiedAt: raw?.paymentVerifiedAt ? new Date(raw.paymentVerifiedAt) : undefined,
  } as Order;
}

function normalizeTimeline(raw: any): OrderTimelineEvent {
  return {
    id: String(raw?.id || ''),
    orderId: String(raw?.orderId || ''),
    event: raw?.event,
    status: raw?.status,
    text: String(raw?.text || ''),
    actorId: raw?.actorId,
    actorRole: raw?.actorRole,
    createdAt: raw?.createdAt ? new Date(raw.createdAt) : new Date(),
  } as OrderTimelineEvent;
}

export const marketOrdersReadApi = {
  async list(role: 'all' | 'buyer' | 'seller' = 'all', limit = 40): Promise<Order[]> {
    const response = await coreCloudClient.request<{
      success: boolean;
      orders: Order[];
    }>(apiUrl(`/orders?role=${encodeURIComponent(role)}&limit=${limit}`), {
      method: 'GET',
      requiresAuth: true,
    });
    return Array.isArray(response.orders) ? response.orders.map(normalizeOrder) : [];
  },

  async getById(orderId: string): Promise<{ order: Order | null; timeline: OrderTimelineEvent[] }> {
    const id = String(orderId || '').trim();
    if (!id) return { order: null, timeline: [] };
    const response = await coreCloudClient.request<{
      success: boolean;
      order: Order;
      timeline?: OrderTimelineEvent[];
    }>(apiUrl(`/orders/${encodeURIComponent(id)}`), {
      method: 'GET',
      requiresAuth: true,
    });
    const order = response.order ? normalizeOrder(response.order) : null;
    const timeline = Array.isArray(response.timeline)
      ? response.timeline.map(normalizeTimeline)
      : Array.isArray((response.order as any)?.timeline)
        ? ((response.order as any).timeline as any[]).map(normalizeTimeline)
        : [];
    return { order, timeline };
  },

  async getByDealThread(
    threadId: string
  ): Promise<{ order: Order | null; timeline: OrderTimelineEvent[] }> {
    const id = String(threadId || '').trim();
    if (!id) return { order: null, timeline: [] };
    const response = await coreCloudClient.request<{
      success: boolean;
      order: Order;
      timeline?: OrderTimelineEvent[];
    }>(apiUrl(`/orders/by-thread/${encodeURIComponent(id)}`), {
      method: 'GET',
      requiresAuth: true,
    });
    const order = response.order ? normalizeOrder(response.order) : null;
    const timeline = Array.isArray(response.timeline)
      ? response.timeline.map(normalizeTimeline)
      : [];
    return { order, timeline };
  },
};
