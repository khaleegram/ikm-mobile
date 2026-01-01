// Theme toggle button component
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { IconSymbol } from './ui/icon-symbol';

export function ThemeToggle() {
  const { colorScheme, toggleTheme, colors } = useTheme();
  const isDark = colorScheme === 'dark';

  return (
    <TouchableOpacity
      style={[styles.toggle, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}
      onPress={toggleTheme}
      activeOpacity={0.7}>
      <IconSymbol 
        name={isDark ? "sun.max.fill" : "moon.fill"} 
        size={20} 
        color="#FFFFFF" 
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
  },
});

