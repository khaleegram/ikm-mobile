import type { ChatMessage } from '@/types/chat';
import type { MarketMessage } from '@/types';
import { buildMarketOfferLink } from '@/lib/utils/market-offer-link';

export function chatMessageToMarketMessage(
  message: ChatMessage,
  threadId: string,
  postId: string,
  peerId: string,
  sellerId?: string,
  /**
   * Once the price is agreed (thread accepted / in order) the deal room's ribbon owns
   * checkout — an "Buy Offer" chip inside the old accepted bubble would be a second,
   * contradicting way to pay.
   */
  suppressOfferPaymentLink = false
): MarketMessage {
  const offer = message.offer;
  const attachment = message.attachment;

  let text = String(message.body || '').trim();
  let type = message.type as MarketMessage['type'];
  let paymentLink: string | undefined;
  let imageUrl: string | undefined;
  let quoteCard: MarketMessage['quoteCard'];
  let chatOffer: MarketMessage['chatOffer'];
  const payload = (message.payload || {}) as Record<string, unknown>;
  const rawSendStatus = String(payload.sendStatus || '');
  const sendStatus =
    rawSendStatus === 'sending' || rawSendStatus === 'failed' ? rawSendStatus : undefined;
  // Photos sent in one pick carry the same albumId; consecutive ones are grouped by ChatList.
  const albumId = asString(payload.albumId) || undefined;
  const albumIndex = albumId ? Number(payload.albumIndex) : NaN;
  const albumCount = albumId ? Number(payload.albumCount) : NaN;

  if (message.type === 'offer' || message.type === 'counter') {
    type = 'offer';
    if (offer) {
      text = text || `Offer: ${offer.currency} ${offer.amount.toLocaleString()}`;
      chatOffer = {
        id: offer.id,
        amount: offer.amount,
        currency: offer.currency,
        status: offer.status,
        lowball: (offer as { lowball?: boolean }).lowball,
      };
      if (offer.status === 'accepted' && sellerId && !suppressOfferPaymentLink) {
        paymentLink = buildMarketOfferLink({
          postId,
          sellerId,
          price: offer.amount,
          chatId: threadId,
        });
      }
    }
  } else if (message.type === 'quote') {
    type = 'quote';
    const nested = (payload.quote && typeof payload.quote === 'object'
      ? (payload.quote as Record<string, unknown>)
      : null) || {};
    quoteCard = {
      postId: String(nested.postId || payload.postId || postId),
      previewText: String(nested.previewText || payload.previewText || text),
      previewImage: nested.previewImage
        ? String(nested.previewImage)
        : payload.previewImage
          ? String(payload.previewImage)
          : undefined,
    };
  } else if (message.type === 'image' && attachment?.url) {
    type = 'media';
    imageUrl = attachment.url;
  } else if (message.type === 'voice' && attachment?.url) {
    type = 'media';
    text = '';
    const status = String(payload.sendStatus || '');
    // Prefer local file while available so upload success never remounts / reloads playback.
    const localUri = asString(payload.localUri);
    const voiceUrl = localUri || attachment.url;
    return {
      id: message.id,
      chatId: threadId,
      senderId: String(message.senderId || ''),
      receiverId: peerId,
      postId,
      text,
      message: text,
      type,
      voiceUrl,
      voiceDurationSec: attachment.durationSec ?? undefined,
      clientMessageId: message.clientMsgId || undefined,
      read: true,
      createdAt: new Date(message.createdAt),
      ...(status === 'sending' || status === 'failed' ? { sendStatus: status } : {}),
    } as MarketMessage;
  } else if (
    message.type === 'system' ||
    message.type === 'order_created' ||
    message.type === 'order_shipped' ||
    message.type === 'order_delivered' ||
    message.type === 'accept' ||
    message.type === 'decline'
  ) {
    type = 'system';
    text = text || 'Deal update';
    const photo =
      asString(payload.photoUrl) ||
      asString(payload.sentPhotoUrl) ||
      asString(payload.imageUrl) ||
      undefined;
    return {
      id: message.id,
      chatId: threadId,
      senderId: String(message.senderId || ''),
      receiverId: peerId,
      postId,
      text,
      message: text,
      type,
      systemEvent: asString(payload.event) || message.type,
      milestonePhotoUrl: photo,
      clientMessageId: message.clientMsgId || undefined,
      read: true,
      createdAt: new Date(message.createdAt),
    };
  }

  return {
    id: message.id,
    chatId: threadId,
    senderId: String(message.senderId || ''),
    receiverId: peerId,
    postId,
    text,
    message: text,
    type,
    imageUrl,
    paymentLink,
    quoteCard,
    chatOffer,
    // An album is several single-attachment messages; these fields let the list re-group them.
    ...(albumId
      ? {
          albumId,
          albumIndex: Number.isFinite(albumIndex) ? albumIndex : undefined,
          albumCount: Number.isFinite(albumCount) ? albumCount : undefined,
        }
      : {}),
    clientMessageId: message.clientMsgId || undefined,
    sendStatus,
    read: true,
    createdAt: new Date(message.createdAt),
  };
}

function asString(value: unknown): string {
  return String(value || '').trim();
}
