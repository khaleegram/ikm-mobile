import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';

const lightBrown = '#A67C52';

interface PostManageSheetProps {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
  deleting?: boolean;
}

export function PostManageSheet({
  visible,
  onClose,
  onEdit,
  onShare,
  onDelete,
  deleting = false,
}: PostManageSheetProps) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.text }]}>Manage Post</Text>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={onEdit}
            disabled={deleting}>
            <View style={styles.actionLeft}>
              <IconSymbol name="pencil" size={18} color={lightBrown} />
              <Text style={[styles.actionText, { color: colors.text }]}>Edit Post</Text>
            </View>
            <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={onShare}
            disabled={deleting}>
            <View style={styles.actionLeft}>
              <IconSymbol name="square.and.arrow.up" size={18} color={lightBrown} />
              <Text style={[styles.actionText, { color: colors.text }]}>Share Post</Text>
            </View>
            <IconSymbol name="chevron.right" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={onDelete}
            disabled={deleting}>
            <View style={styles.actionLeft}>
              {deleting ? (
                <ActivityIndicator size="small" color="#E45656" />
              ) : (
                <IconSymbol name="trash.fill" size={18} color="#E45656" />
              )}
              <Text style={[styles.actionText, { color: '#E45656' }]}>Delete Post</Text>
            </View>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 26,
  },
  handle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  actionRow: {
    minHeight: 54,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
