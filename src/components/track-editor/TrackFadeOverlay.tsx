import { useEffect, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colorWithAlpha } from '@/constants/VoiceMemosColors';
import {
  buildFadeSvgPath,
  clampFadeCurve,
  clampFadeValues,
  MIN_FADE_SEC,
} from '@/src/audio/fadeCurve';
import { snapTimeToGrid } from '@/src/audio/loopSnap';
import {
  LOOP_EXPAND_DURATION_MS,
  LOOP_EXPAND_EASING,
} from '@/src/components/LoopRegionBar';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

type FadeScrollHelpers = {
  getScrollX: () => number;
  autoScrollForContentX: (contentX: number) => void;
  onTrimGestureActive: (active: boolean) => void;
};

const FADE_HANDLE_TOUCH = 44;
const FADE_HANDLE_TOUCH_EXPANDED = 56;
const FADE_CURVE_HANDLE = 28;
const FADE_LENGTH_KNOB = 8;
const FADE_TAP_MOVE_THRESHOLD = 6;
const FADE_EXPAND_IDLE_MS = 3000;

export type FadeRegionState = {
  fadeInSec: number;
  fadeOutSec: number;
  fadeInCurve: number;
  fadeOutCurve: number;
};

export type FadeOverlayConfig = {
  layerId: string;
  fades: FadeRegionState;
  onChange: (next: FadeRegionState) => void;
  /** When false, fade curves stay visible but length/curve handles are hidden. Defaults to true. */
  editable?: boolean;
  snapIntervalSec?: number | null;
  peerFades?: Array<{ layerId: string } & FadeRegionState>;
  crossfade?: {
    outgoingLayerId: string;
    incomingLayerId: string;
    overlapStart: number;
    overlapEnd: number;
    linked: boolean;
  } | null;
  onCrossfadeChange?: (durationSec: number, curve: number) => void;
};

type TrackLike = {
  id: string;
  startTime: number;
  duration: number;
  /** One keep-region cycle; fades clamp to this when looping. */
  cycleDuration?: number;
  color?: string;
};

type Props = {
  track: TrackLike;
  sidePadding: number;
  trackHeight: number;
  /** Top inset for the waveform body (region header height). */
  bodyTop?: number;
  /** Height of the waveform body; defaults to trackHeight - bodyTop. */
  bodyHeight?: number;
  pixelsPerSecond: number;
  layoutDuration: number;
  fades: FadeRegionState;
  editable: boolean;
  snapIntervalSec?: number | null;
  onChange?: (next: FadeRegionState) => void;
  crossfade?: FadeOverlayConfig['crossfade'];
  onCrossfadeChange?: (durationSec: number, curve: number) => void;
  trimScrollHelpers: FadeScrollHelpers;
};

function curveHandleSampleT(curve: number): number {
  return Math.max(0.18, Math.min(0.82, 0.5 - curve * 0.35));
}

function curveHandlePosition(
  originX: number,
  fadeWidth: number,
  bodyTop: number,
  bodyHeight: number,
  curve: number
): { left: number; top: number } {
  const t = curveHandleSampleT(curve);
  return {
    left: originX + fadeWidth * t - FADE_CURVE_HANDLE / 2,
    // Fixed vertical center of the waveform body — knob only travels sideways.
    top: bodyTop + (bodyHeight - FADE_CURVE_HANDLE) / 2,
  };
}

