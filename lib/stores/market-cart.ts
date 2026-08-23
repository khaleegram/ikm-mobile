import { create } from 'zustand';

import { appStorage } from '@/lib/storage/mmkv';
import { showToast } from '@/components/toast';
import { getMarketPostPrimaryImage, getMarketPostVideoCover, isVideoMarketPost } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

const CART_KEY = '@ikm_market_cart_v1';

export type MarketCartLine = {
  postId: string;
  sellerId: string;
  title: string;
  coverUri: string;
  unitPrice: number;
  quantity: number;
};

type MarketCartState = {
  lines: MarketCartLine[];
  cartSessionId: string;
  addPost: (post: MarketPost, quantity?: number) => { ok: boolean; reason?: string };
  setQuantity: (postId: string, quantity: number) => void;
  remove: (postId: string) => void;
  clear: () => void;
  totalItems: () => number;
  totalAmount: () => number;
  sellerId: () => string | null;
};

function newSessionId(): string {
  return `cart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function coverForPost(post: MarketPost): string {
  if (isVideoMarketPost(post)) {
    return String(getMarketPostVideoCover(post) || '').trim();
  }
  return String(getMarketPostPrimaryImage(post) || post.images?.[0] || '').trim();
}

function loadCart(): Pick<MarketCartState, 'lines' | 'cartSessionId'> {
  try {
    const raw = appStorage.getString(CART_KEY);
    if (!raw) return { lines: [], cartSessionId: newSessionId() };
    const parsed = JSON.parse(raw) as Partial<MarketCartState>;
    const lines = Array.isArray(parsed.lines) ? parsed.lines.filter((l) => l?.postId && l?.sellerId) : [];
    return {
      lines,
      cartSessionId: String(parsed.cartSessionId || '').trim() || newSessionId(),
    };
  } catch {
    return { lines: [], cartSessionId: newSessionId() };
  }
}

function persist(lines: MarketCartLine[], cartSessionId: string) {
  try {
    appStorage.set(CART_KEY, JSON.stringify({ lines, cartSessionId }));
  } catch {
    // ignore
  }
}

const initial = loadCart();

export const useMarketCartStore = create<MarketCartState>((set, get) => ({
  lines: initial.lines,
  cartSessionId: initial.cartSessionId,

  addPost: (post, quantity = 1) => {
    const postId = String(post.id || '').trim();
    const sellerId = String(post.posterId || '').trim();
    const unitPrice = Number(post.price || 0);
    if (!postId || !sellerId) {
      return { ok: false, reason: 'Item unavailable.' };
    }
    if (!(unitPrice > 0)) {
      return { ok: false, reason: 'Only priced items can go in the cart. Use Ask price instead.' };
    }

    const current = get().lines;
    const existingSeller = current[0]?.sellerId;
    if (existingSeller && existingSeller !== sellerId) {
      showToast('Cart is for one seller at a time. Clear cart or finish checkout first.', 'error');
      return { ok: false, reason: 'different_seller' };
    }

    const qty = Math.max(1, Math.floor(quantity) || 1);
    const title = String(post.title || post.description || 'Marketplace item').trim().slice(0, 80);
    const coverUri = coverForPost(post);
    const existing = current.find((line) => line.postId === postId);
    const next = existing
      ? current.map((line) =>
          line.postId === postId
            ? { ...line, quantity: Math.min(99, line.quantity + qty), unitPrice, title, coverUri }
            : line
        )
      : [
          ...current,
          { postId, sellerId, title, coverUri, unitPrice, quantity: Math.min(99, qty) },
        ];

    const sessionId = current.length === 0 ? newSessionId() : get().cartSessionId;
    set({ lines: next, cartSessionId: sessionId });
    persist(next, sessionId);
    showToast(existing ? 'Updated cart quantity.' : 'Added to cart.', 'success');
    return { ok: true };
  },

  setQuantity: (postId, quantity) => {
    const id = String(postId || '').trim();
    const qty = Math.floor(quantity);
    let next = get().lines;
    if (qty <= 0) {
      next = next.filter((line) => line.postId !== id);
    } else {
      next = next.map((line) =>
        line.postId === id ? { ...line, quantity: Math.min(99, qty) } : line
      );
    }
    const sessionId = next.length === 0 ? newSessionId() : get().cartSessionId;
    set({ lines: next, cartSessionId: sessionId });
    persist(next, sessionId);
  },

  remove: (postId) => {
    const next = get().lines.filter((line) => line.postId !== String(postId || '').trim());
    const sessionId = next.length === 0 ? newSessionId() : get().cartSessionId;
    set({ lines: next, cartSessionId: sessionId });
    persist(next, sessionId);
  },

  clear: () => {
    const sessionId = newSessionId();
    set({ lines: [], cartSessionId: sessionId });
    persist([], sessionId);
  },

  totalItems: () => get().lines.reduce((sum, line) => sum + line.quantity, 0),
  totalAmount: () =>
    get().lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  sellerId: () => get().lines[0]?.sellerId || null,
}));
