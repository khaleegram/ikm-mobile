import { router } from 'expo-router';
import React, { memo, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { dealProductLabel } from '@/lib/chat/enrich-inbox-snapshots';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import type { ChatInboxItem } from '@/types/chat';

const lightBrown = '#A67C52';

type ProductRoomSwitcherProps = {
  currentThreadId: string | null | undefined;
  peerId: string | null | undefined;
  rooms: ChatInboxItem[];
};

export const ProductRoomSwitcher = memo(function ProductRoomSwitcher({
  currentThreadId,
  peerId,
  rooms,
}: ProductRoomSwitcherProps) {
  const { colors } = useTheme();

  const siblingRooms = useMemo(() => {
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

  if (siblingRooms.length <= 1) return null;

  return (
    <View style={[styles.wrap, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {siblingRooms.map((room) => {
          const active = room.threadId === currentThreadId;
          const snap = room.postSnapshot || {};
          const title = dealProductLabel(snap);
          const imageUri = String(snap.imageUrl || '').trim() || undefined;
          const unread = Number(room.unreadCount || 0);

          return (
            <TouchableOpacity
              key={room.threadId}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? `${lightBrown}22` : colors.backgroundSecondary,
                  borderColor: active ? lightBrown : colors.border,
                },
              ]}
              activeOpacity={0.85}
              disabled={active}
              accessibilityRole="button"
              accessibilityLabel={title}
              accessibilityState={{ selected: active }}
              onPress={() => {
                haptics.light();
                router.replace(
                  `/(market)/messages/${room.threadId}?peerId=${encodeURIComponent(room.peerId)}` as any
                );
              }}>
              {imageUri ? (
                <SafeImage uri={imageUri} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: colors.card }]}>
                  <Text style={[styles.thumbLetter, { color: colors.textSecondary }]}>
                    {title.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              {unread > 0 && !active ? (
                <View style={styles.dot}>
                  <Text style={styles.dotText}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  row: {
    paddingHorizontal: 10,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    position: 'relative',
    padding: 3,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 9,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLetter: {
    fontSize: 13,
    fontWeight: '800',
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightBrown,
  },
  dotText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
});
