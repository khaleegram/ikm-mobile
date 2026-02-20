import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { MarketComment } from '@/types';
import { usePublicUserProfile } from '@/lib/firebase/firestore/users';
import { useUser } from '@/lib/firebase/auth/use-user';
import { marketCommentsApi } from '@/lib/api/market-comments';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { AnimatedPressable } from '@/components/animated-pressable';
import { haptics } from '@/lib/utils/haptics';

interface CommentItemProps {
  comment: MarketComment;
  onDeleted?: () => void;
}

export function CommentItem({ comment, onDeleted }: CommentItemProps) {
  const { colors } = useTheme();
  const { user } = useUser();
  const { user: commenter } = usePublicUserProfile(comment.userId);
  const isOwner = user?.uid === comment.userId;

  const handleDelete = () => {
    Alert.alert('Delete Comment', 'Are you sure you want to delete this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            haptics.medium();
            await marketCommentsApi.delete(comment.id!);
            haptics.success();
            onDeleted?.();
          } catch (error: any) {
            console.error('Error deleting comment:', error);
            haptics.error();
            Alert.alert('Error', 'Failed to delete comment. Please try again.');
          }
        },
      },
    ]);
  };

  const displayName = commenter?.displayName || commenter?.storeName || 'User';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <View style={styles.header}>
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: colors.backgroundSecondary }]}>
          {commenter?.storeLogoUrl ? (
            <Text style={[styles.avatarText, { color: colors.text }]}>{initials}</Text>
          ) : (
            <Text style={[styles.avatarText, { color: colors.text }]}>{initials}</Text>
          )}
        </View>

        {/* Comment Content */}
        <View style={styles.content}>
          <View style={styles.commentHeader}>
            <Text style={[styles.userName, { color: colors.text }]}>{displayName}</Text>
            <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
              {formatRelativeTime(comment.createdAt)}
            </Text>
          </View>
          <Text style={[styles.commentText, { color: colors.text }]}>{comment.comment}</Text>
        </View>

        {/* Delete Button */}
        {isOwner && (
          <AnimatedPressable
            style={styles.deleteButton}
            onPress={handleDelete}
            scaleValue={0.9}>
            <IconSymbol name="trash" size={18} color={colors.textSecondary} />
          </AnimatedPressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  header: {
    flexDirection: 'row',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 12,
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  deleteButton: {
    padding: 4,
  },
});
