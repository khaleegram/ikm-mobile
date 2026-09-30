import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { adminApi } from '@/lib/api/admin';
import { useAllOrders } from '@/lib/firebase/firestore/admin';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { Alert } from '@/components/app-alert';

export default function AdminDisputesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { orders, loading } = useAllOrders();
  const [busyId, setBusyId] = useState<string | null>(null);

  const disputed = useMemo(
    () => orders.filter((o) => o.status === 'Disputed'),
    [orders]
  );

  const resolve = (orderId: string, resolution: 'refund' | 'release') => {
    Alert.alert(
      resolution === 'refund' ? 'Refund buyer?' : 'Release to seller?',
      resolution === 'refund'
        ? 'Paystack refund to the original payment. Seller is not paid.'
        : 'Escrow goes to the seller. Buyer is not refunded.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: resolution === 'refund' ? 'Refund' : 'Release',
          style: resolution === 'refund' ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              try {
                setBusyId(orderId);
                await adminApi.resolveDispute({ orderId, resolution });
                haptics.success();
                showToast(
                  resolution === 'refund' ? 'Refund started.' : 'Released to seller.',
                  'success'
                );
              } catch (error: any) {
                haptics.error();
                showToast(error?.message || 'Could not resolve dispute.', 'error');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <IconSymbol name="arrow.left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Dispute cases</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#A67C52" />
      ) : (
        <FlatList
          data={disputed}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
          ListEmptyComponent={
            <Text style={{ color: colors.textSecondary, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
              No open disputes.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.orderId, { color: colors.text }]}>
                #{String(item.id).slice(0, 10).toUpperCase()}
              </Text>
              <Text style={{ color: colors.textSecondary, fontWeight: '600', marginTop: 4 }}>
                {String((item as any).disputeCategory || 'case').replace(/_/g, ' ')}
              </Text>
              {item.disputeReason ? (
                <Text style={{ color: colors.text, marginTop: 8, fontWeight: '600' }}>
                  {item.disputeReason}
                </Text>
              ) : null}
              <Text style={{ color: colors.textSecondary, marginTop: 8, fontWeight: '700' }}>
                NGN {Number(item.total || 0).toLocaleString()} held
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#B91C1C', opacity: busyId === item.id ? 0.6 : 1 }]}
                  disabled={busyId === item.id}
                  onPress={() => resolve(String(item.id), 'refund')}>
                  <Text style={styles.btnText}>Refund buyer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#A67C52', opacity: busyId === item.id ? 0.6 : 1 }]}
                  disabled={busyId === item.id}
                  onPress={() => resolve(String(item.id), 'release')}>
                  <Text style={styles.btnText}>Pay seller</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  orderId: { fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: '800' },
});
