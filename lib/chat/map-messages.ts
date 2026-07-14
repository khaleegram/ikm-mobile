import type { ChatMessage } from '@/types/chat';
import type { MarketMessage } from '@/types';
import { buildMarketOfferLink } from '@/lib/utils/market-offer-link';

export function chatMessageToMarketMessage(
  message: ChatMessage,
  threadId: string,
  postId: string,
  peerId: string,
  sellerId?: string
): MarketMessage {
  const offer = message.offer;
  const attachment = message.attachment;

  let text = String(message.body || '').trim();
  let type = message.type as MarketMessage['type'];
  let paymentLink: string | undefined;
  let imageUrl: string | undefined;
  let quoteCard: MarketMessage['quoteCard'];
  let chatOffer: MarketMessage['chatOffer'];

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
      if (offer.status === 'accepted' && sellerId) {
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
    const payload = message.payload || {};
    quoteCard = {
      postId: String(payload.postId || postId),
      previewText: String(payload.previewText || text),
      previewImage: payload.previewImage ? String(payload.previewImage) : undefined,
    };
  } else if (message.type === 'image' && attachment?.url) {
    type = 'media';
    imageUrl = attachment.url;
  } else if (message.type === 'voice' && attachment?.url) {
    type = 'media';
    text = '';
    const status = String((message.payload as any)?.sendStatus || '');
    return {
      id: message.id,
      chatId: threadId,
      senderId: String(message.senderId || ''),
      receiverId: peerId,
      postId,
      text,
      message: text,
      type,
      voiceUrl: attachment.url,
      voiceDurationSec: attachment.durationSec ?? undefined,
      clientMessageId: message.clientMsgId || undefined,
      read: true,
      createdAt: new Date(message.createdAt),
      ...(status === 'sending' || status === 'failed'
        ? { voiceSendStatus: status as 'sending' | 'failed' }
        : {}),
    } as MarketMessage & { voiceSendStatus?: 'sending' | 'failed' };
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
    const payload = (message.payload || {}) as Record<string, unknown>;
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
    clientMessageId: message.clientMsgId || undefined,
    read: true,
    createdAt: new Date(message.createdAt),
  };
}

function asString(value: unknown): string {
  return String(value || '').trim();
}
