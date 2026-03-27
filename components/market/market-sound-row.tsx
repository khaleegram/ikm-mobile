import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import type { MarketSound } from '@/types';

interface MarketSoundRowProps {
  colors: {
    backgroundSecondary: string;
    border: string;
    card: string;
    primary: string;
    text: string;
    textSecondary: string;
  };
  isPreviewing?: boolean;
  isSaved?: boolean;
  onOpen?: (() => void) | null;
  onPreview?: (() => void) | null;
  onToggleSave?: (() => void) | null;
  selected?: boolean;
  sound: MarketSound;
  togglingSave?: boolean;
}

export function MarketSoundRow({
  colors,
  isPreviewing = false,
  isSaved = false,
  onOpen,
  onPreview,
  onToggleSave,
  selected = false,
  sound,
  togglingSave = false,
}: MarketSoundRowProps) {
  const usageLabel = `${sound.usageCount || 0} uses`;
  const creatorLabel = sound.creatorName ? `by ${sound.creatorName}` : 'IKM sound';

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={[
        styles.container,
        {
          backgroundColor: selected ? `${colors.primary}14` : colors.card,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
      onPress={onOpen || onPreview || undefined}>
      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.previewButton, { backgroundColor: colors.backgroundSecondary }]}
        onPress={onPreview || undefined}>
        <IconSymbol name={isPreviewing ? 'pause.fill' : 'play.fill'} size={16} color={colors.text} />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {sound.title}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {creatorLabel}
        </Text>
        <Text style={[styles.usage, { color: colors.textSecondary }]} numberOfLines={1}>
          {usageLabel}
        </Text>
      </View>

      {onToggleSave ? (
        <TouchableOpacity
          activeOpacity={0.9}
          style={[
            styles.saveButton,
            {
              backgroundColor: isSaved ? `${colors.primary}1E` : colors.backgroundSecondary,
              borderColor: isSaved ? `${colors.primary}66` : colors.border,
            },
          ]}
          onPress={onToggleSave}>
          {togglingSave ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.saveButtonText, { color: isSaved ? colors.primary : colors.text }]}>
              {isSaved ? 'Saved' : 'Save'}
            </Text>
          )}
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  previewButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    fontSize: 12,
    fontWeight: '500',
  },
  usage: {
    fontSize: 12,
  },
  saveButton: {
    minWidth: 72,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
