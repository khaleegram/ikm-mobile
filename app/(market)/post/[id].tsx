import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useTheme } from '@/lib/theme/theme-context';
import { useMarketPost } from '@/lib/firebase/firestore/market-posts';
import { useMarketPostComments } from '@/lib/firebase/firestore/market-comments';
import { CommentItem } from '@/components/market/comment-item';
import { FeedCard } from '@/components/market/feed-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AnimatedPressable } from '@/components/animated-pressable';
import { marketPostsApi } from '@/lib/api/market-posts';
import { marketCommentsApi } from '@/lib/api/market-comments';
import { showToast } from '@/components/toast';
import { haptics } from '@/lib/utils/haptics';
import { SafeImage } from '@/components/safe-image';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');
const lightBrown = '#A67C52';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { post, loading: postLoading } = useMarketPost(id as string);
  const { comments, loading: commentsLoading } = useMarketPostComments(id as string);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const handleComment = async () => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to comment', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push('/(auth)/login') },
      ]);
      return;
    }

    if (!commentText.trim()) {
      return;
    }

    setSubmittingComment(true);
    haptics.medium();

    try {
      await marketCommentsApi.create(id as string, commentText);
      setCommentText('');
      haptics.success();
      showToast('Comment added', 'success');
      // Scroll to top of comments
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: height, animated: true });
      }, 100);
    } catch (error: any) {
      console.error('Error adding comment:', error);
      haptics.error();
      showToast(error.message || 'Failed to add comment', 'error');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleLike = async () => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to like posts', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push('/(auth)/login') },
      ]);
      return;
    }

    try {
      haptics.light();
      await marketPostsApi.like(id as string);
    } catch (error: any) {
      console.error('Error liking post:', error);
    }
  };

  const handleShare = () => {
    haptics.medium();
    // TODO: Implement share functionality
    showToast('Share feature coming soon', 'info');
  };

  const handleAskForPrice = () => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to message sellers', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push('/(auth)/login') },
      ]);
      return;
    }

    haptics.medium();
    router.push(`/(market)/messages/${post?.posterId}_${id}` as any);
  };

  if (postLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  if (!post) {
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}>
      {/* Header */}
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Post Details</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Post Display */}
        <View style={styles.postContainer}>
          <FeedCard post={post} />
        </View>

        {/* Comments Section */}
        <View style={[styles.commentsSection, { backgroundColor: colors.background }]}>
          <View style={[styles.commentsHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.commentsTitle, { color: colors.text }]}>
              Comments ({comments.length})
            </Text>
          </View>

          {commentsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={lightBrown} />
            </View>
          ) : comments.length === 0 ? (
            <View style={styles.emptyComments}>
              <IconSymbol name="message" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No comments yet. Be the first to comment!
              </Text>
            </View>
          ) : (
            comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))
          )}
        </View>
      </ScrollView>

      {/* Comment Input */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
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
            editable={!!user}
            multiline
            maxLength={500}
          />
          <AnimatedPressable
            style={[
              styles.sendButton,
              {
                backgroundColor: commentText.trim() && user ? lightBrown : colors.backgroundSecondary,
                opacity: commentText.trim() && user ? 1 : 0.5,
              },
            ]}
            onPress={handleComment}
            disabled={!commentText.trim() || !user || submittingComment}
            scaleValue={0.9}>
            {submittingComment ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconSymbol name="arrow.up.circle.fill" size={24} color="#FFFFFF" />
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  postContainer: {
    height: height * 0.6,
    marginBottom: 20,
  },
  commentsSection: {
    paddingHorizontal: 16,
  },
  commentsHeader: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  commentsTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyComments: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
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
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 4,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
