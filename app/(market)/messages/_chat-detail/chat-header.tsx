import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { SafeImage } from '@/components/safe-image';
import { IconSymbol } from '@/components/ui/icon-symbol';

import { lightBrown } from './utils';
import { styles } from './styles';

type ChatHeaderProps = {
  canSendOffer: boolean;
  colors: any;
  headerAvatarUri?: string;
  headerName: string;
  insetTop: number;
  onBack: () => void;
  onOpenOffer: () => void;
};

export function ChatHeader({
  canSendOffer,
  colors,
  headerAvatarUri,
  headerName,
  insetTop,
  onBack,
  onOpenOffer,
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
      <TouchableOpacity onPress={onBack} style={styles.headerBackBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to inbox">
        <IconSymbol name="chevron.left" size={22} color={colors.text} />
      </TouchableOpacity>

      <View style={styles.headerCenter}>
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
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {headerName}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            Direct message
          </Text>
        </View>
      </View>

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
