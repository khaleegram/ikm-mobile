import type { MarketSound } from '@/types';

import { apiUrl } from './api-base';
import { coreCloudClient } from './core-cloud-client';
import { auth } from '@/lib/firebase/config';

function requireAuthenticatedUserId(): string {
  const userId = auth.currentUser?.uid;
  if (!userId) {
    throw new Error('Please log in to continue.');
  }
  return userId;
}

function normalizeSound(raw: any): MarketSound {
  return {
    id: String(raw?.id || ''),
    title: String(raw?.title || '').trim() || 'Untitled sound',
    createdBy: String(raw?.createdBy || '').trim(),
    creatorName: String(raw?.creatorName || '').trim() || undefined,
    sourceType: raw?.sourceType || 'uploaded',
    sourceUri: String(raw?.sourceUri || '').trim(),
    artworkUrl: String(raw?.artworkUrl || '').trim() || undefined,
    durationMs: Number.isFinite(raw?.durationMs) ? Number(raw.durationMs) : undefined,
    usageCount: typeof raw?.usageCount === 'number' ? raw.usageCount : 0,
    savedCount: typeof raw?.savedCount === 'number' ? raw.savedCount : 0,
    rightsStatus: raw?.rightsStatus || 'owned',
    status: raw?.status || 'active',
    createdAt: raw?.createdAt ? new Date(raw.createdAt) : new Date(0),
    updatedAt: raw?.updatedAt ? new Date(raw.updatedAt) : new Date(0),
  };
}

/** Neon-backed market sounds API — Firestore marketSounds path removed. */
export const marketSoundsApi = {
  async get(soundId: string): Promise<MarketSound | null> {
    const id = String(soundId || '').trim();
    if (!id) return null;
    try {
      const response = await coreCloudClient.request<{
        success: boolean;
        sound: MarketSound;
      }>(apiUrl(`/sounds/${encodeURIComponent(id)}`), {
        method: 'GET',
        requiresAuth: Boolean(auth.currentUser),
      });
      return response.sound ? normalizeSound(response.sound) : null;
    } catch (error: any) {
      if (error?.status === 404 || error?.statusCode === 404) return null;
      throw error;
    }
  },

  async list(limit = 60, q = ''): Promise<MarketSound[]> {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(120, Math.max(1, limit))));
    if (String(q || '').trim()) params.set('q', String(q).trim());
    const response = await coreCloudClient.request<{ success: boolean; sounds: MarketSound[] }>(
      apiUrl(`/sounds?${params.toString()}`),
      { method: 'GET', requiresAuth: false }
    );
    return Array.isArray(response.sounds) ? response.sounds.map(normalizeSound) : [];
  },

  async listSaved(limit = 150): Promise<MarketSound[]> {
    requireAuthenticatedUserId();
    const response = await coreCloudClient.request<{ success: boolean; sounds: MarketSound[] }>(
      apiUrl(`/sounds/saved?limit=${Math.min(200, Math.max(1, limit))}`),
      { method: 'GET', requiresAuth: true }
    );
    return Array.isArray(response.sounds) ? response.sounds.map(normalizeSound) : [];
  },

  async listSavedIds(limit = 150): Promise<string[]> {
    requireAuthenticatedUserId();
    const response = await coreCloudClient.request<{ success: boolean; ids: string[] }>(
      apiUrl(`/sounds/saved/ids?limit=${Math.min(200, Math.max(1, limit))}`),
      { method: 'GET', requiresAuth: true }
    );
    return Array.isArray(response.ids) ? response.ids : [];
  },

  async saveSound(soundId: string): Promise<void> {
    requireAuthenticatedUserId();
    const id = String(soundId || '').trim();
    if (!id) throw new Error('Sound not found.');
    await coreCloudClient.request(apiUrl(`/sounds/${encodeURIComponent(id)}/save`), {
      method: 'POST',
      requiresAuth: true,
    });
  },

  async unsaveSound(soundId: string): Promise<void> {
    requireAuthenticatedUserId();
    const id = String(soundId || '').trim();
    if (!id) return;
    await coreCloudClient.request(apiUrl(`/sounds/${encodeURIComponent(id)}/save`), {
      method: 'DELETE',
      requiresAuth: true,
    });
  },

  async toggleSaveSound(soundId: string, isSaved: boolean): Promise<void> {
    if (isSaved) {
      await this.unsaveSound(soundId);
      return;
    }
    await this.saveSound(soundId);
  },
};
