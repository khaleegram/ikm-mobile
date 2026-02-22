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
          backgroundColor: colors.card,
          paddingTop: insetTop + 12,
          borderBottomColor: colors.border,
        },
      ]}>
      <TouchableOpacity onPress={onBack} style={styles.headerButton}>
        <IconSymbol name="arrow.left" size={24} color={colors.text} />
      </TouchableOpacity>

      <View style={styles.headerCenter}>
        {headerAvatarUri ? (
          <SafeImage uri={headerAvatarUri} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, { backgroundColor: colors.backgroundSecondary }]}>
            <IconSymbol name="person.circle.fill" size={24} color={colors.textSecondary} />
          </View>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {headerName}
        </Text>
      </View>

      {canSendOffer ? (
        <TouchableOpacity
          style={[styles.offerHeaderButton, { backgroundColor: colors.backgroundSecondary }]}
          onPress={onOpenOffer}>
          <IconSymbol name="dollarsign.circle.fill" size={18} color={lightBrown} />
          <Text style={[styles.offerHeaderText, { color: lightBrown }]}>Offer</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerButton} />
      )}
    </View>
  );
}
