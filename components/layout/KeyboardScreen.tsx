import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type KeyboardAwareModule = {
  KeyboardAwareScrollView?: React.ComponentType<any>;
};

let keyboardAwareModule: KeyboardAwareModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  keyboardAwareModule = require('react-native-keyboard-aware-scroll-view');
} catch {
  keyboardAwareModule = null;
}

const KeyboardAwareScrollView = keyboardAwareModule?.KeyboardAwareScrollView;
const HAS_KEYBOARD_AWARE = Boolean(KeyboardAwareScrollView);

type KeyboardScreenProps = {
  children: React.ReactNode;
  extraScrollHeight?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  keyboardVerticalOffset?: number;
  keyboardShouldPersistTaps?: 'always' | 'handled' | 'never';
  showsVerticalScrollIndicator?: boolean;
};

export default function KeyboardScreen({
  children,
  extraScrollHeight = 24,
  contentContainerStyle,
  style,
  keyboardVerticalOffset,
  keyboardShouldPersistTaps = 'always',
  showsVerticalScrollIndicator = false,
}: KeyboardScreenProps) {
  const insets = useSafeAreaInsets();
  const verticalOffset = keyboardVerticalOffset ?? insets.top;
  // Option A behavior: when the package exists, use KeyboardAwareScrollView;
  // otherwise fall back to ScrollView + KeyboardAvoidingView.
  const ScrollComponent = (HAS_KEYBOARD_AWARE ? KeyboardAwareScrollView : ScrollView) as React.ComponentType<any>;

  const keyboardAwareProps = HAS_KEYBOARD_AWARE
    ? {
        enableOnAndroid: true,
        extraScrollHeight,
        keyboardOpeningTime: Platform.OS === 'android' ? 0 : 250,
      }
    : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={verticalOffset}>
      <ScrollComponent
        style={styles.container}
        contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        {...keyboardAwareProps}>
        {children}
      </ScrollComponent>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    paddingBottom: 40,
  },
});
