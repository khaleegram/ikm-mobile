import { MarketPost } from '@/types';
import { getMarketBranding } from '@/lib/market-branding';
import { Share } from 'react-native';

function getPostTitle(post: MarketPost): string {
  const b = getMarketBranding();
  if (post.description && post.description.trim()) {
    const trimmed = post.description.trim();
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  }
  if (post.price && post.price > 0) {
    return `${b.proseName} post - NGN ${post.price.toLocaleString()}`;
  }
  return `${b.proseName} post`;
}

export function buildMarketPostShareMessage(post: MarketPost): string {
  const b = getMarketBranding();
  const headline = getPostTitle(post);
  const location = post.location?.city || post.location?.state;
  const tags = post.hashtags?.length
    ? `\nTags: ${post.hashtags.slice(0, 4).map((tag) => `#${tag}`).join(' ')}`
    : '';
  const price = post.price && post.price > 0 ? `\nPrice: NGN ${post.price.toLocaleString()}` : '';
  const where = location ? `\nLocation: ${location}` : '';
  return `${headline}${price}${where}${tags}\n\n${b.shareFromLine}`;
}

export async function shareMarketPost(post: MarketPost): Promise<void> {
  await Share.share({
    message: buildMarketPostShareMessage(post),
  });
}
