import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { MarketMessage } from '@/types';
import { useUser } from '@/lib/firebase/auth/use-user';
import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { AnimatedPressable } from '@/components/animated-pressable';

interface MessageBubbleProps {
  message: MarketMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { colors } = useTheme();
  const { user } = useUser();
  const isSent = user?.uid === message.senderId;

  const handlePaymentLink = async () => {
    if (message.paymentLink) {
      try {
        await Linking.openURL(message.paymentLink);
      } catch (error) {
        console.error('Error opening payment link:', error);
      }
    }
  };

  return (
    <View
      style={[
        styles.container,
        isSent ? styles.sentContainer : styles.receivedContainer,
      ]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isSent ? '#A67C52' : colors.backgroundSecondary,
            alignSelf: isSent ? 'flex-end' : 'flex-start',
          },
        ]}>
        {/* Image Message */}
        {message.imageUrl && (
          <SafeImage uri={message.imageUrl} style={styles.messageImage} />
        )}

        {/* Text Message */}
        {message.message && (
          <Text
            style={[
              styles.messageText,
              { color: isSent ? '#FFFFFF' : colors.text },
            ]}>
            {message.message}
          </Text>
        )}

        {/* Payment Link */}
        {message.paymentLink && (
          <AnimatedPressable
            style={[styles.paymentLink, { backgroundColor: isSent ? 'rgba(255,255,255,0.2)' : colors.backgroundSecondary }]}
            onPress={handlePaymentLink}
            scaleValue={0.95}>
            <IconSymbol name="creditcard" size={16} color={isSent ? '#FFFFFF' : colors.text} />
            <Text style={[styles.paymentLinkText, { color: isSent ? '#FFFFFF' : colors.text }]}>
              Payment Link
            </Text>
            <IconSymbol name="arrow.up.right" size={14} color={isSent ? '#FFFFFF' : colors.text} />
          </AnimatedPressable>
        )}

        {/* Timestamp and Read Status */}
        <View style={styles.footer}>
          <Text
            style={[
              styles.timestamp,
              { color: isSent ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
            ]}>
            {formatRelativeTime(message.createdAt)}
          </Text>
          {isSent && (
            <IconSymbol
              name={message.read ? 'checkmark.circle.fill' : 'checkmark.circle'}
              size={14}
              color={message.read ? '#4CAF50' : 'rgba(255,255,255,0.7)'}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  sentContainer: {
    alignItems: 'flex-end',
  },
  receivedContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 16,
    gap: 8,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 4,
  },
  paymentLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  paymentLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  timestamp: {
    fontSize: 11,
  },
});
