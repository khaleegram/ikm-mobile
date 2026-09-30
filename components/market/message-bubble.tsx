import React, { memo } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { MarketMessage } from '@/types';
import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { formatRelativeTime } from '@/lib/utils/date-format';
import { AnimatedPressable } from '@/components/animated-pressable';
import { parseMarketOfferLink } from '@/lib/utils/market-offer-link';
import { VoiceMessageBubble } from '@/components/chat/voice-message-bubble';
import { PhotoAlbumGrid } from '@/components/chat/deal-room/photo-album-grid';
import { MilestoneCard } from '@/components/chat/milestone-card';
import { productTitleOrFallback } from '@/lib/chat/enrich-inbox-snapshots';

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
  onRetryVoice?: (messageId: string) => void;
  /** Photos sent together in one go — rendered as a single grid instead of stacked bubbles. */
  albumPhotos?: string[];
  /** Retry a failed text/quote send (voice retries go through onRetryVoice). */
  onRetryMessage?: (message: MarketMessage) => void;
  /** Open the product a quote message points at. */
  onOpenPost?: (postId: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  currentUserId,
  onOpenOffer,
  onRetryVoice,
  onRetryMessage,
  onOpenPost,
  albumPhotos,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const isSent = Boolean(currentUserId && currentUserId === message.senderId);
  // The sent bubble is filled with the gold `primary`, so everything inside it uses the paired
  // foreground instead of white — white on this gold measures 2.90:1 in dark mode. Both themes
  // expose a 6-digit hex here, so alpha suffixes stay valid.
  const onSent = colors.primaryForeground;
  const onSentMuted = colors.primaryForegroundMuted;
  const onSentSurface = `${colors.primaryForeground}1F`;
  const onSentBorder = `${colors.primaryForeground}4D`;
  const messageId = String(message.id || '').trim();
  const clientMessageId = String(message.clientMessageId || '').trim();
  const sendStatus = message.sendStatus;
  const isFailed = sendStatus === 'failed';
  const isPending =
    !isFailed &&
    (messageId.startsWith('local-') ||
      messageId.startsWith('queued-') ||
      sendStatus === 'sending' ||
      (Boolean(clientMessageId) && messageId === clientMessageId));
  const offerPayload = parseMarketOfferLink(message.paymentLink);
  const messageText = String((message as any).text || message.message || '').trim();
  const isSystem = message.type === 'system';

  if (isSystem) {
    return (
      <MilestoneCard
        text={messageText}
        event={message.systemEvent}
        photoUrl={message.milestonePhotoUrl}
        createdAt={message.createdAt}
      />
    );
  }

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

  // Voice notes are their own bubble — no outer message card behind them.
  if (message.voiceUrl && !messageText && !message.imageUrl && !message.quoteCard && !message.paymentLink && !message.chatOffer) {
    const pending =
      sendStatus === 'sending' ||
      (isPending && sendStatus !== 'failed');
    return (
      <View style={[styles.container, isSent ? styles.sentContainer : styles.receivedContainer]}>
        <VoiceMessageBubble
          uri={message.voiceUrl}
          durationSec={message.voiceDurationSec}
          isSent={isSent}
          pending={pending}
          failed={sendStatus === 'failed'}
          createdAt={message.createdAt}
          messageKey={clientMessageId || messageId}
          onRetry={
            sendStatus === 'failed' && messageId
              ? () => onRetryVoice?.(messageId)
              : undefined
          }
        />
      </View>
    );
  }

  const quote = message.quoteCard;
  const quotePostId = String(quote?.postId || '').trim();
  const quoteTitle = quote ? productTitleOrFallback(quote.previewText) : '';
  const canOpenQuote = Boolean(quotePostId && onOpenPost);

  return (
    <View style={[styles.container, isSent ? styles.sentContainer : styles.receivedContainer]}>
      <View
        style={[
          styles.bubble,
          isSent ? styles.bubbleSent : styles.bubbleReceived,
          {
            backgroundColor: isSent ? colors.primary : colors.backgroundSecondary,
            alignSelf: isSent ? 'flex-end' : 'flex-start',
          },
          // Photos sit flush against the bubble edge the way WhatsApp renders them; text keeps
          // its own padding so it never touches the edge.
          message.imageUrl && !messageText ? styles.bubbleMedia : null,
        ]}>
        {/* Image Message — an album from one send renders as one grid; a lone photo stays
            a single tile. */}
        {albumPhotos && albumPhotos.length > 1 ? (
          <PhotoAlbumGrid photos={albumPhotos} />
        ) : message.imageUrl ? (
          <SafeImage uri={message.imageUrl} style={styles.messageImage} />
        ) : null}

        {/* Text Message — the timestamp rides inline at the end of the last line, the way
            WhatsApp does it. A separate footer row cost ~17dp on every single message. */}
        {messageText ? (
          <Text
            style={[
              styles.messageText,
              { color: isSent ? onSent : colors.text },
              isSent ? styles.messageTextSent : null,
            ]}>
            {messageText}
            <Text style={[styles.inlineTime, { color: isSent ? onSentMuted : colors.textSecondary }]}>
              {`  ${formatRelativeTime(message.createdAt)}`}
            </Text>
          </Text>
        ) : null}

        {/* Read ticks float in the corner the text reserved with paddingRight. */}
        {isSent && !isFailed && messageText ? (
          <View style={styles.inlineTicks} pointerEvents="none">
            <IconSymbol
              name={message.read ? 'checkmark.circle.fill' : 'checkmark.circle'}
              size={11}
              color={message.read ? onSent : onSentMuted}
              style={{ opacity: isPending ? 0.45 : 1 }}
            />
          </View>
        ) : null}

        {/* Product tile — the item this deal is about. Image plus one caption line; the old
            version nested a bordered box inside the bubble and printed "Product" twice. */}
        {quote ? (
          <AnimatedPressable
            disabled={!canOpenQuote}
            onPress={() => onOpenPost?.(quotePostId)}
            scaleValue={0.98}
            accessibilityRole={canOpenQuote ? 'button' : undefined}
            accessibilityLabel={canOpenQuote ? `${quoteTitle}. Open product` : quoteTitle}>
            {quote.previewImage ? (
              <SafeImage uri={quote.previewImage} style={styles.quoteImage} />
            ) : null}
            <View style={styles.quoteMeta}>
              <Text
                numberOfLines={1}
                style={[styles.quoteTitle, { color: isSent ? onSent : colors.text }]}>
                {quoteTitle}
              </Text>
              {canOpenQuote ? (
                <IconSymbol
                  name="chevron.right"
                  size={13}
                  color={isSent ? onSentMuted : colors.textSecondary}
                />
              ) : null}
            </View>
          </AnimatedPressable>
        ) : null}

        {/* Structured offer chip */}
        {message.chatOffer && message.type === 'offer' ? (
          <View
            style={[
              styles.offerChip,
              {
                backgroundColor: isSent ? onSentSurface : colors.background,
                borderColor: isSent ? onSentBorder : colors.border,
              },
            ]}>
            <IconSymbol
              name="dollarsign.circle.fill"
              size={14}
              color={isSent ? onSent : colors.primary}
            />
            <Text style={[styles.offerChipText, { color: isSent ? onSent : colors.text }]}>
              {isSent ? 'Your offer' : 'Offer'}{' '}
              {message.chatOffer.currency} {message.chatOffer.amount.toLocaleString()}
              {message.chatOffer.status === 'pending'
                ? ' · pending'
                : message.chatOffer.status === 'accepted'
                  ? ' · accepted'
                  : message.chatOffer.status
                    ? ` · ${message.chatOffer.status}`
                    : ''}
            </Text>
          </View>
        ) : null}

        {/* Payment Link */}
        {message.paymentLink && (
          <AnimatedPressable
            style={[
              styles.paymentLink,
              { backgroundColor: isSent ? onSentSurface : colors.backgroundSecondary },
            ]}
            onPress={handlePaymentLink}
            scaleValue={0.95}>
            <IconSymbol
              name={offerPayload ? 'bag.fill' : 'creditcard'}
              size={16}
              color={isSent ? onSent : colors.text}
            />
            <Text style={[styles.paymentLinkText, { color: isSent ? onSent : colors.text }]}>
              {offerPayload ? (isSent ? 'Offer Sent' : 'Buy Offer') : 'Payment Link'}
            </Text>
            <IconSymbol name="arrow.up.right" size={14} color={isSent ? onSent : colors.text} />
          </AnimatedPressable>
        )}

        {/* Timestamp row survives only where it cannot ride inline: photo-only messages and a
            failed send that needs its retry affordance. */}
        {!messageText || isFailed ? (
          <View style={styles.footer}>
            <Text
              style={[
                styles.timestamp,
                { color: isSent ? onSentMuted : colors.textSecondary },
              ]}>
              {formatRelativeTime(message.createdAt)}
            </Text>
            {isSent && isFailed ? (
              <AnimatedPressable
                onPress={() => onRetryMessage?.(message)}
                scaleValue={0.94}
                disabled={!onRetryMessage}>
                <Text
                  style={[
                    styles.pendingText,
                    { color: isSent ? onSent : '#B91C1C', textDecorationLine: 'underline' },
                  ]}>
                  Failed · Tap to retry
                </Text>
              </AnimatedPressable>
            ) : null}
          </View>
        ) : null}
      </View>

    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    // WhatsApp-density rows: tight enough that a screen holds a real conversation.
    marginVertical: 1,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  sentContainer: {
    justifyContent: 'flex-end',
  },
  receivedContainer: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 8,
    paddingVertical: 3,
    // WhatsApp uses a tight ~8px radius; the large radius was a big part of why these read as
    // chunky panels rather than message bubbles.
    borderRadius: 9,
    gap: 3,
    // No shadow or elevation: WhatsApp separates messages by fill colour alone. The card
    // shadow was what made every message read as a floating panel.
  },
  /** Tail corner on the sender's side, as WhatsApp does. */
  bubbleSent: {
    borderBottomRightRadius: 3,
  },
  bubbleReceived: {
    borderBottomLeftRadius: 3,
  },
  /** Image-only messages bleed to the bubble edge; radius stays inside the tail corner. */
  bubbleMedia: {
    padding: 3,
    paddingBottom: 3,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 18,
  },
  /** Reserves the corner the floating read ticks sit in. Costs no height. */
  messageTextSent: {
    paddingRight: 14,
  },
  inlineTime: {
    fontSize: 10,
  },
  inlineTicks: {
    position: 'absolute',
    right: 6,
    bottom: 4,
  },
  messageImage: {
    width: 190,
    height: 190,
    borderRadius: 7,
    marginBottom: 4,
  },
  offerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  offerChipText: {
    fontSize: 13,
    fontWeight: '600',
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
  },
  timestamp: {
    fontSize: 10,
  },
  pendingText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quoteImage: {
    width: '100%',
    height: 140,
    borderRadius: 12,
  },
  quoteMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  quoteTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 18,
  },
  systemWrap: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  systemPill: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: '92%',
  },
  systemText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 16,
  },
});
