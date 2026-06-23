import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';

const THUMB_RADIUS = 14;
const VERTICAL_TRACK_HEIGHT = 100;
const DEFAULT_GESTURE_SENSITIVITY = 2;

type Props = {
  value: number;
  minimumValue: number;
  maximumValue: number;
  onValueChange: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  orientation?: 'horizontal' | 'vertical';
  snapPoints?: number[];
  showCenterTick?: boolean;
  stepCount?: number;
  gestureSensitivity?: number;
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

function quantizeToStepCount(value: number, min: number, max: number, stepCount: number): number {
  const step = (max - min) / stepCount;
  const steps = Math.round((value - min) / step);
  return clamp(min + steps * step, min, max);
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
  stepCount,
  gestureSensitivity = DEFAULT_GESTURE_SENSITIVITY,
}: Props) {
  const trackSize = useRef({ width: 1, height: 1 });
  const [laneHeight, setLaneHeight] = useState(VERTICAL_TRACK_HEIGHT);
  const startValue = useRef(value);
  const lastSnapped = useRef<number | null>(null);

  const valueRef = useRef(value);
  const minimumValueRef = useRef(minimumValue);
  const maximumValueRef = useRef(maximumValue);
  const snapPointsRef = useRef(snapPoints);
  const stepCountRef = useRef(stepCount);
  const gestureSensitivityRef = useRef(gestureSensitivity);
  const orientationRef = useRef(orientation);
  const onValueChangeRef = useRef(onValueChange);
  const onSlidingCompleteRef = useRef(onSlidingComplete);

  valueRef.current = value;
  minimumValueRef.current = minimumValue;
  maximumValueRef.current = maximumValue;
  snapPointsRef.current = snapPoints;
  stepCountRef.current = stepCount;
  gestureSensitivityRef.current = gestureSensitivity;
  orientationRef.current = orientation;
  onValueChangeRef.current = onValueChange;
  onSlidingCompleteRef.current = onSlidingComplete;

  const applyGesture = (gesture: PanResponderGestureState, isComplete: boolean) => {
    const { width, height } = trackSize.current;
    const min = minimumValueRef.current;
    const max = maximumValueRef.current;
    const range = max - min;
    let next: number;

    if (orientationRef.current === 'horizontal') {
      const deltaRatio = width > 0 ? gesture.dx / width : 0;
      next = startValue.current + deltaRatio * range;
    } else {
      const travel = Math.max(1, height - THUMB_RADIUS * 2);
      const deltaRatio = (-gesture.dy / travel) * gestureSensitivityRef.current;
      next = startValue.current + deltaRatio * range;
    }

    const points = snapPointsRef.current;
    next = clamp(next, min, max);
    const steps = stepCountRef.current;
    if (steps != null && steps > 0) {
      next = quantizeToStepCount(next, min, max, steps);
    }
    if (points.length > 0) {
      const snapped = snapValue(next, points);
      if (
        snapped !== lastSnapped.current &&
        points.some((point) => Math.abs(point - snapped) < 0.01)
      ) {
        lastSnapped.current = snapped;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      next = snapped;
    }

    onValueChangeRef.current(next);
    if (isComplete) {
      onSlidingCompleteRef.current?.(next);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startValue.current = valueRef.current;
        lastSnapped.current = null;
      },
      onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        applyGesture(gesture, false);
      },
      onPanResponderRelease: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        applyGesture(gesture, true);
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    trackSize.current = { width, height };
    if (orientationRef.current === 'vertical') {
      setLaneHeight(height);
    }
  };

  const ratio = (value - minimumValue) / (maximumValue - minimumValue);
  const isVertical = orientation === 'vertical';
  const thumbTravel = Math.max(0, laneHeight - THUMB_RADIUS * 2);
  const thumbTop = isVertical ? (1 - ratio) * thumbTravel : undefined;

  const sliderBody = (
    <>
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
            ? { top: thumbTop, alignSelf: 'center' }
            : {
                left: `${ratio * 100}%`,
                marginLeft: -THUMB_RADIUS,
                top: '50%',
                marginTop: -THUMB_RADIUS,
              },
        ]}
      />
    </>
  );

  return (
    <View
      accessibilityRole="adjustable"
      style={[styles.trackContainer, isVertical && styles.trackContainerVertical]}
      {...panResponder.panHandlers}>
      {isVertical ? (
        <View style={styles.trackLane} onLayout={handleLayout}>
          {sliderBody}
        </View>
      ) : (
        <View style={styles.trackLaneHorizontal} onLayout={handleLayout}>
          {sliderBody}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  trackContainer: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: THUMB_RADIUS,
  },
  trackContainerVertical: {
    width: 44,
    height: VERTICAL_TRACK_HEIGHT + THUMB_RADIUS * 2,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  trackLane: {
    height: VERTICAL_TRACK_HEIGHT,
    position: 'relative',
    alignSelf: 'center',
    width: '100%',
  },
  trackLaneHorizontal: {
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
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
    width: THUMB_RADIUS * 2,
    height: THUMB_RADIUS * 2,
    borderRadius: THUMB_RADIUS,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
