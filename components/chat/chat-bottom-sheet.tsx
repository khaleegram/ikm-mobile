import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PostgresChatDetail } from '@/app/(market)/messages/_chat-detail/postgres-chat-detail';
import { useTheme } from '@/lib/theme/theme-context';

type ChatBottomSheetProps = {
  visible: boolean;
  threadId: string | null;
  peerId: string | null;
  onClose: () => void;
};

export function ChatBottomSheet({ visible, threadId, peerId, onClose }: ChatBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(900)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : 900,
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
    }).start();
  }, [visible, translateY]);

  if (!threadId) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom,
              backgroundColor: colors.background,
              transform: [{ translateY }],
            },
          ]}>
          <View style={styles.handle} />
          <PostgresChatDetail
            embedded
            embeddedThreadId={threadId}
            embeddedPeerId={peerId}
            onClose={onClose}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    height: '88%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    marginTop: 8,
    marginBottom: 4,
  },
});
