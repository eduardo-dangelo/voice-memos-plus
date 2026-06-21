import * as Haptics from 'expo-haptics';
import { useCallback, useRef } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';

type Props = {
  value: number;
  minimumValue: number;
  maximumValue: number;
  onValueChange: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  orientation?: 'horizontal' | 'vertical';
  snapPoints?: number[];
  showCenterTick?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapValue(value: number, snapPoints: number[]): number {
  let closest = value;
  let closestDistance = Infinity;
  for (const point of snapPoints) {
    const distance = Math.abs(point - value);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = point;
    }
  }
  if (closestDistance <= Math.abs(maximumSpan(snapPoints)) * 0.05) {
    return closest;
  }
  return value;
}

function maximumSpan(snapPoints: number[]): number {
  if (snapPoints.length < 2) {
    return 1;
  }
  return Math.max(...snapPoints) - Math.min(...snapPoints);
}

export function EditorSlider({
  value,
  minimumValue,
  maximumValue,
  onValueChange,
  onSlidingComplete,
  orientation = 'horizontal',
  snapPoints = [],
  showCenterTick = false,
}: Props) {
  const trackSize = useRef({ width: 1, height: 1 });
  const startValue = useRef(value);
  const lastSnapped = useRef<number | null>(null);

  const ratioToValue = useCallback(
    (ratio: number) => {
      const raw = minimumValue + clamp(ratio, 0, 1) * (maximumValue - minimumValue);
      if (snapPoints.length === 0) {
        return raw;
      }
      const snapped = snapValue(raw, snapPoints);
      if (snapped !== lastSnapped.current && snapPoints.some((point) => Math.abs(point - snapped) < 0.01)) {
        lastSnapped.current = snapped;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      return snapped;
    },
    [maximumValue, minimumValue, snapPoints]
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    trackSize.current = event.nativeEvent.layout;
  };

  const updateFromGesture = (
    gesture: PanResponderGestureState,
    isComplete: boolean
  ) => {
    const { width, height } = trackSize.current;
    const range = maximumValue - minimumValue;
    let next: number;

    if (orientation === 'horizontal') {
      const deltaRatio = width > 0 ? gesture.dx / width : 0;
      next = startValue.current + deltaRatio * range;
    } else {
      const deltaRatio = height > 0 ? -gesture.dy / height : 0;
      next = startValue.current + deltaRatio * range;
    }

    next = clamp(next, minimumValue, maximumValue);
    if (snapPoints.length > 0) {
      next = snapValue(next, snapPoints);
    }
    onValueChange(next);
    if (isComplete) {
      onSlidingComplete?.(next);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startValue.current = value;
        lastSnapped.current = null;
      },
      onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        updateFromGesture(gesture, false);
      },
      onPanResponderRelease: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        updateFromGesture(gesture, true);
      },
    })
  ).current;

  const ratio = (value - minimumValue) / (maximumValue - minimumValue);
  const isVertical = orientation === 'vertical';

  return (
    <View
      accessibilityRole="adjustable"
      onLayout={handleLayout}
      style={[styles.trackContainer, isVertical && styles.trackContainerVertical]}
      {...panResponder.panHandlers}>
      <View style={[styles.track, isVertical && styles.trackVertical]}>
        {showCenterTick ? (
          <View
            style={[
              styles.centerTick,
              isVertical ? styles.centerTickVertical : styles.centerTickHorizontal,
            ]}
          />
        ) : null}
        <View
          style={[
            styles.fill,
            isVertical
              ? { height: `${ratio * 100}%`, width: '100%' }
              : { width: `${ratio * 100}%`, height: '100%' },
          ]}
        />
      </View>
      <View
        style={[
          styles.thumb,
          isVertical
            ? { top: `${(1 - ratio) * 100}%`, marginTop: -14, alignSelf: 'center' }
            : { left: `${ratio * 100}%`, marginLeft: -14, top: -10 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trackContainer: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  trackContainerVertical: {
    width: 44,
    height: 100,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'flex-end',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: VoiceMemosColors.waveformInactive,
    overflow: 'hidden',
    position: 'relative',
  },
  trackVertical: {
    width: 4,
    height: '100%',
    alignSelf: 'center',
  },
  centerTick: {
    position: 'absolute',
    backgroundColor: VoiceMemosColors.secondaryText,
    opacity: 0.4,
    zIndex: 1,
  },
  centerTickHorizontal: {
    left: '50%',
    width: 1,
    height: '100%',
    marginLeft: -0.5,
  },
  centerTickVertical: {
    top: '50%',
    height: 1,
    width: '100%',
    marginTop: -0.5,
  },
  fill: {
    backgroundColor: VoiceMemosColors.accent,
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
  thumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
