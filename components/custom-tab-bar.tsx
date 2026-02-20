import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useTheme } from '@/lib/theme/theme-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Dimensions, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const { width } = Dimensions.get('window');
const TAB_BAR_HEIGHT = 70;
const NOTCH_RADIUS = 35;
const CENTER_BUTTON_SIZE = 56;
const CENTER_BUTTON_OFFSET = 12;
const NOTCH_DEPTH = 22;
const lightBrown = '#A67C52';

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  // Unique gradient ID for this component instance
  const gradientId = useMemo(() => `barGradient-${Math.random().toString(36).substr(2, 9)}`, []);

  // Create SVG path for curved notch (concave top edge)
  const createNotchPath = () => {
    const barWidth = width;
    const barHeight = TAB_BAR_HEIGHT + insets.bottom;
    const notchCenterX = barWidth / 2;
    const notchTopY = TAB_BAR_HEIGHT - NOTCH_DEPTH;
    
    // Smooth parabolic curve using quadratic bezier
    // Start from left edge, curve down in center, back up to right edge
    const leftEdge = notchCenterX - NOTCH_RADIUS;
    const rightEdge = notchCenterX + NOTCH_RADIUS;
    
    return `
      M 0 0
      L 0 ${barHeight}
      L ${leftEdge} ${barHeight}
      Q ${notchCenterX} ${notchTopY} ${rightEdge} ${barHeight}
      L ${barWidth} ${barHeight}
      L ${barWidth} 0
      Z
    `;
  };

  // Detect if we're in Market Street or Seller tabs by checking route names
  const isMarketStreet = state.routes.some(
    (route) => route.name === 'search' || route.name === 'profile' || route.name === 'messages/index'
  );

  // Get visible tabs based on context
  let visibleTabs: Array<{ route: any; index: number; name: string }>;
  
  if (isMarketStreet) {
    // Market Street tabs: index, search, messages/index, profile
    const searchRoute = state.routes.find((r) => r.name === 'search');
    const messagesRoute = state.routes.find((r) => r.name === 'messages/index');
    const profileRoute = state.routes.find((r) => r.name === 'profile');
    
    visibleTabs = [
      { route: state.routes[0], index: 0, name: 'index' },
      searchRoute ? { route: searchRoute, index: searchRoute ? state.routes.indexOf(searchRoute) : 1, name: 'search' } : null,
      messagesRoute ? { route: messagesRoute, index: messagesRoute ? state.routes.indexOf(messagesRoute) : 2, name: 'messages/index' } : null,
      profileRoute ? { route: profileRoute, index: profileRoute ? state.routes.indexOf(profileRoute) : 3, name: 'profile' } : null,
    ].filter((tab): tab is { route: any; index: number; name: string } => tab !== null);
  } else {
    // Seller tabs: index, products, analytics, settings
    visibleTabs = [
      { route: state.routes[0], index: 0, name: 'index' },
      { route: state.routes[1], index: 1, name: 'products' },
      { route: state.routes[3], index: 3, name: 'analytics' }, // skip orders
      { route: state.routes[4], index: 4, name: 'settings' },
    ];
  }

  const handleTabPress = (route: any, routeIndex: number) => {
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });

    if (!event.defaultPrevented) {
      navigation.navigate(route.name);
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  };

  const handleCenterButtonPress = () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    // Route based on context: Market Street -> create-post, Seller -> products/new
    if (isMarketStreet) {
      router.push('/(market)/create-post' as any);
    } else {
      router.push('/products/new');
    }
  };

  const isRouteFocused = (routeKey: string) => {
    return state.routes[state.index]?.key === routeKey;
  };

  const totalHeight = TAB_BAR_HEIGHT + insets.bottom;

  return (
    <View style={[styles.container, { height: totalHeight }]}>
      {/* Background with SVG notch */}
      <View style={styles.backgroundContainer}>
        <Svg width={width} height={totalHeight} style={styles.svg}>
          <Defs>
            <LinearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={colors.card} stopOpacity="0.98" />
              <Stop offset="100%" stopColor={colors.card} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Path
            d={createNotchPath()}
            fill={`url(#${gradientId})`}
          />
        </Svg>
        
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={80}
            tint={colors.background === '#000000' ? 'dark' : 'light'}
            style={[StyleSheet.absoluteFillObject, styles.blur]}
          />
        )}
      </View>

      {/* Tab buttons container */}
      <View style={styles.tabsContainer}>
        {/* Left 2 tabs: Home, Products */}
        {visibleTabs.slice(0, 2).map(({ route, index }) => {
          const { options } = descriptors[route.key];
          const isFocused = isRouteFocused(route.key);
          const icon = options.tabBarIcon as any;

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              onPress={() => handleTabPress(route, index)}
              style={styles.tabButton}
            >
              {icon && icon({ 
                focused: isFocused, 
                color: isFocused ? colors.primary : colors.textSecondary, 
                size: 24 
              })}
            </TouchableOpacity>
          );
        })}

        {/* Center spacer for floating button */}
        <View style={styles.centerSpacer} />

        {/* Right 2 tabs: Analytics, Settings */}
        {visibleTabs.slice(2, 4).map(({ route, index }) => {
          const { options } = descriptors[route.key];
          const isFocused = isRouteFocused(route.key);
          const icon = options.tabBarIcon as any;

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              onPress={() => handleTabPress(route, index)}
              style={styles.tabButton}
            >
              {icon && icon({ 
                focused: isFocused, 
                color: isFocused ? colors.primary : colors.textSecondary, 
                size: 24 
              })}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Floating Center Button - Exact style from products page */}
      <TouchableOpacity
        style={[
          styles.centerButton,
          {
            backgroundColor: lightBrown,
            bottom: TAB_BAR_HEIGHT - (CENTER_BUTTON_SIZE / 2) - CENTER_BUTTON_OFFSET + (insets.bottom / 2),
          },
        ]}
        onPress={handleCenterButtonPress}
        activeOpacity={0.8}
      >
        <IconSymbol name="plus.circle.fill" size={20} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  backgroundContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  svg: {
    position: 'absolute',
    bottom: 0,
  },
  blur: {
    opacity: 0.9,
  },
  tabsContainer: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  centerSpacer: {
    width: CENTER_BUTTON_SIZE + 16,
  },
  centerButton: {
    position: 'absolute',
    left: (width - CENTER_BUTTON_SIZE) / 2,
    width: CENTER_BUTTON_SIZE,
    height: CENTER_BUTTON_SIZE,
    borderRadius: CENTER_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    ...premiumShadow,
  },
});

