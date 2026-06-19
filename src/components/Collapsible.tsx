import { useEffect } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  expanded: boolean;
  children: React.ReactNode;
};

const DURATION_MS = 180;

export function Collapsible({ expanded, children }: Props) {
  const contentHeight = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: DURATION_MS,
      easing: Easing.bezier(0.33, 0, 0.2, 1),
    });
  }, [expanded, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: contentHeight.value * progress.value,
    opacity: Math.min(progress.value * 1.6, 1),
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0) {
      contentHeight.value = height;
    }
  };

  return (
    <Animated.View
      pointerEvents={expanded ? 'auto' : 'none'}
      style={[styles.clip, animatedStyle]}>
      <View collapsable={false} onLayout={handleLayout} style={styles.measure}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
});
