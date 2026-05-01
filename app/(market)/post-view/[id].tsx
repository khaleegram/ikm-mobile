import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { FeedCard } from '@/components/market/feed-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useMarketPost } from '@/lib/firebase/firestore/market-posts';

const lightBrown = '#A67C52';

export default function MarketPostViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { post, loading, error } = useMarketPost(id ?? null);
  const itemHeight = Math.max(1, Math.round(height));

  if (loading) {
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <ActivityIndicator color={lightBrown} size="large" />
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <Text style={styles.errorText}>Post not available</Text>
        <TouchableOpacity style={styles.backTextButton} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" translucent />
      <FeedCard post={post} itemHeight={itemHeight} isActive />

      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 8 }]}
        onPress={() => router.back()}
        activeOpacity={0.75}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <IconSymbol name="chevron.left" size={26} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  backTextButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: lightBrown,
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  backButton: {
    position: 'absolute',
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 50,
  },
});
