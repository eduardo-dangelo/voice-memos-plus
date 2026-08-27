import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export const PROCESSING_BAR_HEIGHT = 2;
const SEGMENT_FRACTION = 0.35;
const CYCLE_MS = 1200;
const SEGMENT_OPACITY = 0.38;
const TRACK_OPACITY = 0.35;

type Props = {
  width: number;
};

export function ProcessingProgressBar({ width }: Props) {
  const colors = useVoiceMemosColors();
  const progress = useSharedValue(0);
  const segmentColor = useMemo(
    () => applyOpacity(colors.secondaryText, SEGMENT_OPACITY),
    [colors.secondaryText]
  );
  const trackColor = useMemo(
    () => applyOpacity(colors.waveformInactive, TRACK_OPACITY),
    [colors.waveformInactive]
  );

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  const segmentWidth = Math.max(width * SEGMENT_FRACTION, 24);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * Math.max(0, width - segmentWidth) }],
    width: segmentWidth,
  }));

  if (width <= 0) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={[
        styles.track,
        { width, height: PROCESSING_BAR_HEIGHT, backgroundColor: trackColor },
      ]}>
      <Animated.View
        style={[styles.segment, { backgroundColor: segmentColor }, animatedStyle]}
      />
    </View>
  );
}

function applyOpacity(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '');
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  if (value.length !== 6) {
    return hex;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
  },
  segment: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 1,
  },
});
