// Offline indicator component
import { useOfflineSync } from '@/lib/hooks/use-offline-sync';
import { StyleSheet, Text, View } from 'react-native';

export function OfflineIndicator() {
  const { isOnline, queuedWrites } = useOfflineSync();

  if (isOnline) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        Offline {queuedWrites.length > 0 && `• ${queuedWrites.length} pending`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFC107',
    padding: 8,
    alignItems: 'center',
  },
  text: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
});

