import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { marketSoundsApi } from '@/lib/api/market-sounds';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useSavedMarketSounds } from '@/lib/firebase/firestore/market-sounds';
import { useTheme } from '@/lib/theme/theme-context';
import { getMarketBranding } from '@/lib/market-branding';
import { haptics } from '@/lib/utils/haptics';
import { buildMarketSoundStableKey } from '@/lib/utils/market-media';
import type { MarketSound } from '@/types';

const lightBrown = '#A67C52';

export default function SavedSoundsScreen() {
  const marketBrand = getMarketBranding();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { sounds, loading } = useSavedMarketSounds(user?.uid || null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);

  const previewSound = useMemo(() => sounds.find((item) => item.id && item.id === previewingId) || null, [previewingId, sounds]);
  const audioPlayer = useAudioPlayer(previewSound?.sourceUri || null, { updateIntervalMs: 450 });

  const stopPreview = () => {
    setPreviewingId(null);
    void audioPlayer.pause();
    audioPlayer.currentTime = 0;
  };

  const togglePreview = (sound: MarketSound) => {
    if (!sound.id) return;
    haptics.light();
    setPreviewingId((current) => {
      const next = current === sound.id ? null : sound.id;
      return next;
    });
  };

  React.useEffect(() => {
    if (!previewingId) {
      void audioPlayer.pause();
      audioPlayer.currentTime = 0;
      return;
    }
    void audioPlayer.play();
  }, [audioPlayer, previewingId]);

  const toggleUnsave = async (sound: MarketSound) => {
    if (!sound.id) return;
    const soundId = sound.id;
    if (busyIds.includes(soundId)) return;
    setBusyIds((prev) => [...prev, soundId]);
    haptics.light();
    try {
      await marketSoundsApi.unsaveSound(soundId);
      if (previewingId === soundId) stopPreview();
    } catch (error: any) {
      showToast(error?.message || 'Unable to update saved sound.', 'error');
    } finally {
      setBusyIds((prev) => prev.filter((id) => id !== soundId));
    }
  };

  const renderRow = ({ item }: { item: MarketSound }) => {
    const isPreviewing = Boolean(item.id && item.id === previewingId);
    const isBusy = Boolean(item.id && busyIds.includes(item.id));
    const creatorLabel = item.creatorName ? `by ${item.creatorName}` : 'IKM sound';

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => {
          if (!item.id) return;
          haptics.light();
          router.push(`/(market)/sound/${item.id}` as any);
        }}>
        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.playButton, { backgroundColor: colors.backgroundSecondary }]}
          onPress={() => togglePreview(item)}>
          <IconSymbol name={isPreviewing ? 'pause.fill' : 'play.fill'} size={16} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.rowContent}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {creatorLabel}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {`${item.usageCount || 0} uses`}
          </Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.unsaveButton, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
          onPress={() => toggleUnsave(item)}
          disabled={isBusy}>
          {isBusy ? (
            <ActivityIndicator size="small" color={lightBrown} />
          ) : (
            <Text style={[styles.unsaveText, { color: colors.text }]}>Unsave</Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 10 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => {
            haptics.light();
            stopPreview();
            router.back();
          }}>
          <IconSymbol name="arrow.left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={[styles.headerIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.headerLabel}>{marketBrand.headerLine}</Text>
          <Text style={styles.headerTitle}>Saved Sounds</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      ) : sounds.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="music.note" size={34} color={lightBrown} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No saved sounds yet</Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            Save sounds from the sound page or while choosing a sound during post creation.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: lightBrown }]}
            onPress={() => {
              haptics.medium();
              router.push('/(market)/create-post' as any);
            }}>
            <Text style={styles.primaryButtonText}>Create a Post</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sounds}
          keyExtractor={(item) => buildMarketSoundStableKey(item)}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: insets.bottom + 120, paddingHorizontal: 16, paddingTop: 14 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => {
            if (previewingId) stopPreview();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIsland: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyHint: { fontSize: 12, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
  primaryButton: { marginTop: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 16, justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
  row: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 12, fontWeight: '600' },
  unsaveButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unsaveText: { fontSize: 12, fontWeight: '800' },
});

