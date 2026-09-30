// Theme colors - Light and Dark mode
export type ColorScheme = 'light' | 'dark';

export function getColors(colorScheme: 'light' | 'dark' = 'light') {
  if (colorScheme === 'dark') {
    return {
      // Dark theme colors.
      //
      // Depth in a dark UI comes from raising lightness as a surface comes forward:
      // page (darkest) → card → nested fill. Previously `card` was the exact same value as
      // `background` (both hsl(222, 39%, 11%)), so every card, sheet and band rendered as an
      // empty outline on the page. Measured contrast of card-to-page was 1.00:1.
      //
      // The ramp below keeps the brand navy as the page and steps surfaces up in even stages.
      // Measured: card→page 1.18:1, nested fill→page 1.31:1, border→page 1.78:1.
      background: 'hsl(222, 39%, 11%)',
      backgroundSecondary: 'hsl(222, 25%, 20%)',
      foreground: 'hsl(0, 0%, 98%)',
      text: 'hsl(0, 0%, 98%)',
      textSecondary: 'hsl(0, 0%, 75%)',
      textTertiary: 'hsl(0, 0%, 60%)',
      card: 'hsl(222, 30%, 17%)',
      cardBorder: 'hsl(222, 18%, 28%)',
      primary: 'hsl(35, 33%, 55%)',
      // White on this gold measured 2.90:1 — unreadable. Dark text on the same gold is 6.12:1,
      // which is the usual pairing for an amber control. Light theme keeps white (unchanged).
      primaryForeground: '#111827',
      primaryForegroundMuted: 'rgba(17, 24, 39, 0.62)',
      secondary: 'hsl(222, 30%, 17%)',
      accent: 'hsl(35, 33%, 55%)',
      muted: 'hsl(222, 25%, 20%)',
      destructive: 'hsl(0, 84.2%, 60.2%)',
      border: 'hsl(222, 18%, 28%)',
      success: '#34C759',
      warning: '#FF9500',
      error: 'hsl(0, 84.2%, 60.2%)',
      info: '#007AFF',
      white: '#FFFFFF',
      black: '#000000',
      // Gradient colors for dark theme
      gradientStart: 'hsl(222, 39%, 11%)',
      gradientEnd: 'hsl(222, 30%, 17%)',
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
    // Light theme keeps white on the gold primary, matching its existing appearance.
    primaryForeground: '#FFFFFF',
    primaryForegroundMuted: 'rgba(255, 255, 255, 0.72)',
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
