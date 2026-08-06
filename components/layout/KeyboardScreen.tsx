import React from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type KeyboardScreenProps = {
  children: React.ReactNode;
  /** Extra space kept above the keyboard for the focused field / CTA. */
  extraScrollHeight?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  /** @deprecated Unused — kept for call-site compatibility. */
  keyboardVerticalOffset?: number;
  keyboardShouldPersistTaps?: 'always' | 'handled' | 'never';
  showsVerticalScrollIndicator?: boolean;
};

/**
 * Form scroll container that keeps focused inputs above the keyboard.
 * Uses `react-native-keyboard-controller` (project standard) — not the legacy
 * `react-native-keyboard-aware-scroll-view` package.
 */
export default function KeyboardScreen({
  children,
  extraScrollHeight = 24,
  contentContainerStyle,
  style,
  keyboardShouldPersistTaps = 'handled',
  showsVerticalScrollIndicator = false,
}: KeyboardScreenProps) {
  return (
    <KeyboardAwareScrollView
      style={[styles.container, style]}
      contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode="on-drag"
      bottomOffset={extraScrollHeight}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}>
      {children}
    </KeyboardAwareScrollView>
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
