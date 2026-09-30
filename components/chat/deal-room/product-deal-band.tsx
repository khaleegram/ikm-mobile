import { router } from 'expo-router';
import React, { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { dealProductLabel } from '@/lib/chat/enrich-inbox-snapshots';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import type { ChatInboxItem, ChatPostSnapshot } from '@/types/chat';

const lightBrown = '#A67C52';

type ProductDealBandProps = {
  currentThreadId?: string | null;
  peerId?: string | null;
  /** Every room with this peer — the band becomes a switcher when there is more than one. */
  rooms: ChatInboxItem[];
  snapshot?: ChatPostSnapshot | null;
  postId?: string | null;
  linkedOrderId?: string | null;
};

/**
 * One row that carries the whole product context: which product this deal is about, and a way
 * to switch when the buyer is talking to the same seller about several.
 *
 * This used to be two stacked rows — a switcher strip above a product card — which together ate
 * roughly a sixth of the screen before a single message was drawn. Same information, half the
 * height, and the name reads as one line instead of a label above a title.
 */
export const ProductDealBand = memo(function ProductDealBand({
  currentThreadId,
  peerId,
  rooms,
  snapshot,
  postId,
  linkedOrderId,
}: ProductDealBandProps) {
  const { colors } = useTheme();

  const siblings = useMemo(() => {
    const pid = String(peerId || '').trim();
    if (!pid) return [] as ChatInboxItem[];
    const filtered = rooms
      .filter((room) => room.peerId === pid)
      .sort((a, b) => {
        const aMs = a.lastAt ? new Date(a.lastAt).getTime() : 0;
        const bMs = b.lastAt ? new Date(b.lastAt).getTime() : 0;
        return bMs - aMs;
      });
    // One chip per product
    const byPost = new Map<string, ChatInboxItem>();
    for (const room of filtered) {
      const key = String(room.postId || room.threadId || '').trim();
      if (!key || byPost.has(key)) continue;
      byPost.set(key, room);
    }
    return Array.from(byPost.values());
  }, [peerId, rooms]);

  const title = dealProductLabel(snapshot);
  const multiple = siblings.length > 1;
  const avatarUri = String(snapshot?.imageUrl || '').trim() || undefined;

  const openProduct = () => {
    if (linkedOrderId) {
      router.push(`/(market)/orders/${linkedOrderId}` as any);
      return;
    }
    if (postId) {
      router.push(`/(market)/post/${postId}` as any);
    }
  };

  return (
    <View style={[styles.band, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {multiple ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripRow}
          style={styles.strip}
          keyboardShouldPersistTaps="handled">
          {siblings.map((room) => {
            const active = room.threadId === currentThreadId;
            const snap = room.postSnapshot || {};
            const label = dealProductLabel(snap);
            const imageUri = String(snap.imageUrl || '').trim() || undefined;

            return (
              <TouchableOpacity
                key={room.threadId}
                style={[
                  styles.thumbWrap,
                  {
                    borderColor: active ? lightBrown : 'transparent',
                  },
                ]}
                activeOpacity={0.8}
                disabled={active}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.light();
                  router.replace(
                    `/(market)/messages/${room.threadId}?peerId=${encodeURIComponent(room.peerId)}` as any
                  );
                }}>
                {imageUri ? (
                  <SafeImage uri={imageUri} style={[styles.thumb, !active && styles.thumbIdle]} />
                ) : (
                  <View
                    style={[
                      styles.thumb,
                      styles.thumbFallback,
                      { backgroundColor: colors.backgroundSecondary },
                      !active && styles.thumbIdle,
                    ]}>
                    <Text style={[styles.thumbLetter, { color: colors.textSecondary }]}>
                      {label.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                {!active && Number(room.unreadCount || 0) > 0 ? (
                  <View style={styles.dot}>
                    <Text style={styles.dotText}>
                      {Number(room.unreadCount) > 9 ? '9+' : room.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      <TouchableOpacity
        style={styles.main}
        activeOpacity={0.85}
        disabled={!postId && !linkedOrderId}
        accessibilityRole="button"
        accessibilityLabel={`${title}. Open product.`}
        onPress={openProduct}>
        {!multiple && avatarUri ? <SafeImage uri={avatarUri} style={styles.thumb} /> : null}
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <IconSymbol name="chevron.right" size={13} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  band: {
    marginHorizontal: 12,
    marginTop: 6,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  /** Keeps the switcher from crowding the product name when there are several rooms. */
  strip: {
    maxWidth: '46%',
    flexGrow: 0,
  },
  stripRow: {
    alignItems: 'center',
    gap: 4,
    paddingRight: 2,
  },
  thumbWrap: {
    padding: 1,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  thumb: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  thumbIdle: {
    opacity: 0.45,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLetter: {
    fontSize: 12,
    fontWeight: '800',
  },
  dot: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightBrown,
  },
  dotText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
  },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 2,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 13.5,
    fontWeight: '700',
  },
});
