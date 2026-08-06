// Theme context for managing light/dark mode
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { appStorage } from '@/lib/storage/mmkv';
import { ColorScheme, getColors } from './colors';

const THEME_STORAGE_KEY = '@ikm_theme_preference';

function readStoredTheme(): ColorScheme | null {
  const saved = appStorage.getString(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return null;
}

function writeStoredTheme(scheme: ColorScheme) {
  appStorage.set(THEME_STORAGE_KEY, scheme);
}

// One-time migrate legacy AsyncStorage theme into MMKV.
void AsyncStorage.getItem(THEME_STORAGE_KEY)
  .then((saved) => {
    if ((saved === 'light' || saved === 'dark') && !appStorage.contains(THEME_STORAGE_KEY)) {
      appStorage.set(THEME_STORAGE_KEY, saved);
    }
  })
  .catch(() => {});

interface ThemeContextType {
  colorScheme: ColorScheme;
  colors: ReturnType<typeof getColors>;
  toggleTheme: () => void;
  setTheme: (scheme: ColorScheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => {
    return readStoredTheme() ?? ((systemScheme || 'light') as ColorScheme);
  });

  const toggleTheme = useCallback(() => {
    setColorScheme((prev: ColorScheme) => {
      const next = prev === 'light' ? 'dark' : 'light';
      writeStoredTheme(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((scheme: ColorScheme) => {
    setColorScheme(scheme);
    writeStoredTheme(scheme);
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
