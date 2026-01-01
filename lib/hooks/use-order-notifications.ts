// Hook to listen for new orders and send notifications
import { useEffect } from 'react';
import { useSellerOrders } from '../firebase/firestore/orders';
import { useUser } from '../firebase/auth/use-user';
import { scheduleNotification } from './use-notifications';
import { createNotification } from '../firebase/firestore/notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OrderStatus } from '@/types';

const LAST_ORDER_KEY = '@ikm_last_order_id';

const LAST_ORDER_STATUS_KEY = '@ikm_last_order_status';

export function useOrderNotifications() {
  const { user } = useUser();
  const { orders } = useSellerOrders(user?.uid || null);

  useEffect(() => {
    if (!orders || orders.length === 0) return;

    const checkNewOrders = async () => {
      try {
        const lastOrderId = await AsyncStorage.getItem(LAST_ORDER_KEY);
        const lastOrderStatus = await AsyncStorage.getItem(LAST_ORDER_STATUS_KEY);
        const latestOrder = orders[0]; // Orders are sorted by createdAt desc

        if (!lastOrderId || latestOrder.id !== lastOrderId) {
          // New order detected
          if (lastOrderId) {
            // Only notify if we had a previous order (not first load)
            const title = '🎉 New Order Received!';
            const message = `Order #${latestOrder.id?.slice(0, 8) || 'N/A'} • ₦${(latestOrder.total || 0).toLocaleString()}`;
            
            // Send push notification
            await scheduleNotification(
              title,
              message,
              {
                type: 'new_order',
                orderId: latestOrder.id,
                amount: latestOrder.total || 0,
              },
              {
                subtitle: `${latestOrder.items.length} item${latestOrder.items.length !== 1 ? 's' : ''}`,
              }
            );

            // Save notification to Firestore
            try {
              await createNotification({
                userId: user.uid,
                title: title.replace('🎉 ', ''), // Remove emoji for cleaner storage
                message,
                type: 'new_order',
                orderId: latestOrder.id,
                amount: latestOrder.total || 0,
                read: false,
              });
            } catch (error) {
              console.error('Error saving notification to Firestore:', error);
              // Continue even if Firestore save fails
            }
          }

          // Update last order ID and status
          await AsyncStorage.setItem(LAST_ORDER_KEY, latestOrder.id);
          await AsyncStorage.setItem(LAST_ORDER_STATUS_KEY, latestOrder.status);
        } else if (lastOrderStatus && latestOrder.status !== lastOrderStatus) {
          // Order status changed
          const statusMessages: Record<OrderStatus, { title: string; emoji: string }> = {
            Processing: { title: 'Order Processing', emoji: '⏳' },
            Sent: { title: 'Order Sent', emoji: '📦' },
            Received: { title: 'Order Received', emoji: '✅' },
            Completed: { title: 'Order Completed', emoji: '✅' },
            Cancelled: { title: 'Order Cancelled', emoji: '❌' },
            Disputed: { title: 'Order Disputed', emoji: '⚠️' },
          };

          const message = statusMessages[latestOrder.status];
          if (message) {
            const title = `${message.emoji} ${message.title}`;
            const notificationMessage = `Order #${latestOrder.id.slice(0, 8)} status updated to ${latestOrder.status}`;
            const notificationType = latestOrder.status === 'Cancelled' ? 'order_cancelled' : 'order_update';

            // Send push notification
            await scheduleNotification(
              title,
              notificationMessage,
              {
                type: notificationType,
                orderId: latestOrder.id,
                status: latestOrder.status,
              }
            );

            // Save notification to Firestore
            try {
              await createNotification({
                userId: user.uid,
                title: message.title, // Remove emoji for cleaner storage
                message: notificationMessage,
                type: notificationType,
                orderId: latestOrder.id,
                status: latestOrder.status,
                read: false,
              });
            } catch (error) {
              console.error('Error saving notification to Firestore:', error);
              // Continue even if Firestore save fails
            }
          }

          await AsyncStorage.setItem(LAST_ORDER_STATUS_KEY, latestOrder.status);
        }
      } catch (error) {
        console.error('Error checking new orders:', error);
      }
    };

    checkNewOrders();
  }, [orders]);
}

