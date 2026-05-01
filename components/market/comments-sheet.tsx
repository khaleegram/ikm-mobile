import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { CommentItem } from '@/components/market/comment-item';
import { AnimatedPressable } from '@/components/animated-pressable';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { marketCommentsApi } from '@/lib/api/market-comments';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useMarketPostComments } from '@/lib/firebase/firestore/market-comments';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import type { MarketComment } from '@/types';

const lightBrown = '#A67C52';

interface CommentsSheetProps {
  postId: string | null;
  visible: boolean;
  onClose: () => void;
  totalComments?: number;
}

export function CommentsSheet({ postId, visible, onClose, totalComments }: CommentsSheetProps) {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { comments, loading } = useMarketPostComments(visible ? postId : null);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const listRef = useRef<FlashList<MarketComment>>(null);
  const translateY = useRef(new Animated.Value(700)).current;
  const keyboardLift = useRef(new Animated.Value(0)).current;
  const marketLoginRoute = getLoginRouteForVariant('market');

  const orderedComments = useMemo(() => [...comments].reverse(), [comments]);

  // Slide sheet in/out
  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : 700,
      useNativeDriver: true,
      tension: 68,
      friction: 12,
    }).start();
    if (!visible) setCommentText('');
  }, [visible, translateY]);

  // Keyboard listener — works reliably in Modals on both platforms
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      Animated.timing(keyboardLift, {
        toValue: -e.endCoordinates.height,
        duration: Platform.OS === 'ios' ? e.duration || 250 : 180,
        useNativeDriver: true,
      }).start();
    });

    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(keyboardLift, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? e.duration || 200 : 160,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardLift]);

  // Scroll to latest on new comment
  useEffect(() => {
    if (visible && orderedComments.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [visible, orderedComments.length]);

  const handleSend = async () => {
    if (!postId) return;
    if (!user) {
      Alert.alert('Login Required', 'Please log in to comment', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => { onClose(); router.push(marketLoginRoute as any); } },
      ]);
      return;
    }
    if (!commentText.trim()) return;
    setSubmitting(true);
    haptics.medium();
    try {
      await marketCommentsApi.create(postId, commentText.trim());
      setCommentText('');
      haptics.success();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      haptics.error();
      showToast(e?.message || 'Failed to add comment', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>

      {/* Full-screen backdrop — sits below the sheet */}
      <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); onClose(); }}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      {/* Sheet lifts with keyboard via transform, which is native-driver safe. */}
      <Animated.View
        style={[
          styles.sheetWrapper,
          { transform: [{ translateY: Animated.add(translateY, keyboardLift) }] },
        ]}>
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 8) + 4 },
          ]}>
          {/* Handle bar */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {(totalComments ?? 0) > 0 ? `${totalComments} Comments` : 'Comments'}
            </Text>
            <TouchableOpacity
              onPress={() => { Keyboard.dismiss(); onClose(); }}
              style={styles.closeBtn}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
              <IconSymbol name="xmark" size={18} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          </View>

          {/* Comment list */}
          <View style={styles.list}>
            {loading && orderedComments.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={lightBrown} />
              </View>
            ) : (
              <FlashList
                ref={listRef}
                data={orderedComments}
                keyExtractor={(item) => item.id ?? Math.random().toString()}
                renderItem={({ item }) => <CommentItem comment={item} darkMode />}
                estimatedItemSize={80}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="none"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyEmoji}>💬</Text>
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptyHint}>Be the first to comment!</Text>
                  </View>
                }
              />
            )}
          </View>

          {/* Input row */}
          <View style={styles.inputRow}>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder={user ? 'Add a comment...' : 'Log in to comment'}
                placeholderTextColor="rgba(255,255,255,0.38)"
                value={commentText}
                onChangeText={setCommentText}
                editable={!!user && !submitting}
                multiline
                maxLength={500}
                returnKeyType="send"
                blurOnSubmit
                onSubmitEditing={handleSend}
              />
            </View>
            <AnimatedPressable
              style={[styles.sendBtn, { opacity: commentText.trim() && user ? 1 : 0.35 }]}
              onPress={handleSend}
              disabled={!commentText.trim() || !user || submitting}
              scaleValue={0.88}>
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <IconSymbol name="paperplane.fill" size={20} color="#FFF" />
              )}
            </AnimatedPressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheet: {
    backgroundColor: '#181818',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: 580,
    minHeight: 320,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: { position: 'absolute', right: 16, top: 14, padding: 4 },
  list: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyEmoji: { fontSize: 42 },
  emptyTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  emptyHint: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  inputWrap: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
    maxHeight: 100,
  },
  input: { color: '#FFF', fontSize: 15 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: lightBrown,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
