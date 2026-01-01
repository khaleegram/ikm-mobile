// Enhanced pressable component with smooth animations
import { TouchableOpacity, TouchableOpacityProps, Animated, ViewStyle } from 'react-native';
import { ReactNode, useRef, useEffect } from 'react';

interface AnimatedPressableProps extends Omit<TouchableOpacityProps, 'style'> {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  scaleValue?: number;
  animatedStyle?: ViewStyle;
}

export function AnimatedPressable({
  children,
  style,
  scaleValue = 0.95,
  animatedStyle,
  onPressIn,
  onPressOut,
  ...props
}: AnimatedPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: any) => {
    Animated.spring(scale, {
      toValue: scaleValue,
      useNativeDriver: true,
      friction: 3,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 3,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, animatedStyle]}>
      <TouchableOpacity
        {...props}
        style={style}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