export function TrackFadeOverlay({
  track,
  sidePadding,
  trackHeight,
  bodyTop = 0,
  bodyHeight,
  pixelsPerSecond,
  layoutDuration,
  fades,
  editable,
  snapIntervalSec,
  onChange,
  crossfade,
  onCrossfadeChange,
  trimScrollHelpers,
}: Props) {
  const colors = useVoiceMemosColors();
  const accent = track.color ?? colors.accent;
  const resolvedBodyHeight = bodyHeight ?? Math.max(0, trackHeight - bodyTop);
  const trackLeft = sidePadding + track.startTime * pixelsPerSecond;
  const trackWidth = Math.max(0, track.duration * pixelsPerSecond);
  const fadeInWidth = Math.max(0, fades.fadeInSec * pixelsPerSecond);
  const fadeOutWidth = Math.max(0, fades.fadeOutSec * pixelsPerSecond);
  const fadeInPath = buildFadeSvgPath(
    fadeInWidth,
    resolvedBodyHeight,
    fades.fadeInCurve,
    'in'
  );
  const fadeOutPath = buildFadeSvgPath(
    fadeOutWidth,
    resolvedBodyHeight,
    fades.fadeOutCurve,
    'out'
  );
  const fillColor = colorWithAlpha(accent, 0.12);
  const strokeColor = colorWithAlpha(accent, 0.55);

  const startFades = useRef(fades);
  const scrollXAtGrant = useRef(0);
  const dragActiveRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onCrossfadeChangeRef = useRef(onCrossfadeChange);
  const helpersRef = useRef(trimScrollHelpers);
  const trackRef = useRef(track);
  const ppsRef = useRef(pixelsPerSecond);
  const layoutDurationRef = useRef(layoutDuration);
  const snapRef = useRef(snapIntervalSec);
  const fadesRef = useRef(fades);
  const crossfadeRef = useRef(crossfade);
  onChangeRef.current = onChange;
  onCrossfadeChangeRef.current = onCrossfadeChange;
  helpersRef.current = trimScrollHelpers;
  trackRef.current = track;
  ppsRef.current = pixelsPerSecond;
  layoutDurationRef.current = layoutDuration;
  snapRef.current = snapIntervalSec;
  fadesRef.current = fades;
  crossfadeRef.current = crossfade;

  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchSV = useSharedValue(FADE_HANDLE_TOUCH);
  useEffect(() => {
    handleTouchSV.value = withTiming(
      expanded ? FADE_HANDLE_TOUCH_EXPANDED : FADE_HANDLE_TOUCH,
      { duration: LOOP_EXPAND_DURATION_MS, easing: LOOP_EXPAND_EASING }
    );
  }, [expanded, handleTouchSV]);

  const clearIdleTimer = () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const scheduleIdleCollapse = () => {
    clearIdleTimer();
    if (!expandedRef.current) {
      return;
    }
    idleTimerRef.current = setTimeout(() => setExpanded(false), FADE_EXPAND_IDLE_MS);
  };

  const expandHandles = () => {
    setExpanded(true);
    scheduleIdleCollapse();
  };

  useEffect(() => {
    if (expanded) {
      scheduleIdleCollapse();
    } else {
      clearIdleTimer();
    }
    return clearIdleTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduleIdleCollapse uses refs
  }, [expanded]);

  const beginGesture = () => {
    dragActiveRef.current = false;
    scrollXAtGrant.current = helpersRef.current.getScrollX();
    startFades.current = fadesRef.current;
    helpersRef.current.onTrimGestureActive(true);
  };

  const endGesture = (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
    const movement = Math.abs(gesture.dx) + Math.abs(gesture.dy);
    const isTap = !dragActiveRef.current && movement < FADE_TAP_MOVE_THRESHOLD;
    helpersRef.current.onTrimGestureActive(false);
    if (isTap) {
      setExpanded((prev) => !prev);
      return;
    }
    expandHandles();
  };

  const getEffectiveDx = (gesture: PanResponderGestureState): number =>
    gesture.dx + (helpersRef.current.getScrollX() - scrollXAtGrant.current);

  const ensureDragActive = (gesture: PanResponderGestureState) => {
    if (dragActiveRef.current) {
      return true;
    }
    if (Math.abs(gesture.dx) + Math.abs(gesture.dy) < FADE_TAP_MOVE_THRESHOLD) {
      return false;
    }
    dragActiveRef.current = true;
    expandHandles();
    return true;
  };

  const snapDuration = (seconds: number): number => {
    const interval = snapRef.current;
    if (interval == null || !(interval > 0)) {
      return seconds;
    }
    return Math.max(0, snapTimeToGrid(seconds, interval, layoutDurationRef.current));
  };

  const emitFades = (next: FadeRegionState) => {
    const trackSnapshot = trackRef.current;
    const clampDuration = Math.max(
      0,
      trackSnapshot.cycleDuration ?? trackSnapshot.duration
    );
    const clamped = clampFadeValues(
      next.fadeInSec,
      next.fadeOutSec,
      next.fadeInCurve,
      next.fadeOutCurve,
      clampDuration
    );
    onChangeRef.current?.(clamped);
  };

  const fadeInLengthMove = useRef(
    (_event: GestureResponderEvent, _gesture: PanResponderGestureState) => {}
  );
  fadeInLengthMove.current = (_event, gesture) => {
    if (!editable || !ensureDragActive(gesture)) {
      return;
    }
    if (expandedRef.current) {
      scheduleIdleCollapse();
    }
    const pps = ppsRef.current;
    const dx = getEffectiveDx(gesture);
    helpersRef.current.autoScrollForContentX(trackLeft + startFades.current.fadeInSec * pps + dx);
    const raw = snapDuration(startFades.current.fadeInSec + dx / pps);
    emitFades({
      ...startFades.current,
      fadeInSec: Math.max(0, raw < MIN_FADE_SEC / 2 ? 0 : raw),
    });
  };

  const fadeOutLengthMove = useRef(
    (_event: GestureResponderEvent, _gesture: PanResponderGestureState) => {}
  );
  fadeOutLengthMove.current = (_event, gesture) => {
    if (!editable || !ensureDragActive(gesture)) {
      return;
    }
    if (expandedRef.current) {
      scheduleIdleCollapse();
    }
    const pps = ppsRef.current;
    const dx = getEffectiveDx(gesture);
    // Dragging right edge of fade-out handle leftward increases fade-out.
    helpersRef.current.autoScrollForContentX(
      trackLeft + trackRef.current.duration * pps - startFades.current.fadeOutSec * pps + dx
    );
    const raw = snapDuration(startFades.current.fadeOutSec - dx / pps);
    emitFades({
      ...startFades.current,
      fadeOutSec: Math.max(0, raw < MIN_FADE_SEC / 2 ? 0 : raw),
    });
  };

  const fadeInCurveMove = useRef(
    (_event: GestureResponderEvent, _gesture: PanResponderGestureState) => {}
  );
  fadeInCurveMove.current = (_event, gesture) => {
    if (!editable || !ensureDragActive(gesture)) {
      return;
    }
    if (expandedRef.current) {
      scheduleIdleCollapse();
    }
    // Horizontal only — vertical conflicts with the bottom sheet.
    // Drag right → bows curve down.
    const dx = getEffectiveDx(gesture);
    const nextCurve = clampFadeCurve(startFades.current.fadeInCurve - dx / 80);
    emitFades({ ...startFades.current, fadeInCurve: nextCurve });
  };

  const fadeOutCurveMove = useRef(
    (_event: GestureResponderEvent, _gesture: PanResponderGestureState) => {}
  );
  fadeOutCurveMove.current = (_event, gesture) => {
    if (!editable || !ensureDragActive(gesture)) {
      return;
    }
    if (expandedRef.current) {
      scheduleIdleCollapse();
    }
    // Drag left (toward clip center) → bows curve down.
    const dx = getEffectiveDx(gesture);
    const nextCurve = clampFadeCurve(startFades.current.fadeOutCurve + dx / 80);
    emitFades({ ...startFades.current, fadeOutCurve: nextCurve });
  };

  const crossfadeMove = useRef(
    (_event: GestureResponderEvent, _gesture: PanResponderGestureState) => {}
  );
  crossfadeMove.current = (_event, gesture) => {
    const zone = crossfadeRef.current;
    if (!editable || !zone || !onCrossfadeChangeRef.current || !ensureDragActive(gesture)) {
      return;
    }
    if (expandedRef.current) {
      scheduleIdleCollapse();
    }
    const pps = ppsRef.current;
    const dx = getEffectiveDx(gesture);
    const overlapDuration = Math.max(0, zone.overlapEnd - zone.overlapStart);
    const startDuration = Math.min(
      overlapDuration,
      Math.max(fadesRef.current.fadeOutSec, fadesRef.current.fadeInSec)
    );
    const raw = snapDuration(startDuration + dx / pps);
    const duration = Math.max(0, Math.min(overlapDuration, raw));
    const curve = clampFadeCurve(fadesRef.current.fadeInCurve);
    onCrossfadeChangeRef.current(duration, curve);
  };

  const panCapture = {
    onStartShouldSetPanResponder: () => editable,
    onStartShouldSetPanResponderCapture: () => editable,
    onMoveShouldSetPanResponder: () => editable,
    onMoveShouldSetPanResponderCapture: () => editable,
    onPanResponderTerminationRequest: () => false,
  };

  const makeResponder = (
    moveRef: typeof fadeInLengthMove
  ) =>
    PanResponder.create({
      ...panCapture,
      onPanResponderGrant: () => beginGesture(),
      onPanResponderMove: (event, gesture) => moveRef.current(event, gesture),
      onPanResponderRelease: (event, gesture) => endGesture(event, gesture),
      onPanResponderTerminate: (event, gesture) => endGesture(event, gesture),
    });

  const fadeInLengthResponder = useRef(makeResponder(fadeInLengthMove)).current;
  const fadeOutLengthResponder = useRef(makeResponder(fadeOutLengthMove)).current;
  const fadeInCurveResponder = useRef(makeResponder(fadeInCurveMove)).current;
  const fadeOutCurveResponder = useRef(makeResponder(fadeOutCurveMove)).current;
  const crossfadeResponder = useRef(makeResponder(crossfadeMove)).current;

  const fadeInHandleStyle = useAnimatedStyle(() => ({
    width: handleTouchSV.value,
    left: trackLeft + fadeInWidth - handleTouchSV.value / 2,
    top: bodyTop,
    height: resolvedBodyHeight,
  }));

  const fadeOutHandleStyle = useAnimatedStyle(() => ({
    width: handleTouchSV.value,
    left: trackLeft + trackWidth - fadeOutWidth - handleTouchSV.value / 2,
    top: bodyTop,
    height: resolvedBodyHeight,
  }));

  const isCrossfadeLane =
    crossfade != null &&
    (crossfade.outgoingLayerId === track.id || crossfade.incomingLayerId === track.id);
  const crossfadeLeft = crossfade
    ? sidePadding + crossfade.overlapStart * pixelsPerSecond
    : 0;
  const crossfadeWidth = crossfade
    ? Math.max(0, (crossfade.overlapEnd - crossfade.overlapStart) * pixelsPerSecond)
    : 0;
  const showCrossfadeZone = isCrossfadeLane && crossfadeWidth > 4;
  const showCrossfadeHandle =
    editable && showCrossfadeZone && onCrossfadeChange != null;

  const fadeInCurvePos = curveHandlePosition(
    trackLeft,
    fadeInWidth,
    bodyTop,
    resolvedBodyHeight,
    fades.fadeInCurve
  );
  const fadeOutCurvePos = curveHandlePosition(
    trackLeft + trackWidth - fadeOutWidth,
    fadeOutWidth,
    bodyTop,
    resolvedBodyHeight,
    fades.fadeOutCurve
  );

  return (
    <>
      {fadeInWidth > 1 ? (
        <View
          pointerEvents="none"
          style={[
            styles.fadeRegion,
            {
              left: trackLeft,
              top: bodyTop,
              width: fadeInWidth,
              height: resolvedBodyHeight,
            },
          ]}>
          <Svg width={fadeInWidth} height={resolvedBodyHeight}>
            <Path d={fadeInPath} fill={fillColor} stroke={strokeColor} strokeWidth={1.5} />
          </Svg>
        </View>
      ) : null}
      {fadeOutWidth > 1 ? (
        <View
          pointerEvents="none"
          style={[
            styles.fadeRegion,
            {
              left: trackLeft + trackWidth - fadeOutWidth,
              top: bodyTop,
              width: fadeOutWidth,
              height: resolvedBodyHeight,
            },
          ]}>
          <Svg width={fadeOutWidth} height={resolvedBodyHeight}>
            <Path d={fadeOutPath} fill={fillColor} stroke={strokeColor} strokeWidth={1.5} />
          </Svg>
        </View>
      ) : null}

      {showCrossfadeZone ? (
        <View
          pointerEvents="none"
          style={[
            styles.crossfadeZone,
            {
              left: crossfadeLeft,
              top: bodyTop,
              width: crossfadeWidth,
              height: resolvedBodyHeight,
              borderColor: colorWithAlpha(accent, crossfade?.linked ? 0.9 : 0.45),
              backgroundColor: colorWithAlpha(accent, 0.08),
            },
          ]}
        />
      ) : null}

      {editable ? (
        <>
          <Animated.View
            {...fadeInLengthResponder.panHandlers}
            style={[styles.lengthHandle, fadeInHandleStyle]}>
            <View
              pointerEvents="none"
              style={[
                styles.lengthKnob,
                styles.lengthKnobIn,
                { backgroundColor: accent },
              ]}
            />
          </Animated.View>
          <Animated.View
            {...fadeOutLengthResponder.panHandlers}
            style={[styles.lengthHandle, fadeOutHandleStyle]}>
            <View
              pointerEvents="none"
              style={[
                styles.lengthKnob,
                styles.lengthKnobOut,
                { backgroundColor: accent },
              ]}
            />
          </Animated.View>
          {fadeInWidth > 20 ? (
            <View
              {...fadeInCurveResponder.panHandlers}
              style={[
                styles.curveHandle,
                {
                  left: fadeInCurvePos.left,
                  top: fadeInCurvePos.top,
                  backgroundColor: accent,
                },
              ]}
            />
          ) : null}
          {fadeOutWidth > 20 ? (
            <View
              {...fadeOutCurveResponder.panHandlers}
              style={[
                styles.curveHandle,
                {
                  left: fadeOutCurvePos.left,
                  top: fadeOutCurvePos.top,
                  backgroundColor: accent,
                },
              ]}
            />
          ) : null}
          {showCrossfadeHandle ? (
            <View
              {...crossfadeResponder.panHandlers}
              style={[
                styles.crossfadeHandle,
                {
                  left: crossfadeLeft + crossfadeWidth - FADE_HANDLE_TOUCH / 2,
                  top: bodyTop,
                  height: resolvedBodyHeight,
                },
              ]}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fadeRegion: {
    position: 'absolute',
    overflow: 'hidden',
  },
  lengthHandle: {
    position: 'absolute',
    zIndex: 6,
    alignItems: 'center',
  },
  lengthKnob: {
    width: FADE_LENGTH_KNOB,
    height: FADE_LENGTH_KNOB,
    borderRadius: 0,
    marginTop: 0,
    marginLeft: 0,
  },
  // Sit fully inside the track at zero fade (to the right of the fade-in edge).
  lengthKnobIn: {
    transform: [{ translateX: FADE_LENGTH_KNOB / 2 }],
  },
  // Sit fully inside the track at zero fade (to the left of the fade-out edge).
  lengthKnobOut: {
    transform: [{ translateX: -FADE_LENGTH_KNOB / 2 }],
  },
  curveHandle: {
    position: 'absolute',
    width: FADE_CURVE_HANDLE,
    height: FADE_CURVE_HANDLE,
    borderRadius: FADE_CURVE_HANDLE / 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    zIndex: 7,
  },
  crossfadeZone: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 3,
  },
  crossfadeHandle: {
    position: 'absolute',
    width: FADE_HANDLE_TOUCH,
    zIndex: 8,
  },
});
