// Animated list item component
import { Animated, ViewStyle } from 'react-native';
import { useEffect, useRef, ReactNode } from 'react';

interface AnimatedListItemProps {
  children: ReactNode;
  index: number;
  style?: ViewStyle;
}

export function AnimatedListItem({ children, index, style }: AnimatedListItemProps) {
  const itemAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(itemAnim, {
      toValue: 1,
      duration: 300,
      delay: index * 50,
      useNativeDriver: true,
    }).start();
  }, [index]);

  return (
    <Animated.View
      style={[
        {
          opacity: itemAnim,
          transform: [
            {
              translateY: itemAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

