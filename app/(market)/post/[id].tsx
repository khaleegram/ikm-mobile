import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';

import { CommentItem } from '@/components/market/comment-item';
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { marketCommentsApi } from '@/lib/api/market-comments';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostComments } from '@/lib/firebase/firestore/market-comments';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import type { MarketComment } from '@/types';

const lightBrown = '#A67C52';

function CommentsSkeleton({ count = 5, colors }: { count?: number; colors: any }) {
  const SKELETON_COLOR = colors.border;
  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16, gap: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: SKELETON_COLOR, opacity: 0.5 }} />
          <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
            <View style={{ width: 120, height: 14, backgroundColor: SKELETON_COLOR, opacity: 0.5, borderRadius: 4 }} />
            <View style={{ width: '80%', height: 12, backgroundColor: SKELETON_COLOR, opacity: 0.3, borderRadius: 4 }} />
            <View style={{ width: '60%', height: 12, backgroundColor: SKELETON_COLOR, opacity: 0.3, borderRadius: 4 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { comments, loading: commentsLoading } = useMarketPostComments(id as string);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const commentsListRef = useRef<FlashList<MarketComment>>(null);
  const marketLoginRoute = getLoginRouteForVariant('market');

  const orderedComments = useMemo(() => [...comments].reverse(), [comments]);

  const scrollToLatestComment = () => {
    requestAnimationFrame(() => {
      commentsListRef.current?.scrollToEnd({ animated: true });
    });
  };

  useEffect(() => {
    if (orderedComments.length > 0) {
      scrollToLatestComment();
    }
  }, [orderedComments.length]);

  const handleComment = async () => {
    if (!id) return;

    if (!user) {
      Alert.alert('Login Required', 'Please log in to comment', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push(marketLoginRoute as any) },
      ]);
      return;
    }

    if (!commentText.trim()) return;

    setSubmittingComment(true);
    haptics.medium();

    try {
      await marketCommentsApi.create(id, commentText);
      setCommentText('');
      haptics.success();
      showToast('Comment added', 'success');
      scrollToLatestComment();
    } catch (error: any) {
      console.error('Error adding comment:', error);
      haptics.error();
      showToast(error.message || 'Failed to add comment', 'error');
    } finally {
      setSubmittingComment(false);
    }
  };

  if (!id) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>Post not found</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: lightBrown }]}
          onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.card,
            paddingTop: insets.top + 12,
            borderBottomColor: colors.border,
          },
        ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <IconSymbol name="arrow.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Comments</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={{ flex: 1, paddingBottom: insets.bottom + 88 }}>
        {commentsLoading && orderedComments.length === 0 ? (
           <CommentsSkeleton count={7} colors={colors} />
        ) : (
          <FlashList
            ref={commentsListRef}
            data={orderedComments}
            keyExtractor={(item) => item.id || Math.random().toString()}
            renderItem={({ item }) => <CommentItem comment={item} />}
            estimatedItemSize={85}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.commentsListContent}
            ListEmptyComponent={
              <View style={styles.emptyComments}>
                <IconSymbol name="message" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No comments yet. Be the first to comment!
                </Text>
              </View>
            }
          />
        )}
      </View>

      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
          },
        ]}>
        <View
          style={[
            styles.inputWrapper,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: colors.border,
            },
          ]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder={user ? 'Add a comment...' : 'Login to comment'}
            placeholderTextColor={colors.textSecondary}
            value={commentText}
            onChangeText={setCommentText}
            onFocus={scrollToLatestComment}
            editable={!!user}
            multiline
            maxLength={500}
          />
          <AnimatedPressable
            style={[
              styles.sendButton,
              {
                backgroundColor: commentText.trim() && user ? lightBrown : colors.border,
                opacity: commentText.trim() && user ? 1 : 0.72,
              },
            ]}
            onPress={handleComment}
            disabled={!commentText.trim() || !user || submittingComment}
            scaleValue={0.9}>
            {submittingComment ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconSymbol name="paperplane.fill" size={18} color="#FFFFFF" />
            )}
          </AnimatedPressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  commentsListContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  emptyComments: {
    minHeight: 220,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginTop: 40,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  inputContainer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 110,
    paddingVertical: 10,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 16,
    marginBottom: 20,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
