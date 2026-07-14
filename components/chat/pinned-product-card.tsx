import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

import { SafeImage } from '@/components/safe-image';
import { useTheme } from '@/lib/theme/theme-context';
import type { ChatPostSnapshot } from '@/types/chat';

const lightBrown = '#A67C52';

type PinnedProductCardProps = {
  postId?: string | null;
  snapshot?: ChatPostSnapshot | null;
  threadStatus?: string | null;
  onMakeOffer?: () => void;
  canMakeOffer?: boolean;
};

export const PinnedProductCard = memo(function PinnedProductCard({
  postId,
  snapshot,
  threadStatus,
  onMakeOffer,
  canMakeOffer = false,
}: PinnedProductCardProps) {
  const { colors } = useTheme();
  const title = snapshot?.title || 'Listing';
  const price =
    typeof snapshot?.price === 'number' && snapshot.price > 0
      ? `${snapshot.currency || 'NGN'} ${snapshot.price.toLocaleString()}`
      : null;
  const location = snapshot?.location;

  if (!postId && !snapshot?.imageUrl) return null;

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}>
      {snapshot?.imageUrl ? (
        <SafeImage uri={snapshot.imageUrl} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: colors.backgroundSecondary }]} />
      )}
      <View style={styles.meta}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        {price ? (
          <Text style={[styles.price, { color: lightBrown }]}>{price}</Text>
        ) : null}
        {location ? (
          <Text style={[styles.location, { color: colors.textSecondary }]} numberOfLines={1}>
            {location}
          </Text>
        ) : null}
        {threadStatus ? (
          <Text style={[styles.status, { color: colors.textSecondary }]}>
            {threadStatus.replace(/_/g, ' ')}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {postId ? (
            <TouchableOpacity
              style={[styles.btn, { borderColor: colors.border }]}
              onPress={() => router.push(`/(market)/post/${postId}` as any)}>
              <Text style={[styles.btnText, { color: colors.text }]}>View post</Text>
            </TouchableOpacity>
          ) : null}
          {canMakeOffer && onMakeOffer ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { backgroundColor: lightBrown }]}
              onPress={onMakeOffer}>
              <Text style={[styles.btnText, styles.btnTextPrimary]}>Make offer</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
  },
  meta: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
  },
  price: {
    fontSize: 14,
    fontWeight: '700',
  },
  location: {
    fontSize: 12,
    fontWeight: '600',
  },
  status: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnPrimary: {
    borderWidth: 0,
  },
  btnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  btnTextPrimary: {
    color: '#fff',
  },
});
