import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import type { ChatPostSnapshot } from '@/types/chat';

const lightBrown = '#A67C52';

type DealProductHeroProps = {
  postId?: string | null;
  snapshot?: ChatPostSnapshot | null;
  peerName?: string | null;
  threadStatus?: string | null;
  canMakeOffer?: boolean;
  onMakeOffer?: () => void;
  linkedOrderId?: string | null;
};

function statusLabel(status?: string | null): string {
  const value = String(status || '').toLowerCase();
  if (value === 'in_order' || value === 'order_active') return 'In order';
  if (value === 'offer_sent') return 'Offer out';
  if (value === 'accepted') return 'Accepted';
  if (value === 'negotiating') return 'Negotiating';
  if (value === 'completed') return 'Done';
  if (value === 'closed') return 'Closed';
  return 'Deal';
}

export const DealProductHero = memo(function DealProductHero({
  postId,
  snapshot,
  threadStatus,
  canMakeOffer = false,
  onMakeOffer,
  linkedOrderId,
}: DealProductHeroProps) {
  const { colors } = useTheme();
  const title = String(snapshot?.title || '').trim() || 'Marketplace listing';

  const openPrimary = () => {
    if (linkedOrderId) {
      router.push(`/(market)/orders/${linkedOrderId}` as any);
      return;
    }
    if (postId) {
      router.push(`/(market)/post/${postId}` as any);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}
      activeOpacity={0.88}
      onPress={openPrimary}
      disabled={!postId && !linkedOrderId}>
      {snapshot?.imageUrl ? (
        <SafeImage uri={snapshot.imageUrl} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: colors.backgroundSecondary }]} />
      )}

      <View style={styles.meta}>
        <Text style={[styles.kicker, { color: lightBrown }]} numberOfLines={1}>
          {statusLabel(threadStatus)}
        </Text>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {canMakeOffer && onMakeOffer ? (
        <TouchableOpacity
          style={[styles.offerBtn, { backgroundColor: `${lightBrown}22` }]}
          onPress={(e) => {
            e.stopPropagation?.();
            onMakeOffer();
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <IconSymbol name="dollarsign.circle.fill" size={18} color={lightBrown} />
        </TouchableOpacity>
      ) : (
        <IconSymbol name="chevron.right" size={14} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginTop: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  offerBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
