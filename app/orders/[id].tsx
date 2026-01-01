import { SafeImage } from '@/components/safe-image';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { adminApi } from '@/lib/api/admin';
import { cloudFunctions } from '@/lib/api/cloud-functions';
import { orderChatApi } from '@/lib/api/order-chat';
import { orderApi } from '@/lib/api/orders';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useOrderMessages } from '@/lib/firebase/firestore/order-chat';
import { useOrder } from '@/lib/firebase/firestore/orders';
import { useParksByState } from '@/lib/firebase/firestore/parks';
import { useProduct } from '@/lib/firebase/firestore/products';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';
import { OrderStatus } from '@/types';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const statusColors: Record<OrderStatus, string> = {
  Processing: '#EAB308', Sent: '#06B6D4', Received: '#10B981',
  Completed: '#10B981', Cancelled: '#EF4444', Disputed: '#F87171', AvailabilityCheck: '#F97316',
};

// Status transition validation
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Processing: ['Sent', 'Cancelled', 'AvailabilityCheck'],
  Sent: ['Received', 'Cancelled'],
  Received: ['Completed', 'Disputed'],
  Completed: [],
  Cancelled: [],
  Disputed: ['Completed', 'Cancelled'],
  AvailabilityCheck: ['Cancelled'],
};

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { order, loading } = useOrder(id);
  const { messages, loading: messagesLoading, error: messagesError } = useOrderMessages(id);
  const { colors } = useTheme();
  
  const [updating, setUpdating] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showParkPicker, setShowParkPicker] = useState(false);
  const [showNotAvailableDialog, setShowNotAvailableDialog] = useState(false);
  const [notAvailableReason, setNotAvailableReason] = useState('');
  const [waitTimeDays, setWaitTimeDays] = useState('');
  const chatScrollRef = useRef<ScrollView>(null);

  const customerState = order?.customerInfo?.state || null;
  const { parks, loading: parksLoading } = useParksByState(customerState);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0 && chatScrollRef.current && showChatModal) {
      setTimeout(() => {
        chatScrollRef.current?.scrollToEnd({ animated: true });
      }, 300);
    }
  }, [messages.length, showChatModal]);

  // --- LOGIC ---
  const handleStatusUpdate = async (newStatus: OrderStatus) => {
    if (!order) return;
    
    // Validate transition
    const allowed = ALLOWED_TRANSITIONS[order.status];
    if (!user?.isAdmin && !allowed.includes(newStatus)) {
      haptics.error();
      showToast(`Cannot change status from ${order.status} to ${newStatus}`, 'error');
      return;
    }

    if (newStatus === 'Sent' && order?.shippingType === 'delivery' && customerState) {
      setShowParkPicker(true);
      return;
    }
    if (newStatus === 'AvailabilityCheck') {
      setShowNotAvailableDialog(true);
      return;
    }
    performStatusUpdate(newStatus, null, null);
  };

  const performStatusUpdate = async (newStatus: OrderStatus, parkId: string | null, parkName: string | null) => {
    if (!order) return;
    
    setUpdating(true);
    haptics.medium();
    try {
      if (newStatus === 'Sent') {
        await cloudFunctions.markOrderAsSent({ 
          orderId: order.id!, 
          waybillParkId: parkId || undefined, 
          waybillParkName: parkName || undefined 
        });
        showToast('Order marked as sent', 'success');
      } else if (newStatus === 'AvailabilityCheck') {
        await cloudFunctions.markOrderAsNotAvailable({
          orderId: order.id!,
          reason: notAvailableReason || undefined,
          waitTimeDays: waitTimeDays ? parseInt(waitTimeDays) : undefined,
        });
        showToast('Order marked as not available', 'success');
        setNotAvailableReason('');
        setWaitTimeDays('');
      } else {
        if (user?.isAdmin) {
          await adminApi.updateOrderStatus(order.id!, newStatus);
        } else {
          await orderApi.updateStatus(order.id!, newStatus);
        }
        showToast(`Order status updated to ${newStatus}`, 'success');
      }
      setShowParkPicker(false);
      setShowNotAvailableDialog(false);
      haptics.success();
    } catch (error: any) {
      haptics.error();
      showToast(error.message || 'Failed to update order status', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || sendingMessage || !order) return;
    
    setSendingMessage(true);
    haptics.medium();
    try {
      if (!order?.id) return;
      await orderChatApi.sendMessage({ orderId: order.id, message: messageText.trim() });
      setMessageText('');
      haptics.success();
    } catch (e: any) {
      haptics.error();
      showToast(e.message || 'Failed to send message', 'error');
    } finally {
      setSendingMessage(false);
    }
  };

  if (loading || !order) return <View style={styles.center}><ActivityIndicator color="#A67C52" /></View>;

  const lastMessage = messages[messages.length - 1];
  const availableActions = (user?.isAdmin 
    ? (['Processing', 'Sent', 'Received', 'Completed', 'Cancelled', 'Disputed', 'AvailabilityCheck'] as OrderStatus[])
    : ALLOWED_TRANSITIONS[order.status] || []
  ).filter(s => s !== order.status);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="dark-content" />
      
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => { haptics.light(); router.back(); }} style={styles.backButton}>
          <IconSymbol name="chevron.left" size={28} color={colors.text} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Order Detail</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>#{order.id?.slice(0, 8).toUpperCase() || 'N/A'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColors[order.status] + '20' }]}>
          <Text style={[styles.statusText, { color: statusColors[order.status] }]}>{order.status}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* LOGISTICS & DELIVERY TYPE CARD */}
        <View style={[styles.island, { backgroundColor: colors.card }]}>
          <View style={styles.islandHeader}>
            <IconSymbol name="shippingbox.fill" size={18} color="#A67C52" />
            <Text style={[styles.islandTitle, { color: colors.text }]}>Logistics & Delivery</Text>
          </View>
          <View style={styles.deliveryTypeRow}>
            <View style={[styles.typeBadge, { backgroundColor: order.shippingType === 'pickup' ? '#E0F2FE' : '#FEF3C7' }]}>
               <Text style={[styles.typeText, { color: order.shippingType === 'pickup' ? '#0369A1' : '#B45309' }]}>
                {order.shippingType?.toUpperCase() || 'STANDARD'}
               </Text>
            </View>
            <Text style={[styles.customerName, { color: colors.text, flex: 1, textAlign: 'right' }]}>₦{order.total.toLocaleString()}</Text>
          </View>
          <View style={styles.divider} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>Recipient</Text>
          <Text style={[styles.val, { color: colors.text }]}>{order.customerInfo.name} • {order.customerInfo.phone}</Text>
          <Text style={[styles.label, { color: colors.textSecondary, marginTop: 12 }]}>Address</Text>
          <Text style={[styles.val, { color: colors.text }]}>{order.deliveryAddress}</Text>
        </View>

        {/* ITEMS ISLAND */}
        <View style={[styles.island, { backgroundColor: colors.card }]}>
          <Text style={[styles.islandTitle, { color: colors.text, marginBottom: 15 }]}>Products</Text>
          {order.items.map((item, idx) => (
            <ProductRow key={idx} item={item} colors={colors} />
          ))}
        </View>

        {/* EXPANDABLE CHAT TRIGGER CARD */}
        <TouchableOpacity 
          style={[styles.island, { backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center' }]}
          onPress={() => { haptics.light(); setShowChatModal(true); }}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.islandTitle, { color: colors.text }]}>Customer Messages</Text>
            <Text style={[styles.pMeta, { marginTop: 4, color: colors.textSecondary }]} numberOfLines={1}>
              {lastMessage ? lastMessage.message : "No messages yet. Tap to start chat."}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* MID-SCREEN CHAT MODAL */}
      <Modal visible={showChatModal} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowChatModal(false)}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
            style={styles.modalCenteredView}
          >
            <Pressable style={[styles.midModal, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Order Chat</Text>
                <TouchableOpacity onPress={() => { haptics.light(); setShowChatModal(false); }}>
                  <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              
              <ScrollView ref={chatScrollRef} style={styles.chatScroll} showsVerticalScrollIndicator={false}>
                {messagesLoading ? (
                  <View style={styles.parksLoading}>
                    <ActivityIndicator size="small" color="#A67C52" />
                    <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading messages...</Text>
                  </View>
                ) : messagesError ? (
                  <Text style={[styles.emptyChat, { color: colors.error }]}>Error loading messages: {messagesError.message}</Text>
                ) : messages.length === 0 ? (
                  <Text style={[styles.emptyChat, { color: colors.textSecondary }]}>No history with customer yet.</Text>
                ) : (
                  messages.map((m) => {
                    const dateKey = m.createdAt instanceof Date 
                      ? m.createdAt.getTime() 
                      : (m.createdAt as any)?.toMillis?.() || Date.now();
                    return (
                      <View key={m.id || `msg-${dateKey}`} style={[styles.bubble, m.senderId === user?.uid ? styles.myBubble : styles.theirBubble]}>
                        <Text style={[styles.msgText, { color: m.senderId === user?.uid ? '#FFF' : colors.text }]}>{m.message}</Text>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              <View style={styles.modalInputArea}>
                <TextInput 
                  style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text }]} 
                  placeholder="Type message..."
                  placeholderTextColor={colors.textSecondary}
                  value={messageText}
                  onChangeText={setMessageText}
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity 
                  onPress={handleSendMessage} 
                  disabled={sendingMessage || !messageText.trim()}
                  style={[styles.sendBtn, { opacity: sendingMessage || !messageText.trim() ? 0.5 : 1 }]}>
                  {sendingMessage ? (
                    <ActivityIndicator size="small" color="#A67C52" />
                  ) : (
                    <IconSymbol name="paperplane.fill" size={20} color="#A67C52" />
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* PARK PICKER MODAL */}
      <Modal visible={showParkPicker} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => { haptics.light(); setShowParkPicker(false); }}>
          <Pressable style={[styles.midModal, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Waybill Park</Text>
              <TouchableOpacity onPress={() => { haptics.light(); setShowParkPicker(false); }}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            {parksLoading ? (
              <View style={styles.parksLoading}>
                <ActivityIndicator size="small" color="#A67C52" />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading parks...</Text>
              </View>
            ) : parks.length === 0 ? (
              <View style={styles.parksLoading}>
                <Text style={[styles.emptyChat, { color: colors.textSecondary }]}>No parks available for this state.</Text>
                {customerState && (
                  <Text style={[styles.emptyChat, { color: colors.textSecondary, marginTop: 8, fontSize: 12 }]}>
                    State: {customerState}
                  </Text>
                )}
              </View>
            ) : (
              <ScrollView style={styles.parksList} showsVerticalScrollIndicator={false}>
                {parks.map((park) => (
                  <TouchableOpacity
                    key={park.id}
                    onPress={() => {
                      haptics.medium();
                      performStatusUpdate('Sent', park.id || null, park.name);
                    }}
                    style={[styles.parkOption, { backgroundColor: colors.backgroundSecondary }]}
                    activeOpacity={0.7}>
                    <View style={styles.parkOptionContent}>
                      <Text style={[styles.parkOptionText, { color: colors.text }]}>{park.name}</Text>
                      <Text style={[styles.parkOptionLocation, { color: colors.textSecondary }]}>{park.city}, {park.state}</Text>
                    </View>
                    <IconSymbol name="chevron.right" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* NOT AVAILABLE DIALOG */}
      <Modal visible={showNotAvailableDialog} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => { haptics.light(); setShowNotAvailableDialog(false); }}>
          <Pressable style={[styles.midModal, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Mark as Not Available</Text>
              <TouchableOpacity onPress={() => { haptics.light(); setShowNotAvailableDialog(false); }}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.dialogContent}>
              <Text style={[styles.dialogLabel, { color: colors.text }]}>Reason (optional)</Text>
              <TextInput
                style={[styles.dialogInput, { backgroundColor: colors.backgroundSecondary, color: colors.text }]}
                placeholder="Enter reason..."
                placeholderTextColor={colors.textSecondary}
                value={notAvailableReason}
                onChangeText={setNotAvailableReason}
                multiline
              />
              
              <Text style={[styles.dialogLabel, { color: colors.text, marginTop: 16 }]}>Wait Time (days, optional)</Text>
              <TextInput
                style={[styles.dialogInput, { backgroundColor: colors.backgroundSecondary, color: colors.text }]}
                placeholder="Enter days..."
                placeholderTextColor={colors.textSecondary}
                value={waitTimeDays}
                onChangeText={setWaitTimeDays}
                keyboardType="numeric"
              />
              
              <TouchableOpacity
                onPress={() => {
                  haptics.medium();
                  performStatusUpdate('AvailabilityCheck', null, null);
                }}
                disabled={updating}
                style={[styles.dialogButton, { backgroundColor: '#F97316', opacity: updating ? 0.5 : 1 }]}>
                {updating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.dialogButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ACTION DOCK */}
      <View style={[styles.actionDock, { backgroundColor: colors.card, paddingBottom: insets.bottom + 10, borderTopColor: colors.cardBorder }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {availableActions.map((s) => (
            <TouchableOpacity 
              key={s} 
              style={[styles.dockBtn, { backgroundColor: statusColors[s], opacity: updating ? 0.5 : 1 }]} 
              onPress={() => { haptics.medium(); handleStatusUpdate(s); }}
              disabled={updating}
              activeOpacity={0.8}>
              <Text style={styles.dockBtnText}>{updating ? '...' : s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function ProductRow({ item, colors }: any) {
  const { product } = useProduct(item.productId);
  const imageUrl = product?.imageUrls?.[0] || product?.imageUrl;
  
  return (
    <View style={styles.productRow}>
      <View style={[styles.imgContainer, { backgroundColor: colors.backgroundSecondary }]}>
        {imageUrl ? (
          <SafeImage uri={imageUrl} style={styles.thumb} placeholderIcon="photo" placeholderSize={20} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <IconSymbol name="photo" size={20} color={colors.textSecondary} />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.pMeta, { color: colors.textSecondary }]}>{item.quantity} units × ₦{item.price.toLocaleString()}</Text>
      </View>
      <Text style={[styles.pPrice, { color: colors.text }]}>₦{(item.quantity * item.price).toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 15, justifyContent: 'space-between' },
  backButton: { width: 40 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSubtitle: { fontSize: 11 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  scrollContent: { padding: 16 },
  island: { borderRadius: 24, padding: 20, marginBottom: 16 },
  islandHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 15 },
  islandTitle: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  deliveryTypeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  typeText: { fontSize: 11, fontWeight: '800' },
  customerName: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  val: { fontSize: 14, fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 15 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 15 },
  imgContainer: { width: 45, height: 45, borderRadius: 10, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  thumbPlaceholder: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  pName: { fontSize: 14, fontWeight: '700' },
  pMeta: { fontSize: 12 },
  pPrice: { fontSize: 14, fontWeight: '800' },
  actionDock: { position: 'absolute', bottom: 0, width: '100%', padding: 16, borderTopWidth: 1 },
  dockBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 15, minWidth: 110, alignItems: 'center' },
  dockBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  
  // MODAL STYLES
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCenteredView: { width: '100%', alignItems: 'center' },
  midModal: { width: '100%', maxHeight: 500, borderRadius: 30, padding: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  modalHandle: { width: 40, height: 5, backgroundColor: '#DDD', borderRadius: 5, alignSelf: 'center', marginBottom: 15 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  chatScroll: { maxHeight: 300, marginBottom: 15 },
  emptyChat: { textAlign: 'center', marginVertical: 20, fontSize: 13 },
  bubble: { padding: 12, borderRadius: 16, marginBottom: 8, maxWidth: '85%' },
  myBubble: { alignSelf: 'flex-end', backgroundColor: '#A67C52' },
  theirBubble: { alignSelf: 'flex-start', backgroundColor: '#F3F4F6' },
  msgText: { fontSize: 13, fontWeight: '500' },
  modalInputArea: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, height: 45, borderRadius: 22, paddingHorizontal: 15 },
  sendBtn: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center' },
  
  // PARK PICKER STYLES
  parksLoading: { padding: 40, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
  parksList: { maxHeight: 300, marginBottom: 20 },
  parkOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 12, marginBottom: 12 },
  parkOptionContent: { flex: 1 },
  parkOptionText: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  parkOptionLocation: { fontSize: 14 },
  
  // NOT AVAILABLE DIALOG STYLES
  dialogContent: { marginTop: 10 },
  dialogLabel: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  dialogInput: { height: 45, borderRadius: 12, paddingHorizontal: 15, fontSize: 14 },
  dialogButton: { marginTop: 24, paddingVertical: 14, borderRadius: 15, alignItems: 'center' },
  dialogButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});
