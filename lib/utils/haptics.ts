// Haptic feedback utility for better UX
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export const haptics = {
  /**
   * Light impact feedback - for selection changes, switches
   */
  light: () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  },

  /**
   * Medium impact feedback - for button taps, card presses
   */
  medium: () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  },

  /**
   * Heavy impact feedback - for important actions, confirmations
   */
  heavy: () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  },

  /**
   * Success notification - for successful actions
   */
  success: () => {
    if (Platform.OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  },

  /**
   * Warning notification - for warnings
   */
  warning: () => {
    if (Platform.OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  },

  /**
   * Error notification - for errors
   */
  error: () => {
    if (Platform.OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  },

  /**
   * Selection feedback - for pickers, tabs
   */
  selection: () => {
    if (Platform.OS === 'ios') {
      Haptics.selectionAsync();
    }
  },
};

