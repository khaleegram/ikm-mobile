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
import { OrderProgress } from '@/components/orders/order-progress';
import { DealActionsSheet } from '@/components/chat/deal-room/deal-actions-sheet';
import { DisputeCaseSheet } from '@/components/chat/deal-room/dispute-case-sheet';
import { ReviewSheet } from '@/components/chat/deal-room/review-sheet';
import { orderApi } from '@/lib/api/orders';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useInvalidateOrder, useOrder } from '@/lib/hooks/use-order';
import { useTheme } from '@/lib/theme/theme-context';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { haptics } from '@/lib/utils/haptics';
import {
  TONE_COLORS,
  deriveOrderView,
  formatMoney,
  formatWhen,
  type OrderRole,
} from '@/lib/orders/order-view';

const ACCENT = '#A67C52';

export default function MarketOrderDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = typeof id === 'string' ? id : null;
  const { order, timeline: events, loading: orderLoading } = useOrder(orderId);
  const invalidateOrder = useInvalidateOrder();

  const [updating, setUpdating] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const isSeller = Boolean(order && user && order.sellerId === user.uid);
  const isBuyer = Boolean(order && user && order.customerId === user.uid);
  const canAccess = Boolean(user?.isAdmin || isSeller || isBuyer);

  const dealThreadId = String(
    (order as any)?.dealThreadId || (order as any)?.chatThreadId || ''
  ).trim();
  const peerId = useMemo(() => {
    if (!user?.uid || !order) return '';
    return order.sellerId === user.uid
      ? String(order.customerId || '')
      : String(order.sellerId || '');
  }, [user?.uid, order]);

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
    if (result.canceled || !result.assets?.[0]?.uri) return undefined;
    return convertImageToBase64(result.assets[0].uri);
  };

  /** Runs an API call with one consistent busy state, success toast, and error handling. */
  const runAction = async (label: string, fn: () => Promise<unknown>, success: string) => {
    if (!order?.id) return;
    try {
      setUpdating(true);
      haptics.medium();
      await fn();
      haptics.success();
      showToast(success, 'success');
      await invalidateOrder(order.id);
      return true;
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || `Unable to ${label}.`, 'error');
      return false;
    } finally {
      setUpdating(false);
    }
  };

  const handleMarkSent = async (photoUrl?: string) => {
    await runAction('send this order', () => orderApi.markAsSent(order!.id!, photoUrl), 'Marked as sent — the buyer can see it now.');
  };

  const handleMarkReceived = async () => {
    const ok = await runAction('confirm this order', () => orderApi.markAsReceived(order!.id!), 'Received — thanks!');
    if (ok) setReviewOpen(true);
  };

  const handleAcceptOrder = async () => {
    await runAction('accept this order', () => orderApi.updateStatus(order!.id!, 'Accepted'), 'Order accepted.');
  };

  const confirmCancel = () => {
    Alert.alert(
      'Cancel this order?',
      order?.escrowStatus === 'held'
        ? 'Your money goes back to the payment method you used.'
        : 'This cannot be undone.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Cancel & refund',
          style: 'destructive',
          onPress: () => {
            void runAction(
              'cancel this order',
              () => orderApi.updateStatus(order!.id!, 'Cancelled'),
              'Order cancelled. The refund is on its way.'
            );
          },
        },
      ]
    );
  };

  const askMarkSent = () => {
    Alert.alert("I've sent it", 'Add a photo of the parcel? Buyers like seeing it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send without photo', onPress: () => void handleMarkSent() },
      {
        text: 'Add photo',
        onPress: async () => {
          const image = await pickProofImage();
          await handleMarkSent(image);
        },
      },
    ]);
  };

  const role: OrderRole = isSeller ? 'seller' : 'buyer';

  /**
   * The entire page state, worked out once. Nothing below this line branches on status.
   */
  const view = useMemo(() => {
    if (!order) return null;
    return deriveOrderView({
      order,
      role,
      events,
      handlers: {
        accept: () => void handleAcceptOrder(),
        markSent: () => askMarkSent(),
        markReceived: () => void handleMarkReceived(),
        cancel: confirmCancel,
        dispute: () => setDisputeOpen(true),
        review: () => setReviewOpen(true),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, role, events]);

  if (orderLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  if (!order || !user || !canAccess || !view) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <IconSymbol name="exclamationmark.triangle.fill" size={42} color={colors.error} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Order unavailable</Text>
        <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
          You do not have permission to access this order.
        </Text>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: ACCENT }]}
          onPress={() => router.replace('/(market)/orders' as any)}>
          <Text style={styles.primaryButtonText}>Back to Orders</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const toneColor = TONE_COLORS[view.tone];
  const fullAddress = String(order.deliveryAddress || '').trim();
  const openChat = () => {
    haptics.light();
    const qs = peerId ? `?peerId=${encodeURIComponent(peerId)}` : '';
    if (dealThreadId) router.push(`/(market)/messages/${dealThreadId}${qs}` as any);
    else if (peerId) router.push(`/(market)/messages/peer/${peerId}` as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — back and the order number. Nothing else competes with the status below. */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.headerIcon} onPress={() => router.back()} hitSlop={8}>
          <IconSymbol name="arrow.left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerOrder, { color: colors.textSecondary }]} numberOfLines={1}>
          Order #{order.id?.slice(0, 8).toUpperCase()}
        </Text>
        <View style={styles.headerIcon} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}>
        {/* Where is my order — the one thing that matters, at the top. */}
        <View style={styles.heroWrap}>
          <View style={[styles.heroDot, { backgroundColor: `${toneColor}22` }]}>
            <View style={[styles.heroDotInner, { backgroundColor: toneColor }]} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.text }]}>{view.headline}</Text>
          <Text style={[styles.heroDetail, { color: colors.textSecondary }]}>{view.detail}</Text>
        </View>

        {/* Money — stated once. It used to appear in three separate places. */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.escrowTop}>
            <View style={[styles.escrowBadge, { backgroundColor: `${TONE_COLORS[view.escrow.tone]}1A` }]}>
              <IconSymbol name="lock.fill" size={12} color={TONE_COLORS[view.escrow.tone]} />
              <Text style={[styles.escrowBadgeText, { color: TONE_COLORS[view.escrow.tone] }]}>
                {view.escrow.label}
              </Text>
            </View>
            <Text style={[styles.escrowAmount, { color: colors.text }]}>{view.escrow.amount}</Text>
          </View>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{view.escrow.detail}</Text>
        </View>

        {/* Progress — four steps in one line. */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <OrderProgress steps={view.steps} colors={colors} toneColor={toneColor} />
        </View>

        {/* What was bought. */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textSecondary }]}>Your order</Text>
          {order.items?.map((item, index) => (
            <View key={`${item.productId}-${index}`} style={styles.itemRow}>
              <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[styles.itemQty, { color: colors.textSecondary }]}>{item.quantity}×</Text>
              <Text style={[styles.itemPrice, { color: colors.text }]}>
                {formatMoney(item.price * item.quantity)}
              </Text>
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.itemRow}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>
              {formatMoney(Number(order.total || 0))}
            </Text>
          </View>
        </View>

        {/* Delivery. */}
        {fullAddress ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.textSecondary }]}>Delivering to</Text>
            <Text style={[styles.body, { color: colors.text }]}>{fullAddress}</Text>
          </View>
        ) : null}

        {/* Chat — one quiet row, not a banner in the middle of the page. */}
        {(dealThreadId || peerId) ? (
          <TouchableOpacity
            style={[styles.rowLink, { borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={openChat}>
            <IconSymbol name="bubble.left.and.bubble.right.fill" size={16} color={ACCENT} />
            <Text style={[styles.rowLinkText, { color: colors.text }]}>
              {isSeller ? 'Message the buyer' : 'Message the seller'}
            </Text>
            <IconSymbol name="chevron.right" size={13} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}

        {/* Full history — there if wanted, folded away by default. */}
        {view.history.length ? (
          <>
            <TouchableOpacity
              style={styles.historyToggle}
              activeOpacity={0.7}
              onPress={() => setHistoryOpen((open) => !open)}>
              <Text style={[styles.historyToggleText, { color: colors.textSecondary }]}>
                {historyOpen ? 'Hide history' : `History (${view.history.length})`}
              </Text>
              <IconSymbol
                name={historyOpen ? 'chevron.up' : 'chevron.down'}
                size={12}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            {historyOpen ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {view.history.map((entry, index) => (
                  <View key={`${entry.label}-${index}`} style={styles.historyRow}>
                    <Text style={[styles.historyLabel, { color: colors.text }]}>{entry.label}</Text>
                    <Text style={[styles.historyWhen, { color: colors.textSecondary }]}>
                      {formatWhen(entry.at) || ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {/* One action. Everything else lives behind "More". */}
      {(view.primary || view.secondary.length) ? (
        <View
          style={[
            styles.dock,
            { paddingBottom: insets.bottom + 10, borderTopColor: colors.border, backgroundColor: colors.card },
          ]}>
          <View style={styles.dockRow}>
            {view.primary ? (
              <TouchableOpacity
                style={[
                  styles.primaryAction,
                  {
                    backgroundColor:
                      view.primary.tone === 'success'
                        ? TONE_COLORS.success
                        : view.primary.tone === 'danger'
                          ? TONE_COLORS.danger
                          : ACCENT,
                    opacity: updating ? 0.6 : 1,
                  },
                ]}
                disabled={updating}
                onPress={view.primary.run}
                accessibilityRole="button">
                {updating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryActionText}>{view.primary.label}</Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.dockNote}>
                <IconSymbol name="checkmark.circle.fill" size={15} color={colors.textSecondary} />
                <Text style={[styles.dockNoteText, { color: colors.textSecondary }]}>
                  Nothing needed from you right now.
                </Text>
              </View>
            )}

            {view.secondary.length ? (
              <TouchableOpacity
                style={[styles.moreButton, { borderColor: colors.border }]}
                onPress={() => {
                  haptics.light();
                  setMoreOpen(true);
                }}
                accessibilityLabel="More actions">
                <IconSymbol name="ellipsis" size={18} color={colors.text} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      <DealActionsSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Order options"
        note={`Order #${order.id?.slice(0, 8).toUpperCase()}`}
        actions={view.secondary.map((action) => ({
          id: action.id,
          label: action.label,
          hint: action.hint,
          icon: action.icon,
          tone: action.tone,
          onPress: () => {
            setMoreOpen(false);
            action.run();
          },
        }))}
      />
      <DisputeCaseSheet
        visible={disputeOpen}
        orderId={order.id || null}
        onClose={() => setDisputeOpen(false)}
        onOpened={() => void invalidateOrder(order.id!)}
      />
      <ReviewSheet
        visible={reviewOpen}
        orderId={order.id || null}
        onClose={() => setReviewOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerOrder: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },

  // ── Status hero ────────────────────────────────────────────────────────────
  heroWrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 18, alignItems: 'center' },
  heroDot: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroDotInner: { width: 14, height: 14, borderRadius: 7 },
  heroTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  heroDetail: { marginTop: 6, fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center' },

  // ── Cards ──────────────────────────────────────────────────────────────────
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  body: { fontSize: 13, lineHeight: 19, fontWeight: '600' },

  escrowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  escrowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  escrowBadgeText: { fontSize: 11, fontWeight: '800' },
  escrowAmount: { fontSize: 20, fontWeight: '800' },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemName: { flex: 1, fontSize: 14, fontWeight: '700' },
  itemQty: { fontSize: 13, fontWeight: '700' },
  itemPrice: { fontSize: 14, fontWeight: '700', minWidth: 84, textAlign: 'right' },
  divider: { height: 1, marginVertical: 2 },
  totalLabel: { flex: 1, fontSize: 14, fontWeight: '800' },
  totalValue: { fontSize: 17, fontWeight: '800' },

  rowLink: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowLinkText: { flex: 1, fontSize: 14, fontWeight: '700' },

  historyToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  historyToggleText: { fontSize: 12, fontWeight: '700' },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  historyLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  historyWhen: { fontSize: 11, fontWeight: '600' },

  // ── Dock ───────────────────────────────────────────────────────────────────
  dock: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10 },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryAction: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  moreButton: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dockNote: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dockNoteText: { fontSize: 13, fontWeight: '600' },

  emptyTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyHint: { fontSize: 13, textAlign: 'center', fontWeight: '600' },
  primaryButton: { marginTop: 8, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
