import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';

import { lightBrown } from './utils';
import { styles } from './styles';

type ChatHeaderProps = {
  canSendOffer: boolean;
  colors: any;
  headerAvatarUri?: string;
  headerName: string;
  headerSubtitle?: string;
  insetTop: number;
  onBack: () => void;
  onOpenOffer: () => void;
  /** Opens peer product-rooms hub when tapping the peer name/avatar. */
  onOpenPeerHub?: () => void;
};

export function ChatHeader({
  canSendOffer,
  colors,
  headerAvatarUri,
  headerName,
  headerSubtitle = 'Direct message',
  insetTop,
  onBack,
  onOpenOffer,
  onOpenPeerHub,
}: ChatHeaderProps) {
  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.background,
          paddingTop: insetTop + 8,
          borderBottomColor: colors.border,
        },
      ]}>
      <TouchableOpacity onPress={onBack} style={styles.headerBackBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
        <IconSymbol name="chevron.left" size={22} color={colors.text} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.headerCenter}
        activeOpacity={onOpenPeerHub ? 0.75 : 1}
        disabled={!onOpenPeerHub}
        onPress={onOpenPeerHub}
        accessibilityRole={onOpenPeerHub ? 'button' : undefined}
        accessibilityLabel={onOpenPeerHub ? `All products with ${headerName}` : undefined}>
        <View style={[styles.headerAvatarRing, { borderColor: `${lightBrown}40` }]}>
          {headerAvatarUri ? (
            <SafeImage uri={headerAvatarUri} style={styles.headerAvatarLg} />
          ) : (
            <View style={[styles.headerAvatarLg, { backgroundColor: colors.backgroundSecondary }]}>
              <IconSymbol name="person.fill" size={22} color={colors.textSecondary} />
            </View>
          )}
        </View>
        <View style={styles.headerTitleBlock}>
          <View style={styles.headerTitleRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {headerName}
            </Text>
            <VerifiedBadge size={14} />
          </View>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {headerSubtitle}
          </Text>
        </View>
      </TouchableOpacity>

      {canSendOffer ? (
        <TouchableOpacity
          style={[styles.offerPill, { backgroundColor: `${lightBrown}18`, borderColor: `${lightBrown}44` }]}
          onPress={onOpenOffer}
          activeOpacity={0.85}>
          <IconSymbol name="dollarsign.circle.fill" size={17} color={lightBrown} />
          <Text style={[styles.offerPillText, { color: lightBrown }]}>Offer</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerSpacer} />
      )}
    </View>
  );
}
