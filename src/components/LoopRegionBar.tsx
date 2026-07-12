import * as Haptics from 'expo-haptics';
import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

import { MIN_LOOP_DURATION } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export const LOOP_ROW_HEIGHT = 16;
const LOOP_HANDLE_TOUCH = 14;
export const LOOP_ENABLED_FILL = '#FFCC00';
const TAP_MOVE_THRESHOLD = 6;

export type LoopScrollHelpers = {
  viewportWidth: number;
  getScrollX: () => number;
  autoScrollForContentX: (contentX: number) => void;
  onGestureActive: (active: boolean) => void;
};

export type LoopOverlayConfig = {
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  duration: number;
  onChange: (start: number, end: number, enabled: boolean) => void;
};

type Props = {
  bandWidth: number;
  sidePadding: number;
  pixelsPerSecond: number;
  config: LoopOverlayConfig;
  scrollHelpers: LoopScrollHelpers;
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

function LoopRulerTicks({
  sidePadding,
  duration,
  height,
  pixelsPerSecond,
  styles,
}: {
  sidePadding: number;
  duration: number;
  height: number;
  pixelsPerSecond: number;
  styles: ReturnType<typeof createLoopRegionStyles>;
}) {
  const seconds = useMemo(() => {
    if (duration <= 0) {
      return [];
    }
    const ticks: number[] = [];
    for (let second = 0; second <= Math.ceil(duration); second += 1) {
      ticks.push(second);
    }
    return ticks;
  }, [duration]);

  return (
    <>
      {seconds.map((second) => (
        <View
          key={second}
          pointerEvents="none"
          style={[styles.rulerMarker, { left: sidePadding + second * pixelsPerSecond }]}>
          <View style={[styles.rulerTick, { height: Math.min(6, height) }]} />
        </View>
      ))}
    </>
  );
}

export function LoopRegionBar({
  bandWidth,
  sidePadding,
  pixelsPerSecond,
  config,
  scrollHelpers,
  disabled = false,
  editDisabled = false,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useMemo(() => createLoopRegionStyles(colors), [colors]);
  const { loopStart, loopEnd, loopEnabled, duration, onChange } = config;
  const hasRegion = loopEnd > loopStart + MIN_LOOP_DURATION;
  const editBlocked = disabled || editDisabled;

  const disabledRef = useRef(disabled);
  const editBlockedRef = useRef(editBlocked);
  disabledRef.current = disabled;
  editBlockedRef.current = editBlocked;

  const [preview, setPreview] = useState<{ start: number; end: number } | null>(null);
  const previewRef = useRef<{ start: number; end: number } | null>(null);
  const updatePreview = (next: { start: number; end: number } | null) => {
    previewRef.current = next;
    setPreview(next);
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

  const beginGesture = () => {
    scrollXAtGrant.current = scrollHelpersRef.current.getScrollX();
    scrollHelpersRef.current.onGestureActive(true);
  };

  const endGesture = () => {
    scrollHelpersRef.current.onGestureActive(false);
    updatePreview(null);
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
    const clampedStart = Math.max(0, Math.min(start, dur));
    const clampedEnd = Math.max(0, Math.min(end, dur));
    if (clampedEnd <= clampedStart + MIN_LOOP_DURATION) {
      onChangeRef.current(0, 0, false);
      return;
    }
    onChangeRef.current(clampedStart, clampedEnd, enabled);
  };

  const createGrantRef = useRef((_event: GestureResponderEvent) => {});
  createGrantRef.current = (event) => {
    if (editBlocked) {
      return;
    }
    beginGesture();
    grantX.current = event.nativeEvent.locationX;
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
    if (editBlocked) {
      return;
    }
    const padding = sidePaddingRef.current;
    const dur = durationRef.current;
    const pps = pixelsPerSecondRef.current;
    const endX = grantX.current + getEffectiveDx(gesture);
    applyEdgeAutoScroll(endX);
    const endTime = contentXToTime(endX, padding, dur, pps);
    const startTime = createStartTime.current;
    updatePreview({
      start: Math.min(startTime, endTime),
      end: Math.max(startTime, endTime),
    });
  };

  const createReleaseRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  createReleaseRef.current = (_event, gesture) => {
    if (editBlocked) {
      endGesture();
      return;
    }
    const padding = sidePaddingRef.current;
    const dur = durationRef.current;
    const pps = pixelsPerSecondRef.current;
    const movement = Math.abs(gesture.dx) + Math.abs(gesture.dy);
    const endX = grantX.current + getEffectiveDx(gesture);
    const endTime = contentXToTime(endX, padding, dur, pps);
    const startTime = createStartTime.current;
    const nextStart = Math.min(startTime, endTime);
    const nextEnd = Math.max(startTime, endTime);

    if (movement >= TAP_MOVE_THRESHOLD || nextEnd > nextStart + MIN_LOOP_DURATION) {
      commitLoop(nextStart, nextEnd, true);
    }
    endGesture();
  };

  const leftMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  leftMoveRef.current = (_event, gesture) => {
    const padding = sidePaddingRef.current;
    const pps = pixelsPerSecondRef.current;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      padding + (startLoopStart.current + preliminaryDx / pps) * pps
    );
    const effectiveDx = getEffectiveDx(gesture);
    const nextStart = Math.max(
      0,
      Math.min(startLoopStart.current + effectiveDx / pps, startLoopEnd.current - MIN_LOOP_DURATION)
    );
    updatePreview({ start: nextStart, end: startLoopEnd.current });
  };

  const leftReleaseRef = useRef(() => {});
  leftReleaseRef.current = () => {
    const current = previewRef.current;
    if (current) {
      commitLoop(current.start, current.end, loopEnabledRef.current);
    }
    endGesture();
  };

  const rightMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  rightMoveRef.current = (_event, gesture) => {
    const padding = sidePaddingRef.current;
    const pps = pixelsPerSecondRef.current;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      padding + (startLoopEnd.current + preliminaryDx / pps) * pps
    );
    const effectiveDx = getEffectiveDx(gesture);
    const nextEnd = Math.min(
      durationRef.current,
      Math.max(startLoopEnd.current + effectiveDx / pps, startLoopStart.current + MIN_LOOP_DURATION)
    );
    updatePreview({ start: startLoopStart.current, end: nextEnd });
  };

  const rightReleaseRef = useRef(() => {});
  rightReleaseRef.current = () => {
    const current = previewRef.current;
    if (current) {
      commitLoop(current.start, current.end, loopEnabledRef.current);
    }
    endGesture();
  };

  const toggleGrantRef = useRef(() => {});
  toggleGrantRef.current = () => {
    if (disabled) {
      return;
    }
    beginGesture();
  };

  const toggleReleaseRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  toggleReleaseRef.current = (_event, gesture) => {
    if (disabled) {
      endGesture();
      return;
    }
    const movement = Math.abs(gesture.dx) + Math.abs(gesture.dy);
    if (movement < TAP_MOVE_THRESHOLD && hasRegionRef.current) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const togglePanCapture = {
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onStartShouldSetPanResponderCapture: () => !disabledRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
    onPanResponderTerminationRequest: () => false,
  };

  const createResponder = useRef(
    PanResponder.create({
      ...editPanCapture,
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
      onPanResponderMove: () => {},
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
  const regionFillColor = displayEnabled
    ? LOOP_ENABLED_FILL
    : colors.waveformInactive;

  return (
    <View style={[styles.bar, { width: bandWidth, height: LOOP_ROW_HEIGHT }]}>
      <View pointerEvents="none" style={[styles.rulerLayer, { width: bandWidth, height: LOOP_ROW_HEIGHT }]}>
        <LoopRulerTicks
          duration={duration}
          height={LOOP_ROW_HEIGHT}
          pixelsPerSecond={pixelsPerSecond}
          sidePadding={sidePadding}
          styles={styles}
        />
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
                height: LOOP_ROW_HEIGHT,
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
                height: LOOP_ROW_HEIGHT,
              },
            ]}
          />
          <View
            {...leftResponder.panHandlers}
            style={[
              styles.edgeHandle,
              {
                left: regionLeft - LOOP_HANDLE_TOUCH / 2,
                height: LOOP_ROW_HEIGHT,
              },
            ]}
          />
          <View
            {...rightResponder.panHandlers}
            style={[
              styles.edgeHandle,
              {
                left: regionRight - LOOP_HANDLE_TOUCH / 2,
                height: LOOP_ROW_HEIGHT,
              },
            ]}
          />
        </>
      ) : null}

      <View
        {...createResponder.panHandlers}
        style={[styles.createLayer, { width: bandWidth, height: LOOP_ROW_HEIGHT }]}
      />
    </View>
  );
}

function createLoopRegionStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return StyleSheet.create({
    bar: {
      backgroundColor: colors.loopBandBackground,
      position: 'relative',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.waveformCenterLine,
    },
    rulerLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 2,
    },
    rulerMarker: {
      position: 'absolute',
      top: 0,
      alignItems: 'center',
    },
    rulerTick: {
      width: 1,
      backgroundColor: colors.secondaryText,
      opacity: 0.35,
    },
    createLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 1,
    },
    regionFill: {
      position: 'absolute',
      top: 0,
      zIndex: 3,
    },
    regionTapTarget: {
      position: 'absolute',
      top: 0,
      zIndex: 4,
    },
    edgeHandle: {
      position: 'absolute',
      top: 0,
      width: LOOP_HANDLE_TOUCH,
      zIndex: 5,
    },
  });
}
