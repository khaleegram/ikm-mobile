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
    return rooms
      .filter((room) => room.peerId === pid)
      .sort((a, b) => {
        const aMs = a.lastAt ? new Date(a.lastAt).getTime() : 0;
        const bMs = b.lastAt ? new Date(b.lastAt).getTime() : 0;
        return bMs - aMs;
      });
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
          const title = String(snap.title || '').trim() || 'Product';
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
              onPress={() => {
                haptics.light();
                router.replace(
                  `/(market)/messages/${room.threadId}?peerId=${encodeURIComponent(room.peerId)}` as any
                );
              }}>
              {imageUri ? (
                <SafeImage uri={imageUri} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, { backgroundColor: colors.card }]} />
              )}
              <Text
                style={[styles.title, { color: active ? lightBrown : colors.text }]}
                numberOfLines={1}>
                {title}
              </Text>
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
    paddingVertical: 4,
  },
  row: {
    paddingHorizontal: 10,
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 130,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 6,
  },
  title: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  dot: {
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
    fontSize: 9,
    fontWeight: '800',
  },
});
