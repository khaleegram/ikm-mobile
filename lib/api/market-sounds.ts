import type { MarketSound } from '@/types';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { auth, firestore } from '@/lib/firebase/config';

export interface CreateMarketSoundData {
  title: string;
  sourceUri: string;
  sourceType: MarketSound['sourceType'];
  artworkUrl?: string;
  durationMs?: number;
  creatorName?: string;
  rightsStatus?: MarketSound['rightsStatus'];
}

function requireAuthenticatedUserId(): string {
  const userId = auth.currentUser?.uid;
  if (!userId) {
    throw new Error('Please log in to continue.');
  }
  return userId;
}

function normalizeSoundTitle(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function buildLocalSoundSnapshot(id: string, data: CreateMarketSoundData, userId: string): MarketSound {
  const now = new Date();
  return {
    id,
    title: normalizeSoundTitle(data.title) || 'Untitled sound',
    createdBy: userId,
    creatorName: String(data.creatorName || '').trim() || undefined,
    sourceType: data.sourceType,
    sourceUri: String(data.sourceUri || '').trim(),
    artworkUrl: String(data.artworkUrl || '').trim() || undefined,
    durationMs: Number.isFinite(data.durationMs) ? Math.max(0, Number(data.durationMs)) : undefined,
    usageCount: 0,
    savedCount: 0,
    rightsStatus: data.rightsStatus || 'owned',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export const marketSoundsApi = {
  async create(data: CreateMarketSoundData): Promise<MarketSound> {
    const userId = requireAuthenticatedUserId();
    const title = normalizeSoundTitle(data.title);
    const sourceUri = String(data.sourceUri || '').trim();

    if (!title) {
      throw new Error('Sound title is required.');
    }
    if (!sourceUri) {
      throw new Error('Sound source is required.');
    }

    const soundRef = doc(collection(firestore, 'marketSounds'));
    const sound = buildLocalSoundSnapshot(soundRef.id, data, userId);

    await setDoc(soundRef, {
      title: sound.title,
      createdBy: userId,
      creatorName: sound.creatorName || null,
      sourceType: sound.sourceType,
      sourceUri: sound.sourceUri,
      artworkUrl: sound.artworkUrl || null,
      durationMs: sound.durationMs ?? null,
      usageCount: 0,
      savedCount: 0,
      rightsStatus: sound.rightsStatus,
      status: sound.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return sound;
  },

  async get(soundId: string): Promise<MarketSound | null> {
    const normalizedSoundId = String(soundId || '').trim();
    if (!normalizedSoundId) return null;

    const snapshot = await getDoc(doc(firestore, 'marketSounds', normalizedSoundId));
    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    return {
      id: snapshot.id,
      title: String(data.title || '').trim() || 'Untitled sound',
      createdBy: String(data.createdBy || '').trim(),
      creatorName: String(data.creatorName || '').trim() || undefined,
      sourceType: data.sourceType || 'uploaded',
      sourceUri: String(data.sourceUri || '').trim(),
      artworkUrl: String(data.artworkUrl || '').trim() || undefined,
      durationMs: Number.isFinite(data.durationMs) ? Number(data.durationMs) : undefined,
      usageCount: typeof data.usageCount === 'number' ? data.usageCount : 0,
      savedCount: typeof data.savedCount === 'number' ? data.savedCount : 0,
      rightsStatus: data.rightsStatus || 'owned',
      status: data.status || 'active',
      createdAt: data.createdAt?.toDate?.() || new Date(0),
      updatedAt: data.updatedAt?.toDate?.() || new Date(0),
    };
  },

  async incrementUsage(soundId: string, amount: number = 1): Promise<void> {
    const normalizedSoundId = String(soundId || '').trim();
    if (!normalizedSoundId || !Number.isFinite(amount) || amount === 0) return;

    await updateDoc(doc(firestore, 'marketSounds', normalizedSoundId), {
      usageCount: increment(amount),
      updatedAt: serverTimestamp(),
    });
  },

  async saveSound(soundId: string): Promise<void> {
    const userId = requireAuthenticatedUserId();
    const normalizedSoundId = String(soundId || '').trim();
    if (!normalizedSoundId) {
      throw new Error('Sound not found.');
    }

    const saveRef = doc(firestore, 'marketSoundSaves', `${userId}_${normalizedSoundId}`);
    const saveSnapshot = await getDoc(saveRef);
    if (saveSnapshot.exists()) return;

    const batch = writeBatch(firestore);
    batch.set(saveRef, {
      soundId: normalizedSoundId,
      userId,
      createdAt: serverTimestamp(),
    });
    batch.set(
      doc(firestore, 'marketSounds', normalizedSoundId),
      {
        savedCount: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();
  },

  async unsaveSound(soundId: string): Promise<void> {
    const userId = requireAuthenticatedUserId();
    const normalizedSoundId = String(soundId || '').trim();
    if (!normalizedSoundId) return;

    const saveRef = doc(firestore, 'marketSoundSaves', `${userId}_${normalizedSoundId}`);
    const saveSnapshot = await getDoc(saveRef);
    if (!saveSnapshot.exists()) return;

    const batch = writeBatch(firestore);
    batch.delete(saveRef);
    batch.set(
      doc(firestore, 'marketSounds', normalizedSoundId),
      {
        savedCount: increment(-1),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();
  },

  async toggleSaveSound(soundId: string, isSaved: boolean): Promise<void> {
    if (isSaved) {
      await this.unsaveSound(soundId);
      return;
    }
    await this.saveSound(soundId);
  },

  async delete(soundId: string): Promise<void> {
    const userId = requireAuthenticatedUserId();
    const normalizedSoundId = String(soundId || '').trim();
    if (!normalizedSoundId) return;

    const soundSnapshot = await getDoc(doc(firestore, 'marketSounds', normalizedSoundId));
    if (!soundSnapshot.exists()) return;

    const ownerId = String(soundSnapshot.data()?.createdBy || '').trim();
    if (!ownerId || ownerId !== userId) {
      throw new Error('Only the sound owner can delete this sound.');
    }

    await deleteDoc(doc(firestore, 'marketSounds', normalizedSoundId));
  },
};
