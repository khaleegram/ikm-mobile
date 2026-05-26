import { Pressable, PressableProps, Animated, ViewStyle } from 'react-native';
import { ReactNode, useRef } from 'react';

interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
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
      tension: 150, // Faster tension
      friction: 5,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 150,
      friction: 5,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, animatedStyle]}>
      <Pressable
        {...props}
        style={style}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

