import React, { memo } from 'react';
import { View, Text, StyleSheet, Linking, Platform } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { MarketMessage } from '@/types';
import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { AnimatedPressable } from '@/components/animated-pressable';
import { parseMarketOfferLink } from '@/lib/utils/market-offer-link';

interface MessageBubbleProps {
  message: MarketMessage;
  currentUserId?: string | null;
  peerAvatarUri?: string;
  onOpenOffer?: (offer: {
    postId: string;
    sellerId: string;
    price: number;
    chatId?: string;
  }) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  currentUserId,
  peerAvatarUri,
  onOpenOffer,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const isSent = Boolean(currentUserId && currentUserId === message.senderId);
  const messageId = String(message.id || '').trim();
  const clientMessageId = String(message.clientMessageId || '').trim();
  const isPending =
    messageId.startsWith('local-') ||
    messageId.startsWith('queued-') ||
    (Boolean(clientMessageId) && messageId === clientMessageId);
  const offerPayload = parseMarketOfferLink(message.paymentLink);
  const messageText = String((message as any).text || message.message || '').trim();

  const handlePaymentLink = async () => {
    if (offerPayload) {
      if (isSent) return; // Seller just sees 'Offer Sent', no action needed
      if (onOpenOffer) {
        onOpenOffer(offerPayload);
      }
      return;
    }

    if (message.paymentLink) {
      try {
        await Linking.openURL(message.paymentLink);
      } catch (error) {
        console.error('Error opening payment link:', error);
      }
    }
  };

  return (
    <View style={[styles.container, isSent ? styles.sentContainer : styles.receivedContainer]}>
      {!isSent ? (
        <View style={[styles.avatarWrap, { backgroundColor: colors.backgroundSecondary }]}>
          {peerAvatarUri ? (
            <SafeImage uri={peerAvatarUri} style={styles.avatarImage} />
          ) : (
            <IconSymbol name="person.circle.fill" size={22} color={colors.textSecondary} />
          )}
        </View>
      ) : null}

      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isSent ? colors.primary : colors.backgroundSecondary,
            alignSelf: isSent ? 'flex-end' : 'flex-start',
          },
        ]}>
        {/* Image Message */}
        {message.imageUrl && (
          <SafeImage uri={message.imageUrl} style={styles.messageImage} />
        )}

        {/* Text Message */}
        {messageText ? (
          <Text
            style={[
              styles.messageText,
              { color: isSent ? '#FFFFFF' : colors.text },
            ]}>
            {messageText}
          </Text>
        ) : null}

        {/* Quote Card */}
        {message.quoteCard && (
          <View
            style={[
              styles.quoteCard,
              {
                borderColor: isSent ? 'rgba(255,255,255,0.35)' : colors.border,
                backgroundColor: isSent ? 'rgba(255,255,255,0.12)' : colors.background,
              },
            ]}>
            <View style={styles.quoteHeader}>
              <IconSymbol name="tag.fill" size={12} color={isSent ? '#FFFFFF' : colors.textSecondary} />
              <Text
                style={[
                  styles.quoteHeaderText,
                  { color: isSent ? '#FFFFFF' : colors.textSecondary },
                ]}>
                From Post
              </Text>
            </View>
            <Text
              numberOfLines={2}
              style={[
                styles.quotePreviewText,
                { color: isSent ? '#FFFFFF' : colors.text },
              ]}>
              {message.quoteCard.previewText}
            </Text>
            {message.quoteCard.previewImage ? (
              <SafeImage uri={message.quoteCard.previewImage} style={styles.quotePreviewImage} />
            ) : null}
          </View>
        )}

        {/* Payment Link */}
        {message.paymentLink && (
          <AnimatedPressable
            style={[styles.paymentLink, { backgroundColor: isSent ? 'rgba(255,255,255,0.2)' : colors.backgroundSecondary }]}
            onPress={handlePaymentLink}
            scaleValue={0.95}>
            <IconSymbol
              name={offerPayload ? 'bag.fill' : 'creditcard'}
              size={16}
              color={isSent ? '#FFFFFF' : colors.text}
            />
            <Text style={[styles.paymentLinkText, { color: isSent ? '#FFFFFF' : colors.text }]}>
              {offerPayload ? (isSent ? 'Offer Sent' : 'Buy Offer') : 'Payment Link'}
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
          {isSent && isPending ? (
            <Text style={[styles.pendingText, { color: 'rgba(255,255,255,0.8)' }]}>Pending</Text>
          ) : null}
          {isSent && (
            <IconSymbol
              name={message.read ? 'checkmark.circle.fill' : 'checkmark.circle'}
              size={14}
              color={message.read ? '#4CAF50' : 'rgba(255,255,255,0.7)'}
              style={{ opacity: isPending ? 0.45 : 1 }}
            />
          )}
        </View>
      </View>

    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  sentContainer: {
    justifyContent: 'flex-end',
  },
  receivedContainer: {
    justifyContent: 'flex-start',
  },
  avatarWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    gap: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 1 },
    }),
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
  pendingText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quoteCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    gap: 4,
  },
  quoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quoteHeaderText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quotePreviewText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  quotePreviewImage: {
    marginTop: 6,
    width: '100%',
    height: 110,
    borderRadius: 8,
  },
});
