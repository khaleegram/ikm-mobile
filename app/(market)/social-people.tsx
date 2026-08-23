import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { usersApi } from '@/lib/api/users-api';
import { useUser } from '@/lib/firebase/auth/use-user';
import {
  avatarUriFromProfile,
  displayNameFromProfile,
} from '@/lib/hooks/use-user-identity';
import { toggleFollow, useIsFollowing } from '@/lib/hooks/use-social';
import { queryKeys } from '@/lib/query/keys';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import { toNameCase } from '@/lib/utils/name-case';

const ACCENT = '#A67C52';

type PeopleMode = 'followers' | 'following';

function normalizeMode(value: unknown): PeopleMode {
  return String(value || '').toLowerCase() === 'following' ? 'following' : 'followers';
}

function PersonRow({
  userId,
  name,
  avatarUri,
  viewerId,
}: {
  userId: string;
  name: string;
  avatarUri?: string;
  viewerId: string | null;
}) {
  const { colors } = useTheme();
  const { isFollowing, loading: followLoading } = useIsFollowing(viewerId, userId);
  const [pending, setPending] = useState(false);
  const isSelf = Boolean(viewerId && viewerId === userId);

  const onToggle = async () => {
    if (!viewerId || isSelf || pending) return;
    setPending(true);
    haptics.light();
    try {
      await toggleFollow(viewerId, userId, isFollowing);
    } catch (e: any) {
      haptics.error();
      showToast(e?.message || 'Could not update follow.', 'error');
    } finally {
      setPending(false);
    }
  };

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      activeOpacity={0.75}
      onPress={() => router.push(`/(market)/seller/${userId}` as any)}>
      <View style={[styles.avatar, { backgroundColor: `${ACCENT}22` }]}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={[styles.initials, { color: ACCENT }]}>{initials || '?'}</Text>
        )}
      </View>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      {!isSelf && viewerId ? (
        <TouchableOpacity
          style={[
            styles.followBtn,
            {
              backgroundColor: isFollowing ? colors.backgroundSecondary : ACCENT,
              borderColor: isFollowing ? colors.border : ACCENT,
            },
          ]}
          onPress={onToggle}
          disabled={pending || followLoading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {pending ? (
            <ActivityIndicator size="small" color={isFollowing ? colors.text : '#FFF'} />
          ) : (
            <Text style={[styles.followBtnText, { color: isFollowing ? colors.text : '#FFF' }]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          )}
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

export default function SocialPeopleScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const params = useLocalSearchParams<{ userId?: string; mode?: string }>();
  const mode = normalizeMode(params.mode);
  const targetUserId = String(params.userId || user?.uid || '').trim();

  const title = mode === 'following' ? 'Following' : 'Followers';

  const idsQuery = useQuery({
    queryKey:
      mode === 'following'
        ? queryKeys.social.followingOf(targetUserId)
        : queryKeys.social.followersOf(targetUserId),
    enabled: Boolean(targetUserId && user?.uid),
    staleTime: 20_000,
    queryFn: async () => {
      const { marketSocialApi } = await import('@/lib/api/market-social');
      return mode === 'following'
        ? marketSocialApi.listFollowingIds(targetUserId)
        : marketSocialApi.listFollowerIds(targetUserId);
    },
  });

  const ids = idsQuery.data ?? [];

  const usersQuery = useQuery({
    queryKey: queryKeys.user.batch(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: () => usersApi.getBatch(ids),
  });

  const rows = useMemo(() => {
    const byId = new Map((usersQuery.data ?? []).map((u) => [u.id, u]));
    return ids.map((id) => {
      const profile = byId.get(id);
      return {
        id,
        name: toNameCase(displayNameFromProfile(profile ?? null, 'User')),
        avatarUri: avatarUriFromProfile(profile ?? null),
      };
    });
  }, [ids, usersQuery.data]);

  const loading = Boolean(user?.uid) && (idsQuery.isPending || (ids.length > 0 && usersQuery.isPending));

  const onRefresh = useCallback(() => {
    void idsQuery.refetch();
  }, [idsQuery]);

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sign in to view {title.toLowerCase()}</Text>
        <TouchableOpacity
          style={[styles.loginBtn, { backgroundColor: ACCENT }]}
          onPress={() => router.push(getLoginRouteForVariant('market') as any)}>
          <Text style={styles.loginBtnText}>Log in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <IconSymbol name="chevron.left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
        <View style={styles.headerBtn} />
      </View>

      {loading && rows.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : idsQuery.isError && rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn’t load {title.toLowerCase()}</Text>
          <TouchableOpacity onPress={onRefresh}>
            <Text style={{ color: ACCENT, fontWeight: '700' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            rows.length === 0
              ? [styles.emptyList, { paddingBottom: insets.bottom + 40 }]
              : { paddingBottom: insets.bottom + 24 }
          }
          refreshing={idsQuery.isFetching && !idsQuery.isPending}
          onRefresh={onRefresh}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {mode === 'following' ? 'Not following anyone yet' : 'No followers yet'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <PersonRow
              userId={item.id}
              name={item.name}
              avatarUri={item.avatarUri}
              viewerId={user.uid}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyList: { flexGrow: 1 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  loginBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20 },
  loginBtnText: { color: '#FFF', fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: 14, fontWeight: '800' },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  followBtn: {
    minWidth: 88,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  followBtnText: { fontSize: 12, fontWeight: '800' },
});
