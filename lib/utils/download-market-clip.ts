import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

import { showToast } from '@/components/toast';
import { getMarketPostPrimaryImage, isVideoMarketPost } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

function extensionForUri(uri: string, fallback: string) {
  const clean = String(uri || '').split('?')[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1] ? match[1].toLowerCase() : fallback;
}

/** Best-effort download/share of the active clip media (long-press). */
export async function downloadMarketClip(post: MarketPost): Promise<void> {
  const isVideo = isVideoMarketPost(post);
  const uri = isVideo
    ? String(post.videoUrl || '').trim()
    : String(getMarketPostPrimaryImage(post) || '').trim();

  if (!uri) {
    showToast('No media to download.', 'error');
    return;
  }

  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Download', 'Sharing is not available on this device.');
      return;
    }

    const ext = extensionForUri(uri, isVideo ? 'mp4' : 'jpg');
    const destination = `${FileSystem.cacheDirectory}clip-${post.id || 'media'}.${ext}`;
    const result = await FileSystem.downloadAsync(uri, destination);
    await Sharing.shareAsync(result.uri, {
      mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
      dialogTitle: 'Save clip',
    });
  } catch (error: any) {
    showToast(error?.message || 'Unable to download clip.', 'error');
  }
}
