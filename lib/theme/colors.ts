// Theme colors - Light and Dark mode
export type ColorScheme = 'light' | 'dark';

export function getColors(colorScheme: 'light' | 'dark' = 'light') {
  if (colorScheme === 'dark') {
    return {
      // Dark theme colors
      background: 'hsl(222, 39%, 11%)',
      backgroundSecondary: 'hsl(240, 3.7%, 15.9%)',
      foreground: 'hsl(0, 0%, 98%)',
      text: 'hsl(0, 0%, 98%)',
      textSecondary: 'hsl(0, 0%, 75%)',
      textTertiary: 'hsl(0, 0%, 60%)',
      card: 'hsl(222, 39%, 11%)',
      cardBorder: 'hsl(240, 3.7%, 15.9%)',
      primary: 'hsl(35, 33%, 55%)',
      secondary: 'hsl(240, 3.7%, 15.9%)',
      accent: 'hsl(35, 33%, 55%)',
      muted: 'hsl(240, 3.7%, 15.9%)',
      destructive: 'hsl(0, 84.2%, 60.2%)',
      border: 'hsl(240, 3.7%, 15.9%)',
      success: '#34C759',
      warning: '#FF9500',
      error: 'hsl(0, 84.2%, 60.2%)',
      info: '#007AFF',
      white: '#FFFFFF',
      black: '#000000',
      // Gradient colors for dark theme
      gradientStart: 'hsl(222, 39%, 11%)',
      gradientEnd: 'hsl(240, 3.7%, 15.9%)',
    };
  }

  // Light theme colors
  return {
    background: 'hsl(240, 5.3%, 94.9%)',
    backgroundSecondary: 'hsl(210, 40%, 96.1%)',
    foreground: 'hsl(224, 71.4%, 4.1%)',
    text: 'hsl(224, 71.4%, 4.1%)',
    textSecondary: 'hsl(224, 20%, 40%)',
    textTertiary: 'hsl(224, 10%, 60%)',
    card: 'hsl(0, 0%, 100%)',
    cardBorder: 'hsl(214.3, 31.8%, 91.4%)',
    primary: 'hsl(35, 33%, 45%)',
    secondary: 'hsl(210, 40%, 96.1%)',
    accent: 'hsl(35, 33%, 55%)',
    muted: 'hsl(210, 40%, 96.1%)',
    destructive: 'hsl(0, 84.2%, 60.2%)',
    border: 'hsl(214.3, 31.8%, 91.4%)',
    success: '#34C759',
    warning: '#FF9500',
    error: 'hsl(0, 84.2%, 60.2%)',
    info: '#007AFF',
    white: '#FFFFFF',
    black: '#000000',
    // Gradient colors for light theme
    gradientStart: 'hsl(240, 5.3%, 94.9%)',
    gradientEnd: 'hsl(210, 40%, 96.1%)',
  };
}
