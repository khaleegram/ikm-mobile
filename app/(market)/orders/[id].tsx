import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { cloudFunctions } from '@/lib/api/cloud-functions';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useOrder } from '@/lib/firebase/firestore/orders';
import { useTheme } from '@/lib/theme/theme-context';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { haptics } from '@/lib/utils/haptics';
import { Order } from '@/types';

const lightBrown = '#A67C52';

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate();
  return null;
}

function formatAmount(value: number): string {
  return `NGN ${value.toLocaleString()}`;
}

function getStatusColor(status?: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed' || normalized === 'received') return '#10B981';
  if (normalized === 'sent') return '#0EA5E9';
  if (normalized === 'processing') return '#F59E0B';
  if (normalized === 'disputed') return '#EF4444';
  if (normalized === 'cancelled') return '#9CA3AF';
  return lightBrown;
}

function resolveAutoReleaseDate(order: Order | null): Date | null {
  if (!order) return null;
  const fromOrder = toDate(order.autoReleaseDate);
  if (fromOrder) return fromOrder;

  const sentAt = toDate(order.sentAt);
  if (!sentAt) return null;
  const hours48 = 48 * 60 * 60 * 1000;
  return new Date(sentAt.getTime() + hours48);
}

export default function MarketOrderDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { order, loading } = useOrder(typeof id === 'string' ? id : null);

  const [updating, setUpdating] = useState(false);

  const isSeller = Boolean(order && user && order.sellerId === user.uid);
  const isBuyer = Boolean(order && user && order.customerId === user.uid);
  const canAccess = Boolean(user?.isAdmin || isSeller || isBuyer);
  const statusColor = getStatusColor(order?.status);
  const autoReleaseDate = useMemo(() => resolveAutoReleaseDate(order), [order]);

  const itemSummary = useMemo(() => {
    if (!order?.items?.length) return 'Market Street item';
    if (order.items.length === 1) return order.items[0].name;
    return `${order.items[0].name} +${order.items.length - 1} more`;
  }, [order?.items]);
  const paymentReference = String(order?.paymentReference || order?.paystackReference || '').trim();

  const pickProofImage = async (): Promise<string | undefined> => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast('Photo permission is required to attach proof.', 'error');
      return undefined;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]?.uri) {
      return undefined;
    }

    return convertImageToBase64(result.assets[0].uri);
  };

  const handleMarkSent = async (photoUrl?: string) => {
    if (!order?.id) return;
    try {
      setUpdating(true);
      haptics.medium();
      await cloudFunctions.markOrderAsSent({
        orderId: order.id,
        photoUrl,
      });
      haptics.success();
      showToast('Order marked as sent.', 'success');
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to mark order as sent.', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const askMarkSent = () => {
    Alert.alert(
      'Mark as Sent',
      'Attach optional packaging proof photo before marking sent?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send without proof',
          onPress: () => {
            void handleMarkSent();
          },
        },
        {
          text: 'Attach proof',
          onPress: async () => {
            const image = await pickProofImage();
            await handleMarkSent(image);
          },
        },
      ]
    );
  };

  const handleMarkReceived = async () => {
    if (!order?.id) return;
    try {
      setUpdating(true);
      haptics.medium();
      await cloudFunctions.markOrderAsReceived({ orderId: order.id });
      haptics.success();
      showToast('Order marked as received.', 'success');
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to mark as received.', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateStatus = async (status: 'Cancelled' | 'Disputed') => {
    if (!order?.id) return;

    try {
      setUpdating(true);
      haptics.medium();
      await cloudFunctions.updateOrderStatus({
        orderId: order.id,
        status,
      });
      haptics.success();
      showToast(`Order ${status.toLowerCase()}.`, 'success');
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to update order status.', 'error');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  if (!order || !user || !canAccess) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <IconSymbol name="exclamationmark.triangle.fill" size={42} color={colors.error} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Order unavailable</Text>
        <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
          You do not have permission to access this order.
        </Text>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: lightBrown }]}
          onPress={() => router.replace('/(market)/orders' as any)}>
          <Text style={styles.primaryButtonText}>Back to Orders</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const orderCreated = toDate(order.createdAt);
  const sentAt = toDate(order.sentAt);
  const receivedAt = toDate(order.receivedAt);
  const fundsReleasedAt = toDate(order.fundsReleasedAt);
  const escrowState = order.escrowStatus || 'held';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            borderBottomColor: colors.border,
          },
        ]}>
        <TouchableOpacity style={styles.headerIcon} onPress={() => router.back()}>
          <IconSymbol name="arrow.left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerMiddle}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Order Detail</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            #{order.id?.slice(0, 8).toUpperCase()}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: `${statusColor}20` }]}>
          <Text style={[styles.statusPillText, { color: statusColor }]}>{order.status}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom + 120,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Summary</Text>
          <Text style={[styles.summaryMain, { color: colors.text }]}>{itemSummary}</Text>
          <Text style={[styles.summarySub, { color: colors.textSecondary }]}>
            {isBuyer ? 'You are buying this item.' : 'You are selling this item.'}
          </Text>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Total</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              {formatAmount(Number(order.total || 0))}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Created</Text>
            <Text style={[styles.summaryMeta, { color: colors.text }]}>
              {orderCreated ? orderCreated.toLocaleString() : 'N/A'}
            </Text>
          </View>
          {paymentReference ? (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Receipt Ref</Text>
              <Text style={[styles.summaryMeta, { color: colors.text }]}>{paymentReference}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Escrow</Text>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>State</Text>
            <Text
              style={[
                styles.summaryMeta,
                {
                  color:
                    escrowState === 'released'
                      ? '#10B981'
                      : escrowState === 'refunded'
                        ? '#EF4444'
                        : '#F59E0B',
                },
              ]}>
              {escrowState.toUpperCase()}
            </Text>
          </View>
          {autoReleaseDate && escrowState === 'held' && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Auto release</Text>
              <Text style={[styles.summaryMeta, { color: colors.text }]}>
                {autoReleaseDate.toLocaleString()}
              </Text>
            </View>
          )}
          {fundsReleasedAt && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Released at</Text>
              <Text style={[styles.summaryMeta, { color: colors.text }]}>
                {fundsReleasedAt.toLocaleString()}
              </Text>
            </View>
          )}
          {sentAt && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Sent at</Text>
              <Text style={[styles.summaryMeta, { color: colors.text }]}>{sentAt.toLocaleString()}</Text>
            </View>
          )}
          {receivedAt && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Received at</Text>
              <Text style={[styles.summaryMeta, { color: colors.text }]}>{receivedAt.toLocaleString()}</Text>
            </View>
          )}
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Funds are held in escrow and are expected to auto-release 48 hours after the order is
            marked sent, unless disputed.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Delivery / Meet-up</Text>
          <Text style={[styles.summaryMeta, { color: colors.text }]}>{order.deliveryAddress}</Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Buyer and seller coordinate delivery directly in chat.
          </Text>
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomDock,
          {
            paddingBottom: insets.bottom + 10,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}>
        {isSeller && order.status === 'Processing' && (
          <>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: lightBrown, opacity: updating ? 0.6 : 1 }]}
              disabled={updating}
              onPress={askMarkSent}>
              {updating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.actionBtnText}>Mark Sent</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnOutline, { borderColor: colors.border }]}
              disabled={updating}
              onPress={() => {
                Alert.alert('Cancel this order?', 'This action cannot be undone.', [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Cancel Order',
                    style: 'destructive',
                    onPress: () => {
                      void handleUpdateStatus('Cancelled');
                    },
                  },
                ]);
              }}>
              <Text style={[styles.actionBtnOutlineText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        {isBuyer && order.status === 'Processing' && (
          <TouchableOpacity
            style={[styles.actionBtnOutline, { borderColor: colors.border }]}
            disabled={updating}
            onPress={() => {
              Alert.alert('Cancel purchase?', 'Cancel this order before seller dispatches.', [
                { text: 'Keep', style: 'cancel' },
                {
                  text: 'Cancel Purchase',
                  style: 'destructive',
                  onPress: () => {
                    void handleUpdateStatus('Cancelled');
                  },
                },
              ]);
            }}>
            <Text style={[styles.actionBtnOutlineText, { color: colors.text }]}>Cancel Purchase</Text>
          </TouchableOpacity>
        )}

        {isBuyer && order.status === 'Sent' && (
          <>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#10B981', opacity: updating ? 0.6 : 1 }]}
              disabled={updating}
              onPress={() => {
                void handleMarkReceived();
              }}>
              {updating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.actionBtnText}>Mark Received</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnOutline, { borderColor: '#EF4444' }]}
              disabled={updating}
              onPress={() => {
                Alert.alert('Open dispute?', 'Open a dispute if the item has issues or was not received.', [
                  { text: 'Back', style: 'cancel' },
                  {
                    text: 'Open Dispute',
                    style: 'destructive',
                    onPress: () => {
                      void handleUpdateStatus('Disputed');
                    },
                  },
                ]);
              }}>
              <Text style={[styles.actionBtnOutlineText, { color: '#EF4444' }]}>Dispute</Text>
            </TouchableOpacity>
          </>
        )}

        {isSeller && order.status === 'Sent' && (
          <View style={styles.infoDockRow}>
            <IconSymbol name="clock.fill" size={16} color={colors.textSecondary} />
            <Text style={[styles.infoDockText, { color: colors.textSecondary }]}>
              Waiting for buyer confirmation or auto-release window.
            </Text>
          </View>
        )}

        {isSeller && (
          <TouchableOpacity
            style={[styles.payoutShortcut, { borderColor: colors.border }]}
            onPress={() => {
              haptics.light();
              router.push('/(market)/payouts' as any);
            }}>
            <IconSymbol name="dollarsign.circle.fill" size={16} color={lightBrown} />
            <Text style={[styles.payoutShortcutText, { color: lightBrown }]}>Payout Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  header: {
    borderBottomWidth: 1,
    paddingBottom: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMiddle: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  summaryMain: {
    fontSize: 16,
    fontWeight: '800',
  },
  summarySub: {
    fontSize: 12,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  summaryMeta: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  helperText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  bottomDock: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  actionBtn: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  actionBtnOutline: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnOutlineText: {
    fontSize: 14,
    fontWeight: '700',
  },
  infoDockRow: {
    minHeight: 40,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoDockText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  payoutShortcut: {
    marginTop: 2,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  payoutShortcutText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
