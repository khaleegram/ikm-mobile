// Loading overlay component
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message }: LoadingOverlayProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.overlay, { backgroundColor: colors.background + 'E6' }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      {message && (
        <View style={styles.messageContainer}>
          <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  messageContainer: {
    marginTop: 16,
  },
  message: {
    fontSize: 16,
    fontWeight: '600',
  },
});

