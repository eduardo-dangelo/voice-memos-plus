import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { MetronomeGridLine } from '@/src/audio/metronome';
import { snapTimeToGrid } from '@/src/audio/loopSnap';
import { MetronomeRulerTicks } from '@/src/components/MetronomeGridOverlay';
import { MIN_LOOP_DURATION } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export const LOOP_ROW_HEIGHT = 16;
export const LOOP_ROW_HEIGHT_EXPANDED = 36;
export const LOOP_EXPAND_DURATION_MS = 200;
export const LOOP_EXPAND_EASING = Easing.bezier(0.33, 0, 0.2, 1);
const LOOP_HANDLE_TOUCH = 20;
const LOOP_HANDLE_TOUCH_EXPANDED = 36;
export const LOOP_ENABLED_FILL = '#FFCC00';
const TAP_MOVE_THRESHOLD = 6;
const LONG_PRESS_DELAY_MS = 400;
const EXPAND_IDLE_MS = 3000;

export type LoopScrollHelpers = {
  viewportWidth: number;
  getScrollX: () => number;
  autoScrollForContentX: (contentX: number) => void;
  onGestureActive: (active: boolean) => void;
};

export type LoopPreviewState = {
  start: number;
  end: number;
  enabled: boolean;
};

export type LoopOverlayConfig = {
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  duration: number;
  onChange: (start: number, end: number, enabled: boolean) => void;
  onPreviewChange?: (preview: LoopPreviewState | null) => void;
  onOpenSettings?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  /** When true, keep the bar expanded and pause the idle collapse timer. */
  holdExpanded?: boolean;
  /** Beat interval in seconds when snap is active; null/undefined disables snap. */
  snapIntervalSec?: number | null;
};

type Props = {
  bandWidth: number;
  sidePadding: number;
  pixelsPerSecond: number;
  config: LoopOverlayConfig;
  scrollHelpers: LoopScrollHelpers;
  gridLines?: MetronomeGridLine[];
  disabled?: boolean;
  editDisabled?: boolean;
};

function contentXToTime(
  x: number,
  sidePadding: number,
  duration: number,
  pixelsPerSecond: number
): number {
  return Math.max(0, Math.min(duration, (x - sidePadding) / pixelsPerSecond));
}

export function timeToContentX(time: number, sidePadding: number, pixelsPerSecond: number): number {
  return sidePadding + time * pixelsPerSecond;
}

export { snapTimeToGrid };

export type LoopRegionLayout = {
  left: number;
  width: number;
  hasRegion: boolean;
};

export function getLoopRegionLayout({
  loopStart,
  loopEnd,
  sidePadding,
  pixelsPerSecond,
}: {
  loopStart: number;
  loopEnd: number;
  sidePadding: number;
  pixelsPerSecond: number;
}): LoopRegionLayout {
  const hasRegion = loopEnd > loopStart + MIN_LOOP_DURATION;
  if (!hasRegion) {
    return { left: 0, width: 0, hasRegion: false };
  }
  const left = timeToContentX(loopStart, sidePadding, pixelsPerSecond);
  const right = timeToContentX(loopEnd, sidePadding, pixelsPerSecond);
  return { left, width: Math.max(2, right - left), hasRegion: true };
}

