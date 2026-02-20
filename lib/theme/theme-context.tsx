// Theme context for managing light/dark mode
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorScheme, getColors } from './colors';

const THEME_STORAGE_KEY = '@ikm_theme_preference';

interface ThemeContextType {
  colorScheme: ColorScheme;
  colors: ReturnType<typeof getColors>;
  toggleTheme: () => void;
  setTheme: (scheme: ColorScheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [colorScheme, setColorScheme] = useState<ColorScheme>(
    (systemScheme || 'light') as ColorScheme
  );

  useEffect(() => {
    // Load saved theme preference
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') {
        setColorScheme(saved);
      } else if (systemScheme) {
        setColorScheme(systemScheme as ColorScheme);
      }
    });
  }, [systemScheme]);

  const toggleTheme = useCallback(() => {
    setColorScheme((prev: ColorScheme) => {
      const next = prev === 'light' ? 'dark' : 'light';
      AsyncStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setTheme = useCallback((scheme: ColorScheme) => {
    setColorScheme(scheme);
    AsyncStorage.setItem(THEME_STORAGE_KEY, scheme);
  }, []);

  const colors = useMemo(() => getColors(colorScheme), [colorScheme]);

  const value = useMemo(() => {
    return { colorScheme, colors, toggleTheme, setTheme };
  }, [colorScheme, colors, toggleTheme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

