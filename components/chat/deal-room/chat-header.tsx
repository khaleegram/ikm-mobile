import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerifiedBadge } from '@/components/ui/verified-badge';

import { lightBrown } from './utils';
import { styles } from './styles';

type ChatHeaderProps = {
  canSendOffer: boolean;
  colors: any;
  headerAvatarUri?: string;
  /** Store / peer title — empty while loading so we don't flash a personal name. */
  headerName: string;
  headerLoading?: boolean;
  headerSubtitle?: string;
  isVerified?: boolean;
  insetTop: number;
  onBack: () => void;
  onOpenOffer: () => void;
  /** Opens store profile (seller) or buyer profile. */
  onOpenProfile?: () => void;
};

export function ChatHeader({
  canSendOffer,
  colors,
  headerAvatarUri,
  headerName,
  headerLoading = false,
  headerSubtitle = 'Deal room',
  isVerified = false,
  insetTop,
  onBack,
  onOpenOffer,
  onOpenProfile,
}: ChatHeaderProps) {
  const showName = Boolean(headerName.trim());

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
      <TouchableOpacity
        onPress={onBack}
        style={styles.headerBackBtn}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back">
        <IconSymbol name="chevron.left" size={22} color={colors.text} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.headerCenter}
        activeOpacity={onOpenProfile ? 0.75 : 1}
        disabled={!onOpenProfile}
        onPress={onOpenProfile}
        accessibilityRole={onOpenProfile ? 'button' : undefined}
        accessibilityLabel={onOpenProfile ? `Open ${headerName || 'store'} profile` : undefined}>
        <View style={[styles.headerAvatarRing, { borderColor: `${lightBrown}40` }]}>
          {headerAvatarUri ? (
            <SafeImage uri={headerAvatarUri} style={styles.headerAvatarLg} />
          ) : (
            <View style={[styles.headerAvatarLg, { backgroundColor: colors.backgroundSecondary }]}>
              <IconSymbol name="bag.fill" size={20} color={colors.textSecondary} />
            </View>
          )}
        </View>
        <View style={styles.headerTitleBlock}>
          <View style={styles.headerTitleRow}>
            {headerLoading && !showName ? (
              <ActivityIndicator size="small" color={lightBrown} />
            ) : (
              <>
                <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                  {showName ? headerName : 'Store'}
                </Text>
                {showName && isVerified ? <VerifiedBadge size={14} /> : null}
              </>
            )}
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
