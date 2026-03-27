import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { marketSoundsApi } from '@/lib/api/market-sounds';
import { marketSocialApi } from '@/lib/api/market-social';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostsBySound } from '@/lib/firebase/firestore/market-posts';
import { useIsMarketSoundSaved, useMarketSound } from '@/lib/firebase/firestore/market-sounds';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { buildMarketPostStableKey, getMarketPostPrimaryImage } from '@/lib/utils/market-media';
import type { MarketPost } from '@/types';

const lightBrown = '#A67C52';

export default function MarketSoundDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const params = useLocalSearchParams<{ soundId?: string }>();
  const soundId = String(params?.soundId || '').trim() || null;

  const { sound, loading: soundLoading } = useMarketSound(soundId);
  const { posts, loading: postsLoading } = useMarketPostsBySound(soundId);
  const { isSaved, loading: savedLoading } = useIsMarketSoundSaved(soundId, user?.uid || null);

  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const audioPlayer = useAudioPlayer(sound?.sourceUri || null, { updateIntervalMs: 450 });

  const headerSubtitle = useMemo(() => {
    const creator = sound?.creatorName ? `by ${sound.creatorName}` : 'IKM sound';
    const uses = `${sound?.usageCount || 0} uses`;
    const saves = `${sound?.savedCount || 0} saves`;
    return `${creator} • ${uses} • ${saves}`;
  }, [sound?.creatorName, sound?.savedCount, sound?.usageCount]);

  const stopPreview = () => {
    setPreviewing(false);
    void audioPlayer.pause();
    audioPlayer.currentTime = 0;
  };

  const togglePreview = () => {
    haptics.light();
    setPreviewing((value) => !value);
  };

  React.useEffect(() => {
    if (!previewing) {
      void audioPlayer.pause();
      return;
    }
    void audioPlayer.play();
  }, [audioPlayer, previewing]);

  const handleToggleSave = async () => {
    if (!soundId) return;
    if (!user) {
      showToast('Please log in to save sounds.', 'info');
      return;
    }
    if (saving) return;
    setSaving(true);
    haptics.light();
    try {
      await marketSoundsApi.toggleSaveSound(soundId, Boolean(isSaved));
    } catch (error: any) {
      showToast(error?.message || 'Unable to update saved sound.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUseSound = () => {
    if (!sound?.id) return;
    haptics.medium();
    router.push(`/(market)/create-post?soundId=${encodeURIComponent(sound.id)}` as any);
  };

  const handleReportSound = () => {
    if (!soundId) return;
    if (!user) {
      showToast('Please log in to report sounds.', 'info');
      return;
    }
    haptics.light();
    Alert.alert('Report sound', 'Choose a reason', [
      {
        text: 'Spam',
        onPress: async () => {
          try {
            await marketSocialApi.report({ targetType: 'sound', targetId: soundId, reason: 'spam' });
            showToast('Report submitted. Thank you.', 'success');
          } catch (error: any) {
            showToast(error?.message || 'Unable to submit report.', 'error');
          }
        },
      },
      {
        text: 'Harassment',
        onPress: async () => {
          try {
            await marketSocialApi.report({ targetType: 'sound', targetId: soundId, reason: 'harassment' });
            showToast('Report submitted. Thank you.', 'success');
          } catch (error: any) {
            showToast(error?.message || 'Unable to submit report.', 'error');
          }
        },
      },
      {
        text: 'Copyright',
        onPress: async () => {
          try {
            await marketSocialApi.report({ targetType: 'sound', targetId: soundId, reason: 'copyright' });
            showToast('Report submitted. Thank you.', 'success');
          } catch (error: any) {
            showToast(error?.message || 'Unable to submit report.', 'error');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderPost = ({ item }: { item: MarketPost }) => {
    const imageUri = getMarketPostPrimaryImage(item);
    const priceLabel = item.price && item.price > 0 ? `NGN ${Number(item.price).toLocaleString()}` : 'Ask for price';
    const caption = item.description?.trim() || 'No caption';

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.postRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => {
          if (!item.id) return;
          haptics.light();
          router.push(`/(market)/post/${item.id}` as any);
        }}>
        <View style={[styles.postThumb, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
          {imageUri ? (
            // Keep lightweight: no image component dependency here.
            <View style={styles.postThumbInner} />
          ) : (
            <IconSymbol name="photo.fill" size={18} color={colors.textSecondary} />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.postPrice, { color: colors.text }]} numberOfLines={1}>
            {priceLabel}
          </Text>
          <Text style={[styles.postCaption, { color: colors.textSecondary }]} numberOfLines={2}>
            {caption}
          </Text>
        </View>

        <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  if (soundLoading && !sound) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  if (!soundId || !sound) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background, paddingTop: insets.top + 10 }]}>
        <IconSymbol name="music.note" size={38} color={lightBrown} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sound not found</Text>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: lightBrown }]}
          onPress={() => {
            haptics.light();
            router.back();
          }}>
          <Text style={styles.primaryButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
          <Text style={styles.headerLabel}>MARKET SOUND</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {sound.title}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {headerSubtitle}
          </Text>
        </View>
      </View>

      <View style={[styles.actionRow, { paddingHorizontal: 16 }]}>
        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={togglePreview}>
          <IconSymbol name={previewing ? 'pause.fill' : 'play.fill'} size={18} color={colors.text} />
          <Text style={[styles.actionText, { color: colors.text }]}>{previewing ? 'Pause' : 'Preview'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleToggleSave}
          disabled={saving || savedLoading}>
          {saving ? (
            <ActivityIndicator size="small" color={lightBrown} />
          ) : (
            <IconSymbol name={isSaved ? 'bookmark.fill' : 'bookmark'} size={18} color={isSaved ? lightBrown : colors.text} />
          )}
          <Text style={[styles.actionText, { color: colors.text }]}>{isSaved ? 'Saved' : 'Save'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.primaryActionButton, { backgroundColor: lightBrown }]}
          onPress={handleUseSound}>
          <IconSymbol name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.primaryActionText}>Use</Text>
        </TouchableOpacity>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.reportButton, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={handleReportSound}>
          <IconSymbol name="exclamationmark.bubble.fill" size={14} color={colors.textSecondary} />
          <Text style={[styles.reportButtonText, { color: colors.textSecondary }]}>Report this sound</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.sectionHeader, { paddingHorizontal: 16 }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Posts using this sound</Text>
        <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
          Tap a post to open comments.
        </Text>
      </View>

      {postsLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={lightBrown} />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>No posts found for this sound yet.</Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => buildMarketPostStableKey(item)}
          renderItem={renderPost}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => {
            if (previewing) stopPreview();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, gap: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 14,
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
    color: 'rgba(255,255,255,0.72)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  headerSubtitle: { color: 'rgba(255,255,255,0.76)', fontSize: 11, fontWeight: '700', marginTop: 3 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  actionButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: { fontSize: 13, fontWeight: '900' },
  primaryActionButton: {
    minWidth: 92,
    borderRadius: 16,
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  reportButton: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  reportButtonText: { fontSize: 12, fontWeight: '700' },
  sectionHeader: { gap: 4, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '900' },
  sectionHint: { fontSize: 12, fontWeight: '600' },
  emptyTitle: { fontSize: 17, fontWeight: '900' },
  emptyHint: { fontSize: 12, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
  primaryButton: { marginTop: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 16, justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
  postRow: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postThumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  postThumbInner: { width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.25)' },
  postPrice: { fontSize: 13, fontWeight: '900' },
  postCaption: { marginTop: 3, fontSize: 12, fontWeight: '600', lineHeight: 18 },
});

