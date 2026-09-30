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
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import KeyboardScreen from '@/components/layout/KeyboardScreen';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { disputesApi, type DisputeCategory } from '@/lib/api/disputes';
import { useTheme } from '@/lib/theme/theme-context';
import { useUser } from '@/lib/firebase/auth/use-user';
import { haptics } from '@/lib/utils/haptics';
import { buildUserMediaPath } from '@/lib/utils/media-path';
import { uploadImage } from '@/lib/utils/image-upload';

const ACCENT = '#A67C52';

const CATEGORIES: { id: DisputeCategory; label: string }[] = [
  { id: 'not_received', label: 'Never arrived' },
  { id: 'wrong_item', label: 'Wrong item' },
  { id: 'damaged', label: 'Damaged' },
  { id: 'fake_or_not_as_described', label: 'Not as described' },
  { id: 'other', label: 'Something else' },
];

type DisputeCaseSheetProps = {
  visible: boolean;
  orderId: string | null;
  onClose: () => void;
  onOpened: () => void;
};

export function DisputeCaseSheet({ visible, orderId, onClose, onOpened }: DisputeCaseSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const [category, setCategory] = useState<DisputeCategory | null>(null);
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addPhoto = async () => {
    if (photos.length >= 4) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast('Photo access is needed for evidence.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0] || !user?.uid) return;
    try {
      setBusy(true);
      const uploaded = await uploadImage(
        result.assets[0].uri,
        buildUserMediaPath('orderProof', user.uid, `${Date.now()}_dispute.jpg`)
      );
      setPhotos((prev) => [...prev, uploaded.url]);
    } catch (error: any) {
      showToast(error?.message || 'Could not upload photo.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const id = String(orderId || '').trim();
    if (!id || busy) return;
    if (!category) {
      showToast('Pick what went wrong.', 'error');
      return;
    }
    if (reason.trim().length < 12) {
      showToast('Write a short description of the problem.', 'error');
      return;
    }
    try {
      setBusy(true);
      await disputesApi.open({
        orderId: id,
        category,
        reason: reason.trim(),
        evidenceUrls: photos,
      });
      haptics.success();
      showToast('Dispute opened. Money stays held until support decides.', 'success');
      setCategory(null);
      setReason('');
      setPhotos([]);
      onOpened();
      onClose();
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Could not open dispute.', 'error');
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
            <IconSymbol name="xmark" size={18} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Open a dispute</Text>
          <View style={styles.headerBtn} />
        </View>

        <KeyboardScreen contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} extraScrollHeight={48}>
          <Text style={[styles.lead, { color: colors.textSecondary }]}>
            The money stays held and the seller is not paid. Support reviews the photos and this chat, then refunds you or releases it to the seller.
          </Text>

          {CATEGORIES.map((item) => {
            const active = category === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.choice,
                  {
                    borderColor: active ? ACCENT : colors.border,
                    backgroundColor: active ? `${ACCENT}18` : colors.card,
                  },
                ]}
                onPress={() => setCategory(item.id)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}

          <Text style={[styles.label, { color: colors.text }]}>What happened</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Be specific. What did you order, what arrived (or didn’t), and when."
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[
              styles.area,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
            ]}
          />

          <Text style={[styles.label, { color: colors.text }]}>Evidence (optional)</Text>
          <View style={styles.photoRow}>
            {photos.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.thumb} contentFit="cover" />
            ))}
            {photos.length < 4 ? (
              <TouchableOpacity
                style={[styles.addPhoto, { borderColor: colors.border }]}
                onPress={() => void addPhoto()}
                disabled={busy}>
                <IconSymbol name="camera.fill" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.cta, { backgroundColor: '#B91C1C', opacity: busy ? 0.7 : 1 }]}
            disabled={busy}
            onPress={() => void submit()}>
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.ctaText}>Hold the money and open a dispute</Text>
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
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  lead: { fontSize: 13, fontWeight: '600', lineHeight: 18, marginBottom: 16 },
  choice: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  label: { fontSize: 14, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  area: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontWeight: '600',
    textAlignVertical: 'top',
  },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  addPhoto: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cta: { marginTop: 20, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});
