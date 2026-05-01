import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useUploadProgress } from '@/lib/context/upload-progress';
import { useTheme } from '@/lib/theme/theme-context';

const ACCENT = '#A67C52';

export function UploadProgressBanner() {
  const { upload, dismissUpload } = useUploadProgress();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const slideAnim = useRef(new Animated.Value(-120)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const visible = upload.status !== 'idle';

  // Slide in / out
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : -120,
      useNativeDriver: true,
      damping: 18,
      stiffness: 160,
    }).start();
  }, [visible, slideAnim]);

  // Animate progress bar width
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: upload.progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [upload.progress, progressAnim]);

  const isError = upload.status === 'error';
  const isDone = upload.status === 'done';
  const accentColor = isError ? '#D9534F' : ACCENT;

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          top: insets.top + 10,
          backgroundColor: colors.card,
          borderColor: colors.border,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* Icon */}
      <View style={[styles.iconWrap, { backgroundColor: `${accentColor}20` }]}>
        {isDone
          ? <IconSymbol name="checkmark.circle.fill" size={18} color={accentColor} />
          : isError
            ? <IconSymbol name="exclamationmark.triangle.fill" size={18} color={accentColor} />
            : <IconSymbol name="arrow.up.circle.fill" size={18} color={accentColor} />}
      </View>

      {/* Text + progress */}
      <View style={styles.body}>
        <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
          {isDone ? 'Post published!' : isError ? upload.error : upload.label}
        </Text>
        {upload.status === 'uploading' && (
          <View style={[styles.track, { backgroundColor: colors.backgroundSecondary }]}>
            <Animated.View
              style={[
                styles.fill,
                {
                  backgroundColor: ACCENT,
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        )}
        {upload.status === 'uploading' && (
          <Text style={[styles.pct, { color: colors.textSecondary }]}>
            {Math.round(upload.progress * 100)}%
          </Text>
        )}
      </View>

      {/* Dismiss */}
      {(isDone || isError) && (
        <TouchableOpacity onPress={dismissUpload} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <IconSymbol name="xmark" size={14} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 9999,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4 },
  label: { fontSize: 13, fontWeight: '700' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  pct: { fontSize: 10, fontWeight: '600' },
});
