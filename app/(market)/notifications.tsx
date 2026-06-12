import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useNotifications } from '@/lib/firebase/firestore/notifications';
import { notificationsApi } from '@/lib/api/notifications';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { haptics } from '@/lib/utils/haptics';
import { AppNotification } from '@/types';

const lightBrown = '#A67C52';

function getNotificationIcon(type: string): string {
  switch (type) {
    case 'order_update': return 'shippingbox.fill';
    case 'payment': return 'dollarsign.circle.fill';
    case 'new_message': return 'message.fill';
    case 'dispute': return 'exclamationmark.triangle.fill';
    default: return 'bell.fill';
  }
}

function getTimeAgo(date: any): string {
  if (!date) return '';
  const d = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { notifications, unreadCount, loading } = useNotifications(user?.uid || null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 600));
    setRefreshing(false);
  };

  const handleMarkAllRead = async () => {
    haptics.light();
    try {
      await notificationsApi.markAllRead();
    } catch {}
  };

  const handlePress = useCallback(async (item: AppNotification) => {
    haptics.light();
    if (!item.read) {
      try {
        await notificationsApi.markRead(item.id!);
      } catch {}
    }
    if (item.actionUrl) {
      router.push(item.actionUrl as any);
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => (
      <TouchableOpacity
        style={[styles.notifItem, !item.read && styles.notifUnread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.7}>
        <View style={[styles.notifIcon, { backgroundColor: item.read ? 'rgba(255,255,255,0.06)' : `${lightBrown}15` }]}>
          <IconSymbol
            name={getNotificationIcon(item.type)}
            size={18}
            color={item.read ? 'rgba(255,255,255,0.4)' : lightBrown}
          />
        </View>
        <View style={styles.notifBody}>
          <Text style={[styles.notifTitle, { color: item.read ? 'rgba(255,255,255,0.5)' : '#FFFFFF' }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.notifBodyText, { color: 'rgba(255,255,255,0.4)' }]} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        <Text style={[styles.notifTime, { color: 'rgba(255,255,255,0.3)' }]}>
          {getTimeAgo(item.createdAt)}
        </Text>
        {!item.read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    ),
    [handlePress]
  );

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: 'rgba(255,255,255,0.08)' }]}>
        <TouchableOpacity style={styles.headerIcon} onPress={() => router.back()}>
          <IconSymbol name="arrow.left" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerMiddle}>
          <Text style={styles.headerTitle}>Notifications</Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity style={styles.markAllBtn} onPress={handleMarkAllRead}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && notifications.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightBrown} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="bell.slash.fill" size={40} color="rgba(255,255,255,0.2)" />
          <Text style={[styles.emptyText, { color: 'rgba(255,255,255,0.3)' }]}>No notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          renderItem={renderItem}
          keyExtractor={(item) => item.id || Math.random().toString()}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 10 },
  headerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerMiddle: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  markAllBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  markAllText: { color: lightBrown, fontSize: 12, fontWeight: '700' },
  notifItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    position: 'relative',
  },
  notifUnread: { backgroundColor: 'rgba(166,124,82,0.04)' },
  notifIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBody: { flex: 1, gap: 3 },
  notifTitle: { fontSize: 14, fontWeight: '700' },
  notifBodyText: { fontSize: 13, lineHeight: 18 },
  notifTime: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  unreadDot: { position: 'absolute', top: 18, right: 16, width: 8, height: 8, borderRadius: 4, backgroundColor: lightBrown },
  emptyText: { fontSize: 15, fontWeight: '600' },
});
