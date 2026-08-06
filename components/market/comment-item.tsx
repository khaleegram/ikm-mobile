import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';
import { useTheme } from '@/lib/theme/theme-context';
import { MarketComment } from '@/types';
import { usePublicUserProfileOnce } from '@/lib/firebase/firestore/users';
import { useUser } from '@/lib/firebase/auth/use-user';
import { deleteMarketCommentOptimistic } from '@/lib/hooks/use-market-comments';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { haptics } from '@/lib/utils/haptics';
import { Alert } from '@/components/app-alert';

interface CommentItemProps {
  comment: MarketComment;
  onDeleted?: () => void;
  darkMode?: boolean;
  pending?: boolean;
}

export const CommentItem = React.memo(function CommentItem({
  comment,
  onDeleted,
  darkMode,
  pending,
}: CommentItemProps) {
  const { colors: themeColors } = useTheme();
  const colors = darkMode
    ? {
        ...themeColors,
        text: '#FFFFFF',
        textSecondary: 'rgba(255,255,255,0.5)',
        backgroundSecondary: 'rgba(255,255,255,0.12)',
        border: 'rgba(255,255,255,0.06)',
      }
    : themeColors;
  const { user } = useUser();
  const { user: commenter } = usePublicUserProfileOnce(comment.userId);
  const isOwner = user?.uid === comment.userId;

  const handleDelete = () => {
    if (pending || !comment.id || String(comment.id).startsWith('temp_')) return;
    Alert.alert('Delete Comment', 'Remove this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            haptics.medium();
            await deleteMarketCommentOptimistic(String(comment.postId || ''), comment.id!);
            haptics.success();
            onDeleted?.();
          } catch (error: any) {
            console.error('Error deleting comment:', error);
            haptics.error();
            Alert.alert('Error', 'Failed to delete comment.');
          }
        },
      },
    ]);
  };

  const displayName = commenter?.displayName || commenter?.storeName || 'User';
  const showVerified = Boolean(commenter?.storeName);
  const avatarUri = useMemo(
    () => String(commenter?.storeLogoUrl || (commenter as any)?.photoURL || '').trim() || null,
    [commenter]
  );
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }, pending && styles.pending]}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: colors.backgroundSecondary }]}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Text style={[styles.avatarInitials, { color: colors.text }]}>{initials || '?'}</Text>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.metaRow}>
            <View style={styles.nameRow}>
              <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>{displayName}</Text>
              {showVerified ? <VerifiedBadge size={12} /> : null}
            </View>
            <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
              {pending ? 'now' : formatRelativeTime(comment.createdAt)}
            </Text>
          </View>
          <Text style={[styles.commentText, { color: colors.text }]}>{comment.comment}</Text>
        </View>

        {isOwner && !pending && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <IconSymbol name="trash" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pending: {
    opacity: 0.72,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarInitials: {
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  timestamp: {
    fontSize: 10,
    fontWeight: '500',
  },
  commentText: {
    fontSize: 12,
    lineHeight: 17,
  },
  deleteBtn: {
    paddingTop: 2,
  },
});