export function LoopRegionBar({
  bandWidth,
  sidePadding,
  pixelsPerSecond,
  config,
  scrollHelpers,
  gridLines,
  disabled = false,
  editDisabled = false,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useMemo(() => createLoopRegionStyles(colors), [colors]);
  const {
    loopStart,
    loopEnd,
    loopEnabled,
    duration,
    onChange,
    onPreviewChange,
    onOpenSettings,
    onExpandedChange,
    holdExpanded = false,
    snapIntervalSec,
  } = config;
  const hasRegion = loopEnd > loopStart + MIN_LOOP_DURATION;
  const editBlocked = disabled || editDisabled;

  const disabledRef = useRef(disabled);
  const editBlockedRef = useRef(editBlocked);
  disabledRef.current = disabled;
  editBlockedRef.current = editBlocked;

  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const holdExpandedRef = useRef(holdExpanded);
  holdExpandedRef.current = holdExpanded;

  const rowHeight = expanded ? LOOP_ROW_HEIGHT_EXPANDED : LOOP_ROW_HEIGHT;
  const handleTouch = expanded ? LOOP_HANDLE_TOUCH_EXPANDED : LOOP_HANDLE_TOUCH;
  const heightSV = useSharedValue(LOOP_ROW_HEIGHT);

  useEffect(() => {
    heightSV.value = withTiming(expanded ? LOOP_ROW_HEIGHT_EXPANDED : LOOP_ROW_HEIGHT, {
      duration: LOOP_EXPAND_DURATION_MS,
      easing: LOOP_EXPAND_EASING,
    });
  }, [expanded, heightSV]);

  const animatedBarStyle = useAnimatedStyle(() => ({
    height: heightSV.value,
  }));

  const clearIdleTimer = () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const scheduleIdleCollapse = () => {
    clearIdleTimer();
    if (!expandedRef.current || holdExpandedRef.current) {
      return;
    }
    idleTimerRef.current = setTimeout(() => {
      setExpanded(false);
    }, EXPAND_IDLE_MS);
  };

  const expandBar = () => {
    setExpanded(true);
    scheduleIdleCollapse();
  };

  const collapseBar = () => {
    if (!expandedRef.current) {
      return;
    }
    setExpanded(false);
  };

  const toggleExpandedFromEmptyTap = () => {
    if (expandedRef.current) {
      collapseBar();
    } else {
      expandBar();
    }
  };

  const noteInteraction = () => {
    if (expandedRef.current) {
      scheduleIdleCollapse();
    }
  };

  useEffect(() => {
    if (holdExpanded) {
      setExpanded(true);
      clearIdleTimer();
      return;
    }
    if (expandedRef.current) {
      scheduleIdleCollapse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to holdExpanded
  }, [holdExpanded]);

  useEffect(() => {
    onExpandedChange?.(expanded);
    if (expanded) {
      scheduleIdleCollapse();
    } else {
      clearIdleTimer();
    }
    return clearIdleTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduleIdleCollapse uses refs
  }, [expanded, onExpandedChange]);

  useEffect(() => () => clearLongPressTimer(), []);

  const [preview, setPreview] = useState<{ start: number; end: number } | null>(null);
  const previewRef = useRef<{ start: number; end: number } | null>(null);
  const onPreviewChangeRef = useRef(onPreviewChange);
  onPreviewChangeRef.current = onPreviewChange;
  const onOpenSettingsRef = useRef(onOpenSettings);
  onOpenSettingsRef.current = onOpenSettings;
  const snapIntervalRef = useRef(snapIntervalSec);
  snapIntervalRef.current = snapIntervalSec;

  const emitPreview = (next: { start: number; end: number } | null, enabled: boolean) => {
    if (!next) {
      onPreviewChangeRef.current?.(null);
      return;
    }
    onPreviewChangeRef.current?.({ start: next.start, end: next.end, enabled });
  };

  const updatePreview = (next: { start: number; end: number } | null, enabled = true) => {
    previewRef.current = next;
    setPreview(next);
    emitPreview(next, enabled);
  };

  const displayStart = preview?.start ?? loopStart;
  const displayEnd = preview?.end ?? loopEnd;
  const displayHasRegion = displayEnd > displayStart + MIN_LOOP_DURATION;
  const displayEnabled = preview !== null ? true : loopEnabled;

  const onChangeRef = useRef(onChange);
  const scrollHelpersRef = useRef(scrollHelpers);
  const sidePaddingRef = useRef(sidePadding);
  const durationRef = useRef(duration);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  const loopEnabledRef = useRef(loopEnabled);
  const loopStartRef = useRef(loopStart);
  const loopEndRef = useRef(loopEnd);
  const hasRegionRef = useRef(hasRegion);
  onChangeRef.current = onChange;
  scrollHelpersRef.current = scrollHelpers;
  sidePaddingRef.current = sidePadding;
  durationRef.current = duration;
  pixelsPerSecondRef.current = pixelsPerSecond;
  loopEnabledRef.current = loopEnabled;
  loopStartRef.current = loopStart;
  loopEndRef.current = loopEnd;
  hasRegionRef.current = hasRegion;

  const scrollXAtGrant = useRef(0);
  const createStartTime = useRef(0);
  const startLoopStart = useRef(0);
  const startLoopEnd = useRef(0);
  const grantX = useRef(0);

  const applySnap = (time: number): number => {
    const interval = snapIntervalRef.current;
    if (interval == null || !(interval > 0)) {
      return time;
    }
    return snapTimeToGrid(time, interval, durationRef.current);
  };

  const beginGesture = () => {
    scrollXAtGrant.current = scrollHelpersRef.current.getScrollX();
    scrollHelpersRef.current.onGestureActive(true);
    noteInteraction();
  };

  const endGesture = () => {
    clearLongPressTimer();
    scrollHelpersRef.current.onGestureActive(false);
    updatePreview(null, loopEnabledRef.current);
  };

  const fireLongPress = () => {
    longPressFiredRef.current = true;
    clearLongPressTimer();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    expandBar();
    onOpenSettingsRef.current?.();
  };

  const startLongPressTimer = () => {
    clearLongPressTimer();
    longPressFiredRef.current = false;
    if (!onOpenSettingsRef.current || disabledRef.current) {
      return;
    }
    longPressTimerRef.current = setTimeout(fireLongPress, LONG_PRESS_DELAY_MS);
  };

  const cancelLongPressIfMoved = (gesture: PanResponderGestureState) => {
    if (Math.abs(gesture.dx) + Math.abs(gesture.dy) >= TAP_MOVE_THRESHOLD) {
      clearLongPressTimer();
    }
  };

  const getEffectiveDx = (gesture: PanResponderGestureState): number => {
    const helpers = scrollHelpersRef.current;
    return gesture.dx + (helpers.getScrollX() - scrollXAtGrant.current);
  };

  const applyEdgeAutoScroll = (contentX: number) => {
    scrollHelpersRef.current.autoScrollForContentX(contentX);
  };

  const commitLoop = (start: number, end: number, enabled: boolean) => {
    const dur = durationRef.current;
    const clampedStart = Math.max(0, Math.min(applySnap(start), dur));
    let clampedEnd = Math.max(0, Math.min(applySnap(end), dur));
    if (clampedEnd <= clampedStart + MIN_LOOP_DURATION) {
      // Keep a valid span after snap when possible.
      const interval = snapIntervalRef.current;
      if (interval != null && interval > 0) {
        clampedEnd = Math.min(dur, clampedStart + Math.max(interval, MIN_LOOP_DURATION));
        clampedEnd = applySnap(clampedEnd);
      }
    }
    if (clampedEnd <= clampedStart + MIN_LOOP_DURATION) {
      onChangeRef.current(0, 0, false);
      return;
    }
    onChangeRef.current(clampedStart, clampedEnd, enabled);
  };

  const createGrantRef = useRef((_event: GestureResponderEvent) => {});
  createGrantRef.current = (event) => {
    if (disabledRef.current) {
      return;
    }
    beginGesture();
    startLongPressTimer();
    grantX.current = event.nativeEvent.locationX;
    if (editBlockedRef.current) {
      return;
    }
    const time = contentXToTime(
      event.nativeEvent.locationX,
      sidePaddingRef.current,
      durationRef.current,
      pixelsPerSecondRef.current
    );
    createStartTime.current = time;
    updatePreview({ start: time, end: time });
  };

  const createMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  createMoveRef.current = (_event, gesture) => {
    cancelLongPressIfMoved(gesture);
    if (disabledRef.current || editBlockedRef.current || longPressFiredRef.current) {
      return;
    }
    const padding = sidePaddingRef.current;
    const dur = durationRef.current;
    const pps = pixelsPerSecondRef.current;
    const endX = grantX.current + getEffectiveDx(gesture);
    applyEdgeAutoScroll(endX);
    const endTime = applySnap(contentXToTime(endX, padding, dur, pps));
    const startTime = applySnap(createStartTime.current);
    updatePreview({
      start: Math.min(startTime, endTime),
      end: Math.max(startTime, endTime),
    });
    noteInteraction();
  };

  const createReleaseRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  createReleaseRef.current = (_event, gesture) => {
    const longPressed = longPressFiredRef.current;
    clearLongPressTimer();
    if (disabledRef.current) {
      endGesture();
      return;
    }
    if (longPressed) {
      endGesture();
      return;
    }

    const movement = Math.abs(gesture.dx) + Math.abs(gesture.dy);
    const isTap = movement < TAP_MOVE_THRESHOLD;

    if (editBlockedRef.current) {
      if (isTap) {
        toggleExpandedFromEmptyTap();
      }
      endGesture();
      return;
    }

    const padding = sidePaddingRef.current;
    const dur = durationRef.current;
    const pps = pixelsPerSecondRef.current;
    const endX = grantX.current + getEffectiveDx(gesture);
    const endTime = contentXToTime(endX, padding, dur, pps);
    const startTime = createStartTime.current;
    const nextStart = Math.min(startTime, endTime);
    const nextEnd = Math.max(startTime, endTime);

    if (isTap && nextEnd <= nextStart + MIN_LOOP_DURATION) {
      toggleExpandedFromEmptyTap();
      endGesture();
      return;
    }

    if (movement >= TAP_MOVE_THRESHOLD || nextEnd > nextStart + MIN_LOOP_DURATION) {
      expandBar();
      commitLoop(nextStart, nextEnd, true);
    }
    endGesture();
  };

  const leftMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  leftMoveRef.current = (_event, gesture) => {
    cancelLongPressIfMoved(gesture);
    if (longPressFiredRef.current) {
      return;
    }
    const padding = sidePaddingRef.current;
    const pps = pixelsPerSecondRef.current;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(padding + (startLoopStart.current + preliminaryDx / pps) * pps);
    const effectiveDx = getEffectiveDx(gesture);
    const rawStart = Math.max(
      0,
      Math.min(startLoopStart.current + effectiveDx / pps, startLoopEnd.current - MIN_LOOP_DURATION)
    );
    const nextStart = Math.min(applySnap(rawStart), startLoopEnd.current - MIN_LOOP_DURATION);
    updatePreview({ start: Math.max(0, nextStart), end: startLoopEnd.current });
    noteInteraction();
  };

  const leftReleaseRef = useRef(() => {});
  leftReleaseRef.current = () => {
    const longPressed = longPressFiredRef.current;
    clearLongPressTimer();
    if (!longPressed) {
      const current = previewRef.current;
      if (current) {
        expandBar();
        commitLoop(current.start, current.end, loopEnabledRef.current);
      }
    }
    endGesture();
  };

  const rightMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  rightMoveRef.current = (_event, gesture) => {
    cancelLongPressIfMoved(gesture);
    if (longPressFiredRef.current) {
      return;
    }
    const padding = sidePaddingRef.current;
    const pps = pixelsPerSecondRef.current;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(padding + (startLoopEnd.current + preliminaryDx / pps) * pps);
    const effectiveDx = getEffectiveDx(gesture);
    const rawEnd = Math.min(
      durationRef.current,
      Math.max(startLoopEnd.current + effectiveDx / pps, startLoopStart.current + MIN_LOOP_DURATION)
    );
    const nextEnd = Math.max(applySnap(rawEnd), startLoopStart.current + MIN_LOOP_DURATION);
    updatePreview({
      start: startLoopStart.current,
      end: Math.min(durationRef.current, nextEnd),
    });
    noteInteraction();
  };

  const rightReleaseRef = useRef(() => {});
  rightReleaseRef.current = () => {
    const longPressed = longPressFiredRef.current;
    clearLongPressTimer();
    if (!longPressed) {
      const current = previewRef.current;
      if (current) {
        expandBar();
        commitLoop(current.start, current.end, loopEnabledRef.current);
      }
    }
    endGesture();
  };

  const toggleGrantRef = useRef(() => {});
  toggleGrantRef.current = () => {
    if (disabled) {
      return;
    }
    beginGesture();
    startLongPressTimer();
  };

  const toggleReleaseRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  toggleReleaseRef.current = (_event, gesture) => {
    const longPressed = longPressFiredRef.current;
    clearLongPressTimer();
    if (disabled) {
      endGesture();
      return;
    }
    const movement = Math.abs(gesture.dx) + Math.abs(gesture.dy);
    if (!longPressed && movement < TAP_MOVE_THRESHOLD && hasRegionRef.current) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      noteInteraction();
      onChangeRef.current(loopStartRef.current, loopEndRef.current, !loopEnabledRef.current);
    }
    endGesture();
  };

  const editPanCapture = {
    onStartShouldSetPanResponder: () => !editBlockedRef.current,
    onStartShouldSetPanResponderCapture: () => !editBlockedRef.current,
    onMoveShouldSetPanResponder: () => !editBlockedRef.current,
    onMoveShouldSetPanResponderCapture: () => !editBlockedRef.current,
    onPanResponderTerminationRequest: () => false,
  };

  const createPanCapture = {
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onStartShouldSetPanResponderCapture: () => !disabledRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
    onPanResponderTerminationRequest: () => false,
  };

  const togglePanCapture = {
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onStartShouldSetPanResponderCapture: () => !disabledRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
    onPanResponderTerminationRequest: () => false,
  };

  const createResponder = useRef(
    PanResponder.create({
      ...createPanCapture,
      onPanResponderGrant: (event) => createGrantRef.current(event),
      onPanResponderMove: (event, gesture) => createMoveRef.current(event, gesture),
      onPanResponderRelease: (event, gesture) => createReleaseRef.current(event, gesture),
      onPanResponderTerminate: () => endGesture(),
    })
  ).current;

  const leftResponder = useRef(
    PanResponder.create({
      ...editPanCapture,
      onPanResponderGrant: () => {
        beginGesture();
        startLongPressTimer();
        startLoopStart.current = loopStartRef.current;
        startLoopEnd.current = loopEndRef.current;
      },
      onPanResponderMove: (event, gesture) => leftMoveRef.current(event, gesture),
      onPanResponderRelease: () => leftReleaseRef.current(),
      onPanResponderTerminate: () => endGesture(),
    })
  ).current;

  const rightResponder = useRef(
    PanResponder.create({
      ...editPanCapture,
      onPanResponderGrant: () => {
        beginGesture();
        startLongPressTimer();
        startLoopStart.current = loopStartRef.current;
        startLoopEnd.current = loopEndRef.current;
      },
      onPanResponderMove: (event, gesture) => rightMoveRef.current(event, gesture),
      onPanResponderRelease: () => rightReleaseRef.current(),
      onPanResponderTerminate: () => endGesture(),
    })
  ).current;

  const toggleResponder = useRef(
    PanResponder.create({
      ...togglePanCapture,
      onPanResponderGrant: () => toggleGrantRef.current(),
      onPanResponderMove: (_event, gesture) => cancelLongPressIfMoved(gesture),
      onPanResponderRelease: (event, gesture) => toggleReleaseRef.current(event, gesture),
      onPanResponderTerminate: () => endGesture(),
    })
  ).current;

  const { left: regionLeft, width: regionWidth } = getLoopRegionLayout({
    loopStart: displayStart,
    loopEnd: displayEnd,
    sidePadding,
    pixelsPerSecond,
  });
  const regionRight = regionLeft + regionWidth;
  const regionFillColor = displayEnabled ? LOOP_ENABLED_FILL : colors.waveformInactive;

  return (
    <Animated.View style={[styles.bar, animatedBarStyle, { width: bandWidth }]}>
      <View pointerEvents="none" style={[styles.rulerLayer, { width: bandWidth }]}>
        {gridLines && gridLines.length > 0 ? (
          <MetronomeRulerTicks
            height={rowHeight}
            lines={gridLines}
            pixelsPerSecond={pixelsPerSecond}
            sidePadding={sidePadding}
          />
        ) : null}
      </View>

      {displayHasRegion ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.regionFill,
              {
                left: regionLeft,
                width: regionWidth,
                backgroundColor: regionFillColor,
              },
            ]}
          />
          <View
            {...toggleResponder.panHandlers}
            style={[
              styles.regionTapTarget,
              {
                left: regionLeft,
                width: regionWidth,
              },
            ]}
          />
          <View
            {...leftResponder.panHandlers}
            style={[
              styles.edgeHandle,
              {
                left: regionLeft - handleTouch / 2,
                width: handleTouch,
              },
            ]}
          />
          <View
            {...rightResponder.panHandlers}
            style={[
              styles.edgeHandle,
              {
                left: regionRight - handleTouch / 2,
                width: handleTouch,
              },
            ]}
          />
        </>
      ) : null}

      <View {...createResponder.panHandlers} style={[styles.createLayer, { width: bandWidth }]} />
    </Animated.View>
  );
}

function createLoopRegionStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return StyleSheet.create({
    bar: {
      backgroundColor: colors.loopBandBackground,
      position: 'relative',
      overflow: 'hidden',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.waveformCenterLine,
    },
    rulerLayer: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      zIndex: 2,
    },
    createLayer: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      zIndex: 1,
    },
    regionFill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      zIndex: 3,
    },
    regionTapTarget: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      zIndex: 4,
    },
    edgeHandle: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      zIndex: 5,
    },
  });
}
