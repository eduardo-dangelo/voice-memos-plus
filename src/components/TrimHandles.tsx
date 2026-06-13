import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';

type Props = {
  duration: number;
  trimStart: number;
  trimEnd: number;
  width: number;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
};

const HANDLE_WIDTH = 14;
const MIN_SELECTION = 0.25;

export function TrimHandles({ duration, trimStart, trimEnd, width, onTrimChange }: Props) {
  const startX = useSharedValue(0);
  const endX = useSharedValue(width);
  const effectiveEnd = trimEnd > 0 ? trimEnd : duration;

  useEffect(() => {
    if (width <= 0 || duration <= 0) {
      return;
    }
    startX.value = (trimStart / duration) * width;
    endX.value = (effectiveEnd / duration) * width;
  }, [duration, effectiveEnd, trimStart, width, startX, endX]);

  const updateTrim = (nextStart: number, nextEnd: number) => {
    onTrimChange(nextStart, nextEnd);
  };

  const startGesture = Gesture.Pan().onChange((event) => {
    const minDistance = (MIN_SELECTION / duration) * width;
    const next = Math.max(0, Math.min(endX.value - minDistance, startX.value + event.changeX));
    startX.value = next;
    const nextStart = (next / width) * duration;
    runOnJS(updateTrim)(nextStart, effectiveEnd);
  });

  const endGesture = Gesture.Pan().onChange((event) => {
    const minDistance = (MIN_SELECTION / duration) * width;
    const next = Math.min(width, Math.max(startX.value + minDistance, endX.value + event.changeX));
    endX.value = next;
    const nextEnd = (next / width) * duration;
    runOnJS(updateTrim)(trimStart, nextEnd);
  });

  const startStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: startX.value - HANDLE_WIDTH / 2 }],
  }));

  const endStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: endX.value - HANDLE_WIDTH / 2 }],
  }));

  if (duration <= 0 || width <= 0) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={[styles.container, { width }]}>
      <GestureDetector gesture={startGesture}>
        <Animated.View style={[styles.handle, startStyle]}>
          <View style={styles.handleBar} />
        </Animated.View>
      </GestureDetector>
      <GestureDetector gesture={endGesture}>
        <Animated.View style={[styles.handle, endStyle]}>
          <View style={styles.handleBar} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handleBar: {
    width: 4,
    height: '70%',
    borderRadius: 2,
    backgroundColor: VoiceMemosColors.accent,
  },
});
