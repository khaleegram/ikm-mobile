import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';

const lightBrown = '#A67C52';

export default function FollowingScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.floatingHeaderContainer, { paddingTop: insets.top + 10 }]}>
        <View style={[styles.nameIsland, { backgroundColor: lightBrown }]}>
          <Text style={styles.islandLabel}>MARKET STREET</Text>
          <Text style={styles.islandTitle}>Following</Text>
        </View>
      </View>

      <View style={styles.center}>
        <IconSymbol name="person.2.fill" size={56} color={lightBrown} />
        <Text style={[styles.title, { color: colors.text }]}>Following Feed</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Follow sellers to personalize this feed.
        </Text>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: lightBrown }]}
          onPress={() => {
            haptics.light();
            router.push('/(market)/search');
          }}>
          <IconSymbol name="magnifyingglass" size={18} color="#FFFFFF" />
          <Text style={styles.buttonText}>Find Sellers</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  floatingHeaderContainer: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  nameIsland: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  islandLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  islandTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
