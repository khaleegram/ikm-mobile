import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { CommentItem } from '@/components/market/comment-item';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { useUser } from '@/lib/firebase/auth/use-user';
import {
  createMarketCommentOptimistic,
  useMarketPostComments,
} from '@/lib/hooks/use-market-comments';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { haptics } from '@/lib/utils/haptics';
import type { MarketComment } from '@/types';
import { Alert } from '@/components/app-alert';

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
  const { user: profile } = useUserProfile(user?.uid ?? null);
  const { comments, loading, hasMore, loadingMore, loadMore } = useMarketPostComments(
    visible ? postId : null
  );
  const [commentText, setCommentText] = useState('');
  const listRef = useRef<FlashList<MarketComment>>(null);
  const translateY = useRef(new Animated.Value(700)).current;
  const keyboardLift = useRef(new Animated.Value(0)).current;
  const marketLoginRoute = getLoginRouteForVariant('market');

  const avatarUri = useMemo(
    () => String(profile?.storeLogoUrl || '').trim() || null,
    [profile?.storeLogoUrl]
  );

  // API returns newest-first; reverse for chronological chat-style list.
  const orderedComments = useMemo(() => [...comments].reverse(), [comments]);

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : 700,
      duration: visible ? 220 : 180,
      useNativeDriver: true,
    }).start();
    if (!visible) setCommentText('');
  }, [visible, translateY]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      Animated.timing(keyboardLift, {
        toValue: -e.endCoordinates.height,
        duration: Platform.OS === 'ios' ? e.duration || 220 : 160,
        useNativeDriver: true,
      }).start();
    });

    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(keyboardLift, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? e.duration || 180 : 140,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardLift]);

  useEffect(() => {
    if (visible && orderedComments.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }
  }, [visible, orderedComments.length]);

  const handleSend = useCallback(async () => {
    if (!postId) return;
    if (!user) {
      Alert.alert('Login Required', 'Please log in to comment', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => { onClose(); router.push(marketLoginRoute as any); } },
      ]);
      return;
    }
    const text = commentText.trim();
    if (!text) return;

    setCommentText('');
    haptics.light();
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    try {
      await createMarketCommentOptimistic(postId, text);
      haptics.success();
    } catch (e: any) {
      haptics.error();
      showToast(e?.message || 'Failed to add comment', 'error');
    }
  }, [postId, user, commentText, onClose, marketLoginRoute]);

  if (!postId) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>

      <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); onClose(); }}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheetWrapper,
          { transform: [{ translateY: Animated.add(translateY, keyboardLift) }] },
        ]}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) + 4 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {(totalComments ?? orderedComments.length) > 0
                ? `${Math.max(totalComments ?? 0, orderedComments.length)} Comments`
                : 'Comments'}
            </Text>
            <TouchableOpacity
              onPress={() => { Keyboard.dismiss(); onClose(); }}
              style={styles.closeBtn}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
              <IconSymbol name="xmark" size={16} color="rgba(255,255,255,0.55)" />
            </TouchableOpacity>
          </View>

          <View style={styles.list}>
            {loading && orderedComments.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={lightBrown} size="small" />
              </View>
            ) : (
              <FlashList
                ref={listRef}
                data={orderedComments}
                keyExtractor={(item) => item.id ?? `${item.userId}-${item.createdAt.getTime()}`}
                renderItem={({ item }) => (
                  <CommentItem
                    comment={item}
                    darkMode
                    pending={String(item.id || '').startsWith('temp_')}
                  />
                )}
                ListHeaderComponent={
                  hasMore ? (
                    <TouchableOpacity
                      style={{ paddingVertical: 12, alignItems: 'center' }}
                      onPress={() => {
                        if (!loadingMore) void loadMore();
                      }}
                      disabled={loadingMore}>
                      {loadingMore ? (
                        <ActivityIndicator color={lightBrown} size="small" />
                      ) : (
                        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '600' }}>
                          Load earlier comments
                        </Text>
                      )}
                    </TouchableOpacity>
                  ) : null
                }
                estimatedItemSize={56}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="none"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 6 }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptyHint}>Start the conversation</Text>
                  </View>
                }
              />
            )}
          </View>

          <View style={styles.inputRow}>
            <View style={styles.inputAvatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.inputAvatarImg} contentFit="cover" />
              ) : (
                <IconSymbol name="person.fill" size={12} color="rgba(255,255,255,0.5)" />
              )}
            </View>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder={user ? 'Add a comment...' : 'Log in to comment'}
                placeholderTextColor="rgba(255,255,255,0.35)"
                value={commentText}
                onChangeText={setCommentText}
                editable={!!user}
                multiline
                maxLength={500}
                returnKeyType="send"
                blurOnSubmit
                onSubmitEditing={handleSend}
              />
            </View>
            <TouchableOpacity
              style={[styles.sendBtn, { opacity: commentText.trim() && user ? 1 : 0.35 }]}
              onPress={handleSend}
              disabled={!commentText.trim() || !user}
              activeOpacity={0.7}>
              <IconSymbol name="paperplane.fill" size={16} color="#FFF" />
            </TouchableOpacity>
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: 560,
    minHeight: 300,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  closeBtn: { position: 'absolute', right: 14, top: 10, padding: 4 },
  list: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 4 },
  emptyTitle: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  emptyHint: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  inputAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 4,
  },
  inputAvatarImg: {
    width: '100%',
    height: '100%',
  },
  inputWrap: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    maxHeight: 88,
  },
  input: { color: '#FFF', fontSize: 13, lineHeight: 18 },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: lightBrown,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
