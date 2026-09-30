import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { reviewsApi } from '@/lib/api/reviews';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';

type ReviewSheetProps = {
  visible: boolean;
  orderId: string | null;
  sellerName?: string;
  onClose: () => void;
  onSubmitted?: () => void;
};

export function ReviewSheet({
  visible,
  orderId,
  sellerName,
  onClose,
  onSubmitted,
}: ReviewSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const id = String(orderId || '').trim();
    if (!id || busy) return;
    if (rating < 1) {
      showToast('Tap a star first.', 'error');
      return;
    }
    try {
      setBusy(true);
      await reviewsApi.submit({ orderId: id, rating, text: text.trim() || undefined });
      haptics.success();
      showToast('Thanks — review posted.', 'success');
      setRating(0);
      setText('');
      onSubmitted?.();
      onClose();
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Could not save review.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={12}>
            <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Skip</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Rate the seller</Text>
          <View style={{ width: 52 }} />
        </View>

        <KeyboardScreen contentContainerStyle={{ padding: 16 }} extraScrollHeight={40}>
          <Text style={[styles.lead, { color: colors.textSecondary }]}>
            Optional. Helps the next buyer know if {sellerName || 'this seller'} is trustworthy.
          </Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => setRating(n)} hitSlop={8}>
                <IconSymbol
                  name={n <= rating ? 'star.fill' : 'star'}
                  size={32}
                  color={n <= rating ? '#F59E0B' : colors.border}
                />
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="How did delivery and the item go?"
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[
              styles.area,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
            ]}
          />
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: '#A67C52', opacity: busy ? 0.7 : 1 }]}
            disabled={busy}
            onPress={() => void submit()}>
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.ctaText}>Post review</Text>
            )}
          </TouchableOpacity>
        </KeyboardScreen>
      </View>
    </Modal>
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
  headerBtn: { width: 52, height: 40, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  lead: { fontSize: 13, fontWeight: '600', lineHeight: 18, marginBottom: 16 },
  stars: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  area: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontWeight: '600',
    textAlignVertical: 'top',
  },
  cta: { marginTop: 20, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});
