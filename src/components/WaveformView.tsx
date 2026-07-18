import * as Haptics from 'expo-haptics';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { colorWithAlpha, type VoiceMemosColorScheme } from '@/constants/VoiceMemosColors';
import { clampTrimValues, dbToLinear } from '@/src/audio/layerEffects';
import {
  applyPinchDeltaToPixelsPerSecond,
  applyPinchDeltaToTrackZoom,
  clampTimelinePixelsPerSecond,
  clampTimelineTrackZoom,
  getTimelineZoomBounds,
  TIMELINE_DEFAULT_PIXELS_PER_SECOND,
} from '@/src/audio/timelineZoom';
import {
  getPeaksForMemo,
  peakToAbsoluteScale,
  resamplePeaks,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
} from '@/src/audio/waveform';
import { LoopColumnOverlay } from '@/src/components/LoopColumnOverlay';
import { LOOP_ROW_HEIGHT, LoopRegionBar, type LoopOverlayConfig } from '@/src/components/LoopRegionBar';
import {
  buildMetronomeGridLines,
  getMetronomeGridBufferRange,
  isMetronomeGridBufferValid,
  MetronomeTrackGrid,
  type MetronomeGridBuffer,
} from '@/src/components/MetronomeGridOverlay';
import type { MetronomeGridLine } from '@/src/audio/metronome';
import type { MetronomeSettings } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatMarkerTime } from '@/src/utils/format';

const BAR_WIDTH = WAVEFORM_BAR_WIDTH;
const BAR_GAP = WAVEFORM_BAR_GAP;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const MARKER_ROW_HEIGHT = 24;
const PLAYHEAD_CAP_SIZE = 6;
const MIN_LABEL_SPACING = 48;
const TIMELINE_HEADROOM_SECONDS = 30;
const LAYOUT_DURATION_STEP_SECONDS = 30;
const TRIM_SIDE_BORDER = 6;
const TRIM_EDGE_BORDER = 2;
const TRIM_HANDLE_TOUCH = 56;
const TRIM_EDGE_SCROLL_ZONE = 56;
const TRIM_EDGE_SCROLL_MAX_SPEED = 12;
const TRIM_HANDLE_COLOR = '#FFCC00';
const MOVE_BORDER_WIDTH = 2;
const MIN_PINCH_SPAN = 10;
const TRACK_ZOOM_SCROLL_THRESHOLD = 1.01;

type ZoomGestureStart = {
  spanX: number;
  spanY: number;
  pixelsPerSecond: number;
  trackZoom: number;
  scrollX: number;
  scrollY: number;
  focalX: number;
  focalY: number;
  tracksTop: number;
};

type FrozenTimelineZoom = {
  pixelsPerSecond: number;
  trackZoom: number;
  verticalScrollY: number;
};

type PageOffset = {
  x: number;
  y: number;
};

function getTwoFingerSpan(
  touches: ReadonlyArray<{ pageX: number; pageY: number }>,
  offset: PageOffset
): Pick<ZoomGestureStart, 'spanX' | 'spanY' | 'focalX' | 'focalY'> | null {
  if (touches.length < 2) {
    return null;
  }
  const first = touches[0];
  const second = touches[1];
  const firstX = first.pageX - offset.x;
  const firstY = first.pageY - offset.y;
  const secondX = second.pageX - offset.x;
  const secondY = second.pageY - offset.y;
  return {
    spanX: Math.max(Math.abs(firstX - secondX), MIN_PINCH_SPAN),
    spanY: Math.max(Math.abs(firstY - secondY), MIN_PINCH_SPAN),
    focalX: (firstX + secondX) / 2,
    focalY: (firstY + secondY) / 2,
  };
}

function shouldCaptureTwoFingerZoom(
  touches: ReadonlyArray<unknown>,
  zoomEnabled: boolean
): boolean {
  return zoomEnabled && touches.length >= 2;
}

type WaveformTheme = {
  colors: VoiceMemosColorScheme;
  styles: ReturnType<typeof createWaveformStyles>;
};

const WaveformThemeContext = createContext<WaveformTheme | null>(null);

function useWaveformTheme(): WaveformTheme {
  const theme = useContext(WaveformThemeContext);
  if (!theme) {
    throw new Error('useWaveformTheme must be used within WaveformView');
  }
  return theme;
}

export type { LoopOverlayConfig } from '@/src/components/LoopRegionBar';

export type TrimScrollHelpers = {
  viewportWidth: number;
  getScrollX: () => number;
  autoScrollForContentX: (contentX: number) => void;
  onTrimGestureActive: (active: boolean) => void;
};

export type TrimOverlayConfig = {
  layerId: string;
  trimIn: number;
  trimOut: number;
  onChange: (trimIn: number, trimOut: number) => void;
};

export type MoveOverlayConfig = {
  layerId: string;
  startTime: number;
  trimIn: number;
  onChange: (startTime: number) => void;
};

function getLayoutDuration(
  duration: number,
  currentTime: number,
  viewportWidth: number,
  recordingLayoutActive: boolean,
  pixelsPerSecond: number
): number {
  if (!recordingLayoutActive) {
    return duration;
  }
  const viewportSeconds = viewportWidth > 0 ? viewportWidth / pixelsPerSecond : 0;
  const headroom = Math.max(TIMELINE_HEADROOM_SECONDS, viewportSeconds);
  const raw = currentTime + headroom;
  return Math.max(duration, Math.ceil(raw / LAYOUT_DURATION_STEP_SECONDS) * LAYOUT_DURATION_STEP_SECONDS);
}

export type TrackData = {
  id: string;
  peaks?: number[];
  startTime: number;
  duration: number;
  isActive: boolean;
  isMuted?: boolean;
  isSoloed?: boolean;
  isSoloedOut?: boolean;
  label?: string;
  showLabel?: boolean;
  color?: string;
  liveRecording?: {
    peaks?: number[];
    startTime: number;
    duration: number;
  };
  replaceTailDimFrom?: number;
};

type Props = {
  tracks: TrackData[];
  currentTime: number;
  duration: number;
  isRecording?: boolean;
  recordingLayoutActive?: boolean;
  isPlaying?: boolean;
  getPlaybackTime?: () => number;
  getRecordingTime?: () => number;
  onSeek: (time: number) => void;
  onTrackPress: (trackId: string) => void;
  onTrackDeselect?: () => void;
  onTrackLongPress?: (trackId: string) => void;
  onWidthChange?: (width: number) => void;
  trimOverlay?: TrimOverlayConfig;
  moveOverlay?: MoveOverlayConfig;
  loopOverlay?: LoopOverlayConfig;
  metronome?: MetronomeSettings;
  volumeVisualDb?: number;
};

function getMarkerInterval(pixelsPerSecond: number): number {
  if (pixelsPerSecond >= MIN_LABEL_SPACING) {
    return 1;
  }
  if (pixelsPerSecond * 5 >= MIN_LABEL_SPACING) {
    return 5;
  }
  if (pixelsPerSecond * 10 >= MIN_LABEL_SPACING) {
    return 10;
  }
  return 30;
}

function getTrackBarCount(
  trackDuration: number,
  contentWidth: number,
  pixelsPerSecond: number
): number {
  if (trackDuration <= 0) {
    return 0;
  }
  const targetWidth = trackDuration * pixelsPerSecond;
  return Math.max(1, Math.floor(Math.min(contentWidth, targetWidth) / BAR_STEP));
}

function timeToScrollX(time: number, contentWidth: number, pixelsPerSecond: number): number {
  return Math.max(0, Math.min(contentWidth, time * pixelsPerSecond));
}

/** Recording scroll must not clamp to stale contentWidth while backgrounded. */
function recordingTimeToScrollX(
  time: number,
  contentWidth: number,
  pixelsPerSecond: number
): number {
  const scrollTarget = time * pixelsPerSecond;
  const maxScroll = Math.max(contentWidth, scrollTarget);
  return Math.max(0, Math.min(maxScroll, scrollTarget));
}

function scrollXToTime(x: number, duration: number, pixelsPerSecond: number): number {
  return Math.max(0, Math.min(duration, x / pixelsPerSecond));
}

function isOutsideTimelinePress(
  locationX: number,
  sidePadding: number,
  contentWidth: number
): boolean {
  return locationX < sidePadding || locationX > sidePadding + contentWidth;
}

function TimelineDimRegions({
  bandWidth,
  contentWidth,
  height,
  sidePadding,
}: {
  bandWidth: number;
  contentWidth: number;
  height: number | `${number}%`;
  sidePadding: number;
}) {
  const { styles } = useWaveformTheme();
  const rightDimLeft = sidePadding + contentWidth;
  const rightDimWidth = Math.max(0, bandWidth - rightDimLeft);

  return (
    <>
      {sidePadding > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.dimRegion,
            { left: 0, top: 0, width: sidePadding, height },
          ]}
        />
      ) : null}
      {rightDimWidth > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.dimRegion,
            { left: rightDimLeft, top: 0, width: rightDimWidth, height },
          ]}
        />
      ) : null}
    </>
  );
}

function TrackTrimOverlay({
  track,
  sidePadding,
  trackHeight,
  trimIn,
  trimOut,
  pixelsPerSecond,
  onChange,
  trimScrollHelpers,
}: {
  track: TrackData;
  sidePadding: number;
  trackHeight: number;
  trimIn: number;
  trimOut: number;
  pixelsPerSecond: number;
  onChange: (trimIn: number, trimOut: number) => void;
  trimScrollHelpers: TrimScrollHelpers;
}) {
  const { styles } = useWaveformTheme();
  const trackOffset = sidePadding + track.startTime * pixelsPerSecond;
  const trimLeft = trackOffset + trimIn * pixelsPerSecond;
  const trimRight = trackOffset + trimOut * pixelsPerSecond;
  const trackEnd = trackOffset + track.duration * pixelsPerSecond;
  const startTrimIn = useRef(trimIn);
  const startTrimOut = useRef(trimOut);
  const scrollXAtGrant = useRef(0);
  const onChangeRef = useRef(onChange);
  const trimScrollHelpersRef = useRef(trimScrollHelpers);
  const trackRef = useRef(track);
  const sidePaddingRef = useRef(sidePadding);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  onChangeRef.current = onChange;
  trimScrollHelpersRef.current = trimScrollHelpers;
  trackRef.current = track;
  sidePaddingRef.current = sidePadding;
  pixelsPerSecondRef.current = pixelsPerSecond;

  const beginTrimGestureRef = useRef(() => {});
  beginTrimGestureRef.current = () => {
    scrollXAtGrant.current = trimScrollHelpersRef.current.getScrollX();
    startTrimIn.current = trimIn;
    startTrimOut.current = trimOut;
    trimScrollHelpersRef.current.onTrimGestureActive(true);
  };

  const endTrimGestureRef = useRef(() => {});
  endTrimGestureRef.current = () => {
    trimScrollHelpersRef.current.onTrimGestureActive(false);
  };

  const getEffectiveDx = (gesture: PanResponderGestureState): number => {
    const helpers = trimScrollHelpersRef.current;
    return gesture.dx + (helpers.getScrollX() - scrollXAtGrant.current);
  };

  const applyEdgeAutoScroll = (contentX: number) => {
    trimScrollHelpersRef.current.autoScrollForContentX(contentX);
  };

  const leftMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  leftMoveRef.current = (_event, gesture) => {
    const trackData = trackRef.current;
    const pps = pixelsPerSecondRef.current;
    const offset = sidePaddingRef.current + trackData.startTime * pps;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      offset + (startTrimIn.current + preliminaryDx / pps) * pps
    );
    const effectiveDx = getEffectiveDx(gesture);
    const next = clampTrimValues(
      startTrimIn.current + effectiveDx / pps,
      startTrimOut.current,
      trackData.duration
    );
    onChangeRef.current(next.trimIn, next.trimOut);
  };

  const rightMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  rightMoveRef.current = (_event, gesture) => {
    const trackData = trackRef.current;
    const pps = pixelsPerSecondRef.current;
    const offset = sidePaddingRef.current + trackData.startTime * pps;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      offset + (startTrimOut.current + preliminaryDx / pps) * pps
    );
    const effectiveDx = getEffectiveDx(gesture);
    const next = clampTrimValues(
      startTrimIn.current,
      startTrimOut.current + effectiveDx / pps,
      trackData.duration
    );
    onChangeRef.current(next.trimIn, next.trimOut);
  };

  const trimPanCapture = {
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
  };

  const leftResponder = useRef(
    PanResponder.create({
      ...trimPanCapture,
      onPanResponderGrant: () => beginTrimGestureRef.current(),
      onPanResponderMove: (event, gesture) => leftMoveRef.current(event, gesture),
      onPanResponderRelease: () => endTrimGestureRef.current(),
      onPanResponderTerminate: () => endTrimGestureRef.current(),
    })
  ).current;

  const rightResponder = useRef(
    PanResponder.create({
      ...trimPanCapture,
      onPanResponderGrant: () => beginTrimGestureRef.current(),
      onPanResponderMove: (event, gesture) => rightMoveRef.current(event, gesture),
      onPanResponderRelease: () => endTrimGestureRef.current(),
      onPanResponderTerminate: () => endTrimGestureRef.current(),
    })
  ).current;

  return (
    <>
      {trimLeft > trackOffset ? (
        <View
          pointerEvents="none"
          style={[
            styles.trimDim,
            {
              left: trackOffset,
              width: trimLeft - trackOffset,
              height: trackHeight,
            },
          ]}
        />
      ) : null}
      {trimRight < trackEnd ? (
        <View
          pointerEvents="none"
          style={[
            styles.trimDim,
            {
              left: trimRight,
              width: trackEnd - trimRight,
              height: trackHeight,
            },
          ]}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          styles.trimSelection,
          {
            left: trimLeft,
            width: Math.max(TRIM_SIDE_BORDER * 2, trimRight - trimLeft),
            height: trackHeight,
          },
        ]}
      />
      <View
        {...leftResponder.panHandlers}
        style={[
          styles.trimSideHandle,
          {
            left: trimLeft - TRIM_HANDLE_TOUCH / 2,
            height: trackHeight,
          },
        ]}
      />
      <View
        {...rightResponder.panHandlers}
        style={[
          styles.trimSideHandle,
          {
            left: trimRight - TRIM_HANDLE_TOUCH / 2,
            height: trackHeight,
          },
        ]}
      />
    </>
  );
}

function TrackMoveOverlay({
  track,
  sidePadding,
  trackHeight,
  trackColor,
  layerStartTime,
  trimIn,
  pixelsPerSecond,
  onChange,
  trimScrollHelpers,
}: {
  track: TrackData;
  sidePadding: number;
  trackHeight: number;
  trackColor: string;
  layerStartTime: number;
  trimIn: number;
  pixelsPerSecond: number;
  onChange: (startTime: number) => void;
  trimScrollHelpers: TrimScrollHelpers;
}) {
  const { styles } = useWaveformTheme();
  const segmentLeft = sidePadding + track.startTime * pixelsPerSecond;
  const segmentWidth = track.duration * pixelsPerSecond;
  const startLayerStartTime = useRef(layerStartTime);
  const scrollXAtGrant = useRef(0);
  const onChangeRef = useRef(onChange);
  const trimScrollHelpersRef = useRef(trimScrollHelpers);
  const sidePaddingRef = useRef(sidePadding);
  const trimInRef = useRef(trimIn);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  onChangeRef.current = onChange;
  trimScrollHelpersRef.current = trimScrollHelpers;
  sidePaddingRef.current = sidePadding;
  trimInRef.current = trimIn;
  pixelsPerSecondRef.current = pixelsPerSecond;

  const beginGestureRef = useRef(() => {});
  beginGestureRef.current = () => {
    scrollXAtGrant.current = trimScrollHelpersRef.current.getScrollX();
    startLayerStartTime.current = layerStartTime;
    trimScrollHelpersRef.current.onTrimGestureActive(true);
  };

  const endGestureRef = useRef(() => {});
  endGestureRef.current = () => {
    trimScrollHelpersRef.current.onTrimGestureActive(false);
  };

  const getEffectiveDx = (gesture: PanResponderGestureState): number => {
    const helpers = trimScrollHelpersRef.current;
    return gesture.dx + (helpers.getScrollX() - scrollXAtGrant.current);
  };

  const applyEdgeAutoScroll = (contentX: number) => {
    trimScrollHelpersRef.current.autoScrollForContentX(contentX);
  };

  const moveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  moveRef.current = (_event, gesture) => {
    const pps = pixelsPerSecondRef.current;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      segmentLeft + preliminaryDx
    );
    const effectiveDx = getEffectiveDx(gesture);
    const nextStartTime = Math.max(
      -trimInRef.current,
      startLayerStartTime.current + effectiveDx / pps
    );
    onChangeRef.current(nextStartTime);
  };

  const movePanCapture = {
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
  };

  const moveResponder = useRef(
    PanResponder.create({
      ...movePanCapture,
      onPanResponderGrant: () => beginGestureRef.current(),
      onPanResponderMove: (event, gesture) => moveRef.current(event, gesture),
      onPanResponderRelease: () => endGestureRef.current(),
      onPanResponderTerminate: () => endGestureRef.current(),
    })
  ).current;

  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.moveSelection,
          {
            left: segmentLeft,
            width: Math.max(MOVE_BORDER_WIDTH * 2, segmentWidth),
            height: trackHeight,
            borderColor: trackColor,
            backgroundColor: colorWithAlpha(trackColor, 0.1),
          },
        ]}
      />
      <View
        {...moveResponder.panHandlers}
        style={[
          styles.moveHandle,
          {
            left: segmentLeft,
            width: Math.max(TRIM_HANDLE_TOUCH, segmentWidth),
            height: trackHeight,
          },
        ]}
      />
    </>
  );
}

const TAP_DRAG_THRESHOLD = 10;
const LONG_PRESS_DELAY_MS = 400;

function getTrackBarColor(track: TrackData, colors: VoiceMemosColorScheme): string {
  if (track.isMuted || track.isSoloedOut) {
    return colors.waveformBar;
  }
  return track.color ?? colors.accent;
}

function getTrackBandBackground(track: TrackData, colors: VoiceMemosColorScheme): string {
  if (track.isActive) {
    return colorWithAlpha(track.color ?? colors.accent, 0.08);
  }
  return colors.waveformBandBackground;
}

function areTrackDataEqual(a: TrackData, b: TrackData): boolean {
  if (a.id !== b.id) {
    return false;
  }
  if (a.peaks !== b.peaks) {
    return false;
  }
  if (a.startTime !== b.startTime) {
    return false;
  }
  if (a.duration !== b.duration) {
    return false;
  }
  if (a.isActive !== b.isActive) {
    return false;
  }
  if (a.isMuted !== b.isMuted) {
    return false;
  }
  if (a.isSoloed !== b.isSoloed) {
    return false;
  }
  if (a.isSoloedOut !== b.isSoloedOut) {
    return false;
  }
  if (a.color !== b.color) {
    return false;
  }
  if (a.replaceTailDimFrom !== b.replaceTailDimFrom) {
    return false;
  }
  const aLive = a.liveRecording;
  const bLive = b.liveRecording;
  if (aLive !== bLive) {
    if (!aLive || !bLive) {
      return false;
    }
    if (aLive.peaks !== bLive.peaks) {
      return false;
    }
    if (aLive.startTime !== bLive.startTime) {
      return false;
    }
    if (aLive.duration !== bLive.duration) {
      return false;
    }
  }
  return true;
}

type TrackWaveformRowProps = {
  track: TrackData;
  bandWidth: number;
  contentWidth: number;
  sidePadding: number;
  trackHeight: number;
  pixelsPerSecond: number;
  onPress: (locationX: number) => void;
  onLongPress?: () => void;
  trimOverlay?: TrimOverlayConfig;
  moveOverlay?: MoveOverlayConfig;
  volumeVisualDb?: number;
  trimScrollHelpers?: TrimScrollHelpers;
  scrollPriority?: boolean;
  showBottomDivider?: boolean;
};

function areTrackWaveformRowPropsEqual(
  prev: TrackWaveformRowProps,
  next: TrackWaveformRowProps
): boolean {
  if (
    prev.bandWidth !== next.bandWidth ||
    prev.contentWidth !== next.contentWidth ||
    prev.sidePadding !== next.sidePadding ||
    prev.trackHeight !== next.trackHeight ||
    prev.pixelsPerSecond !== next.pixelsPerSecond ||
    prev.scrollPriority !== next.scrollPriority ||
    prev.showBottomDivider !== next.showBottomDivider ||
    prev.volumeVisualDb !== next.volumeVisualDb ||
    prev.trimScrollHelpers !== next.trimScrollHelpers
  ) {
    return false;
  }
  if (
    prev.trimOverlay?.layerId !== next.trimOverlay?.layerId ||
    prev.trimOverlay?.trimIn !== next.trimOverlay?.trimIn ||
    prev.trimOverlay?.trimOut !== next.trimOverlay?.trimOut
  ) {
    return false;
  }
  if (
    prev.moveOverlay?.layerId !== next.moveOverlay?.layerId ||
    prev.moveOverlay?.startTime !== next.moveOverlay?.startTime ||
    prev.moveOverlay?.trimIn !== next.moveOverlay?.trimIn
  ) {
    return false;
  }
  return areTrackDataEqual(prev.track, next.track);
}

const TrackWaveformRow = memo(function TrackWaveformRow({
  track,
  bandWidth,
  contentWidth,
  sidePadding,
  trackHeight,
  pixelsPerSecond,
  onPress,
  onLongPress,
  trimOverlay,
  moveOverlay,
  volumeVisualDb,
  trimScrollHelpers,
  scrollPriority = false,
  showBottomDivider = false,
}: TrackWaveformRowProps) {
  const { styles, colors } = useWaveformTheme();
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchDraggedRef = useRef(false);
  const longPressTriggeredRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const barCount = getTrackBarCount(track.duration, contentWidth, pixelsPerSecond);
  const trackOffset = track.startTime * pixelsPerSecond;
  const trackWidth = barCount * BAR_STEP;

  const normalizedPeaks = useMemo(() => {
    const source =
      track.peaks && track.peaks.length > 0
        ? track.peaks.slice(0, barCount)
        : getPeaksForMemo(track.peaks, barCount);
    return barCount > 0 ? resamplePeaks(source, barCount) : [];
  }, [barCount, track.peaks]);

  const liveRecording = track.liveRecording;
  const liveBarCount = liveRecording
    ? getTrackBarCount(liveRecording.duration, contentWidth, pixelsPerSecond)
    : 0;
  const liveTrackOffset = liveRecording ? liveRecording.startTime * pixelsPerSecond : 0;
  const liveTrackWidth = liveBarCount * BAR_STEP;

  const normalizedLivePeaks = useMemo(() => {
    if (!liveRecording || liveBarCount <= 0) {
      return [];
    }
    const source =
      liveRecording.peaks && liveRecording.peaks.length > 0
        ? liveRecording.peaks.slice(0, liveBarCount)
        : getPeaksForMemo(liveRecording.peaks, liveBarCount);
    return resamplePeaks(source, liveBarCount);
  }, [liveBarCount, liveRecording]);

  const replaceTailDimLeft =
    track.replaceTailDimFrom !== undefined
      ? sidePadding + track.replaceTailDimFrom * pixelsPerSecond
      : 0;
  const replaceTailDimWidth =
    track.replaceTailDimFrom !== undefined
      ? Math.max(
          0,
          (track.startTime + track.duration - track.replaceTailDimFrom) * pixelsPerSecond
        )
      : 0;

  const volumeScale =
    track.isActive && volumeVisualDb !== undefined
      ? dbToLinear(volumeVisualDb)
      : 1;
  const showTrimOverlay = trimOverlay?.layerId === track.id;
  const showMoveOverlay = moveOverlay?.layerId === track.id;
  const barColor = getTrackBarColor(track, colors);
  const mutedBarColor = colors.waveformBar;
  const bandBackground = getTrackBandBackground(track, colors);
  const trackColor = track.color ?? colors.accent;
  const hasTrackBars = trackWidth > 0;
  const hasLiveBars = liveTrackWidth > 0;
  const fullSelectionStart =
    hasTrackBars && hasLiveBars
      ? Math.min(trackOffset, liveTrackOffset)
      : hasTrackBars
        ? trackOffset
        : liveTrackOffset;
  const fullSelectionEnd =
    hasTrackBars && hasLiveBars
      ? Math.max(trackOffset + trackWidth, liveTrackOffset + liveTrackWidth)
      : hasTrackBars
        ? trackOffset + trackWidth
        : liveTrackOffset + liveTrackWidth;
  const selectionStart =
    showTrimOverlay && trimOverlay
      ? trackOffset + trimOverlay.trimIn * pixelsPerSecond
      : fullSelectionStart;
  const selectionEnd =
    showTrimOverlay && trimOverlay
      ? trackOffset + trimOverlay.trimOut * pixelsPerSecond
      : fullSelectionEnd;
  const selectionWidth = selectionEnd - selectionStart;

  const rowContent = (
    <View
      style={[
        styles.waveformBand,
        { width: bandWidth, height: trackHeight, backgroundColor: bandBackground },
      ]}>
      <TimelineDimRegions
        bandWidth={bandWidth}
        contentWidth={contentWidth}
        height={trackHeight}
        sidePadding={sidePadding}
      />
      <View
        pointerEvents="none"
        style={[styles.centerLine, { left: sidePadding, width: contentWidth }]}
      />
      {track.showLabel && track.label ? (
        <Text
          numberOfLines={1}
          pointerEvents="none"
          style={[
            styles.trackLabel,
            {
              left: sidePadding + 4,
              maxWidth: Math.max(0, bandWidth - sidePadding - 8),
            },
          ]}>
          {track.label}
        </Text>
      ) : null}
      {track.isMuted ? (
        <View
          pointerEvents="none"
          style={[styles.mutedBadge, { left: sidePadding + 6 }]}>
          <Text style={styles.mutedBadgeText}>M</Text>
        </View>
      ) : null}
      {track.isSoloed ? (
        <View
          pointerEvents="none"
          style={[
            styles.soloBadge,
            { left: track.isMuted ? sidePadding + 28 : sidePadding + 6 },
          ]}>
          <Text style={styles.soloBadgeText}>S</Text>
        </View>
      ) : null}
      {trackWidth > 0 || liveTrackWidth > 0 || replaceTailDimWidth > 0 ? (
        <View pointerEvents="none" style={styles.barsOverlay}>
          {trackWidth > 0 ? (
            <View
              style={[
                styles.barsRow,
                {
                  position: 'absolute',
                  left: sidePadding + trackOffset,
                  top: 0,
                  height: trackHeight,
                  width: trackWidth,
                },
              ]}>
              {normalizedPeaks.map((peak, index) => {
                const scaled = peakToAbsoluteScale(peak) * volumeScale;
                const barHeight =
                  scaled <= 0.01
                    ? 2
                    : Math.max(4, Math.min(trackHeight - 16, scaled * (trackHeight - 16)));
                const barTime = (index * BAR_STEP) / pixelsPerSecond;
                const inKeepRegion =
                  !showTrimOverlay ||
                  !trimOverlay ||
                  (barTime >= trimOverlay.trimIn && barTime < trimOverlay.trimOut);
                return (
                  <View
                    key={index}
                    style={[
                      styles.bar,
                      {
                        height: barHeight,
                        backgroundColor: inKeepRegion ? barColor : mutedBarColor,
                      },
                    ]}
                  />
                );
              })}
            </View>
          ) : null}
          {replaceTailDimWidth > 0 ? (
            <View
              style={[
                styles.replaceTailDim,
                {
                  left: replaceTailDimLeft,
                  width: replaceTailDimWidth,
                  height: trackHeight,
                },
              ]}
            />
          ) : null}
          {liveTrackWidth > 0 ? (
            <View
              style={[
                styles.barsRow,
                {
                  position: 'absolute',
                  left: sidePadding + liveTrackOffset,
                  top: 0,
                  height: trackHeight,
                  width: liveTrackWidth,
                },
              ]}>
              {normalizedLivePeaks.map((peak, index) => {
                const scaled = peakToAbsoluteScale(peak);
                const barHeight =
                  scaled <= 0.01
                    ? 2
                    : Math.max(4, Math.min(trackHeight - 16, scaled * (trackHeight - 16)));
                return (
                  <View
                    key={`live-${index}`}
                    style={[
                      styles.bar,
                      {
                        height: barHeight,
                        backgroundColor: colors.recordRed,
                      },
                    ]}
                  />
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      {showTrimOverlay && trimOverlay && trimScrollHelpers ? (
        <TrackTrimOverlay
          pixelsPerSecond={pixelsPerSecond}
          sidePadding={sidePadding}
          track={track}
          trackHeight={trackHeight}
          trimIn={trimOverlay.trimIn}
          trimOut={trimOverlay.trimOut}
          trimScrollHelpers={trimScrollHelpers}
          onChange={trimOverlay.onChange}
        />
      ) : null}
      {showMoveOverlay && moveOverlay && trimScrollHelpers ? (
        <TrackMoveOverlay
          layerStartTime={moveOverlay.startTime}
          pixelsPerSecond={pixelsPerSecond}
          sidePadding={sidePadding}
          track={track}
          trackColor={trackColor}
          trackHeight={trackHeight}
          trimIn={moveOverlay.trimIn}
          trimScrollHelpers={trimScrollHelpers}
          onChange={moveOverlay.onChange}
        />
      ) : null}
      {track.isActive && selectionWidth > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: sidePadding + selectionStart,
            top: 0,
            width: selectionWidth,
            height: trackHeight,
            borderWidth: 2,
            borderColor: trackColor,
            borderRadius: 3,
            backgroundColor: colorWithAlpha(trackColor, 0.08),
            overflow: 'hidden',
          }}
        />
      ) : null}
    </View>
  );

  const bottomDivider = showBottomDivider ? (
    <View pointerEvents="none" style={[styles.trackDivider, { width: bandWidth }]} />
  ) : null;

  const rowSizeStyle = { width: bandWidth, height: trackHeight };

  if (scrollPriority) {
    return (
      <View
        style={[styles.trackRow, rowSizeStyle]}
        onTouchStart={(event) => {
          touchDraggedRef.current = false;
          longPressTriggeredRef.current = false;
          touchStartRef.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
          clearLongPressTimer();
          if (onLongPressRef.current) {
            longPressTimerRef.current = setTimeout(() => {
              longPressTriggeredRef.current = true;
              onLongPressRef.current?.();
            }, LONG_PRESS_DELAY_MS);
          }
        }}
        onTouchMove={(event) => {
          const dx = Math.abs(event.nativeEvent.pageX - touchStartRef.current.x);
          const dy = Math.abs(event.nativeEvent.pageY - touchStartRef.current.y);
          if (dx > TAP_DRAG_THRESHOLD || dy > TAP_DRAG_THRESHOLD) {
            touchDraggedRef.current = true;
            clearLongPressTimer();
          }
        }}
        onTouchEnd={(event) => {
          clearLongPressTimer();
          if (!touchDraggedRef.current && !longPressTriggeredRef.current) {
            onPressRef.current(event.nativeEvent.locationX);
          }
        }}>
        {rowContent}
        {bottomDivider}
      </View>
    );
  }

  return (
    <Pressable
      delayLongPress={LONG_PRESS_DELAY_MS}
      onLongPress={onLongPress}
      onPress={(event) => onPress(event.nativeEvent.locationX)}
      style={[styles.trackRow, rowSizeStyle]}>
      {rowContent}
      {bottomDivider}
    </Pressable>
  );
}, areTrackWaveformRowPropsEqual);

function WaveformViewComponent({
  tracks,
  currentTime,
  duration,
  isRecording = false,
  recordingLayoutActive = false,
  isPlaying = false,
  getPlaybackTime,
  getRecordingTime,
  onSeek,
  onTrackPress,
  onTrackDeselect,
  onTrackLongPress,
  onWidthChange,
  trimOverlay,
  moveOverlay,
  loopOverlay,
  metronome,
  volumeVisualDb,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useMemo(() => createWaveformStyles(colors), [colors]);
  const theme = useMemo(() => ({ colors, styles }), [colors, styles]);
  const scrollRef = useRef<ScrollView>(null);
  const verticalScrollRef = useRef<ScrollView>(null);
  const isUserScrollingRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const verticalScrollOffsetRef = useRef(0);
  const trimGestureActiveRef = useRef(false);
  const zoomGestureActiveRef = useRef(false);
  const [trimGestureActive, setTrimGestureActive] = useState(false);
  const [zoomGestureActive, setZoomGestureActive] = useState(false);
  const maxScrollXRef = useRef(0);
  const maxScrollYRef = useRef(0);
  const getPlaybackTimeRef = useRef(getPlaybackTime);
  getPlaybackTimeRef.current = getPlaybackTime;
  const getRecordingTimeRef = useRef(getRecordingTime);
  getRecordingTimeRef.current = getRecordingTime;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const contentWidthRef = useRef(0);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onTrackPressRef = useRef(onTrackPress);
  onTrackPressRef.current = onTrackPress;
  const onTrackDeselectRef = useRef(onTrackDeselect);
  onTrackDeselectRef.current = onTrackDeselect;
  const onTrackLongPressRef = useRef(onTrackLongPress);
  onTrackLongPressRef.current = onTrackLongPress;
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(TIMELINE_DEFAULT_PIXELS_PER_SECOND);
  const [trackZoom, setTrackZoom] = useState(1);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  pixelsPerSecondRef.current = pixelsPerSecond;
  const trackZoomRef = useRef(trackZoom);
  trackZoomRef.current = trackZoom;
  const zoomBoundsRef = useRef(getTimelineZoomBounds(0, 0, 1));
  const zoomGestureStartRef = useRef<ZoomGestureStart | null>(null);
  const hitZoomBoundRef = useRef(false);
  const containerRef = useRef<View>(null);
  const containerPageOffsetRef = useRef<PageOffset>({ x: 0, y: 0 });
  const loopOverlayRef = useRef(loopOverlay);
  loopOverlayRef.current = loopOverlay;
  const lastDoubleTapAtRef = useRef(0);
  const frozenZoomRef = useRef<FrozenTimelineZoom | null>(null);
  const prevFollowRecordingScrollRef = useRef(false);
  const wasFollowingRecordingScrollRef = useRef(false);

  const followRecordingScroll = recordingLayoutActive || isRecording;
  const followRecordingScrollRef = useRef(followRecordingScroll);
  followRecordingScrollRef.current = followRecordingScroll;
  const zoomBounds = useMemo(
    () => getTimelineZoomBounds(viewportWidth, duration, tracks.length),
    [viewportWidth, duration, tracks.length]
  );
  zoomBoundsRef.current = zoomBounds;
  const frozenZoom = followRecordingScroll ? frozenZoomRef.current : null;
  const layoutPixelsPerSecond = frozenZoom?.pixelsPerSecond ?? pixelsPerSecond;
  const layoutTrackZoom = frozenZoom?.trackZoom ?? trackZoom;

  const layoutDuration = getLayoutDuration(
    duration,
    currentTime,
    viewportWidth,
    followRecordingScroll,
    layoutPixelsPerSecond
  );
  const targetWidth = layoutDuration > 0 ? layoutDuration * layoutPixelsPerSecond : 0;
  const barCount =
    targetWidth > 0
      ? Math.max(1, Math.floor(targetWidth / BAR_STEP))
      : viewportWidth > 0
        ? Math.max(1, Math.floor(viewportWidth / BAR_STEP))
        : 0;
  const contentWidth =
    barCount > 0 ? Math.max(viewportWidth, barCount * BAR_STEP) : viewportWidth;
  contentWidthRef.current = contentWidth;
  maxScrollXRef.current = Math.max(0, contentWidth);
  const sidePadding = viewportWidth / 2;
  const totalContentWidth = viewportWidth + contentWidth;
  const bandWidth = sidePadding * 2 + contentWidth;
  const waveformAreaHeight = Math.max(
    1,
    viewportHeight > 0 ? viewportHeight - MARKER_ROW_HEIGHT - LOOP_ROW_HEIGHT : 1
  );
  const playheadHeight = waveformAreaHeight + LOOP_ROW_HEIGHT;
  const baseTrackHeight = waveformAreaHeight / Math.max(1, tracks.length);
  const trackHeight = baseTrackHeight * layoutTrackZoom;
  const tracksContentHeight = trackHeight * Math.max(1, tracks.length);
  const verticalScrollEnabled = layoutTrackZoom > TRACK_ZOOM_SCROLL_THRESHOLD;
  maxScrollYRef.current = Math.max(0, tracksContentHeight - waveformAreaHeight);

  const scrollX = timeToScrollX(currentTime, contentWidth, layoutPixelsPerSecond);

  const markerInterval = getMarkerInterval(layoutPixelsPerSecond);
  const markerSeconds = useMemo(() => {
    if (layoutDuration <= 0) {
      return [];
    }
    const ticks: number[] = [];
    for (let second = 0; second <= Math.ceil(layoutDuration); second += 1) {
      ticks.push(second);
    }
    return ticks;
  }, [layoutDuration]);

  const [metronomeGridLines, setMetronomeGridLines] = useState<MetronomeGridLine[]>([]);
  const metronomeGridBufferRef = useRef<MetronomeGridBuffer | null>(null);
  const metronomeRef = useRef(metronome);
  metronomeRef.current = metronome;
  const layoutPixelsPerSecondRef = useRef(layoutPixelsPerSecond);
  layoutPixelsPerSecondRef.current = layoutPixelsPerSecond;
  const viewportWidthRef = useRef(viewportWidth);
  viewportWidthRef.current = viewportWidth;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const layoutDurationRef = useRef(layoutDuration);
  layoutDurationRef.current = layoutDuration;

  const syncMetronomeGridRef = useRef((_scrollX: number, _force = false) => {});
  syncMetronomeGridRef.current = (nextScrollX: number, force = false) => {
    const settings = metronomeRef.current;
    const pps = layoutPixelsPerSecondRef.current;
    const vpWidth = viewportWidthRef.current;
    const gridDuration = Math.max(durationRef.current, layoutDurationRef.current);

    if (!settings || !settings.showGrid || vpWidth <= 0 || pps <= 0 || gridDuration <= 0) {
      metronomeGridBufferRef.current = null;
      setMetronomeGridLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    if (
      !force &&
      isMetronomeGridBufferValid(metronomeGridBufferRef.current, nextScrollX, vpWidth, pps)
    ) {
      return;
    }

    const buffer = getMetronomeGridBufferRange(nextScrollX, vpWidth, pps, gridDuration);
    metronomeGridBufferRef.current = buffer;
    const nextLines = buildMetronomeGridLines(settings, buffer, pps);
    setMetronomeGridLines((prev) => {
      if (
        prev.length === nextLines.length &&
        prev.every(
          (line, index) =>
            line.time === nextLines[index]?.time && line.kind === nextLines[index]?.kind
        )
      ) {
        return prev;
      }
      return nextLines;
    });
  };

  useEffect(() => {
    syncMetronomeGridRef.current(scrollOffsetRef.current, true);
  }, [
    metronome?.bpm,
    metronome?.timeSignature,
    metronome?.accentEnabled,
    metronome?.showGrid,
    layoutPixelsPerSecond,
    viewportWidth,
    duration,
    layoutDuration,
  ]);

  useLayoutEffect(() => {
    const wasFollowing = prevFollowRecordingScrollRef.current;
    if (followRecordingScroll && !wasFollowing) {
      const snapshot: FrozenTimelineZoom = {
        pixelsPerSecond,
        trackZoom,
        verticalScrollY: verticalScrollOffsetRef.current,
      };
      frozenZoomRef.current = snapshot;
      verticalScrollRef.current?.scrollTo({ y: snapshot.verticalScrollY, animated: false });
    } else if (!followRecordingScroll && wasFollowing) {
      frozenZoomRef.current = null;
    }
    prevFollowRecordingScrollRef.current = followRecordingScroll;
  }, [followRecordingScroll, pixelsPerSecond, trackZoom]);

  useEffect(() => {
    if (followRecordingScroll) {
      return;
    }
    setPixelsPerSecond((current) => clampTimelinePixelsPerSecond(current, zoomBounds));
    setTrackZoom((current) => clampTimelineTrackZoom(current, zoomBounds));
  }, [zoomBounds, followRecordingScroll]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewportWidth(width);
    setViewportHeight(height);
    onWidthChange?.(width);
    containerRef.current?.measureInWindow((x, y) => {
      containerPageOffsetRef.current = { x, y };
    });
  };

  const handleTrackPress = (trackId: string, locationX: number) => {
    const track = tracks.find((entry) => entry.id === trackId);
    const isSelectable = track && !track.isMuted && !track.isSoloedOut;
    if (isSelectable) {
      if (isOutsideTimelinePress(locationX, sidePadding, contentWidth)) {
        onTrackDeselectRef.current?.();
      } else {
        onTrackPressRef.current(trackId);
      }
    }
    if (isPlaying || duration <= 0 || contentWidth <= 0) {
      return;
    }
    const waveformX = locationX - sidePadding;
    onSeek(scrollXToTime(waveformX, duration, layoutPixelsPerSecond));
  };

  const applyZoomFromGesture = useCallback((currentSpanX: number, currentSpanY: number, start: ZoomGestureStart) => {
    const bounds = zoomBoundsRef.current;
    const nextPixelsPerSecond = applyPinchDeltaToPixelsPerSecond(
      start.pixelsPerSecond,
      start.spanX,
      currentSpanX,
      bounds
    );
    const nextTrackZoom = applyPinchDeltaToTrackZoom(
      start.trackZoom,
      start.spanY,
      currentSpanY,
      bounds
    );
    const hitBound =
      nextPixelsPerSecond === bounds.pixelsPerSecondMin ||
      nextPixelsPerSecond === bounds.pixelsPerSecondMax ||
      nextTrackZoom === bounds.trackZoomMin ||
      nextTrackZoom === bounds.trackZoomMax;
    if (hitBound && !hitZoomBoundRef.current) {
      hitZoomBoundRef.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (!hitBound) {
      hitZoomBoundRef.current = false;
    }

    const padding = viewportWidth / 2;
    const timeAtFocal = (start.scrollX + start.focalX - padding) / start.pixelsPerSecond;
    const nextScrollX = Math.max(
      0,
      Math.min(maxScrollXRef.current, padding + timeAtFocal * nextPixelsPerSecond - start.focalX)
    );

    const oldTrackHeight = (waveformAreaHeight / Math.max(1, tracks.length)) * start.trackZoom;
    const nextTrackHeight = (waveformAreaHeight / Math.max(1, tracks.length)) * nextTrackZoom;
    const focalYInTracks = Math.max(0, start.focalY - start.tracksTop);
    const trackIndex = oldTrackHeight > 0 ? (start.scrollY + focalYInTracks) / oldTrackHeight : 0;
    const nextTracksContentHeight = nextTrackHeight * Math.max(1, tracks.length);
    const nextMaxScrollY = Math.max(0, nextTracksContentHeight - waveformAreaHeight);
    const nextScrollY = Math.max(
      0,
      Math.min(nextMaxScrollY, trackIndex * nextTrackHeight - focalYInTracks)
    );

    setPixelsPerSecond(nextPixelsPerSecond);
    setTrackZoom(nextTrackZoom);
    scrollOffsetRef.current = nextScrollX;
    verticalScrollOffsetRef.current = nextScrollY;
    syncMetronomeGridRef.current(nextScrollX, true);
    scrollRef.current?.scrollTo({ x: nextScrollX, animated: false });
    verticalScrollRef.current?.scrollTo({ y: nextScrollY, animated: false });
  }, [tracks.length, viewportWidth, waveformAreaHeight]);

  const resetZoom = useCallback(() => {
    const bounds = zoomBoundsRef.current;
    setPixelsPerSecond(bounds.pixelsPerSecondDefault);
    setTrackZoom(1);
    verticalScrollOffsetRef.current = 0;
    verticalScrollRef.current?.scrollTo({ y: 0, animated: true });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const setZoomGestureActiveOnJs = useCallback((active: boolean) => {
    zoomGestureActiveRef.current = active;
    setZoomGestureActive(active);
  }, []);

  const beginTwoFingerZoomRef = useRef((_event: GestureResponderEvent) => {});
  beginTwoFingerZoomRef.current = (event) => {
    if (followRecordingScrollRef.current || trimGestureActiveRef.current) {
      return;
    }
    const span = getTwoFingerSpan(event.nativeEvent.touches, containerPageOffsetRef.current);
    if (!span) {
      return;
    }
    const loopOffset = loopOverlayRef.current ? LOOP_ROW_HEIGHT : 0;
    zoomGestureStartRef.current = {
      ...span,
      pixelsPerSecond: pixelsPerSecondRef.current,
      trackZoom: trackZoomRef.current,
      scrollX: scrollOffsetRef.current,
      scrollY: verticalScrollOffsetRef.current,
      tracksTop: loopOffset,
    };
    hitZoomBoundRef.current = false;
    setZoomGestureActiveOnJs(true);
  };

  const moveTwoFingerZoomRef = useRef((_event: GestureResponderEvent) => {});
  moveTwoFingerZoomRef.current = (event) => {
    const start = zoomGestureStartRef.current;
    if (!start || event.nativeEvent.touches.length < 2) {
      return;
    }
    const span = getTwoFingerSpan(event.nativeEvent.touches, containerPageOffsetRef.current);
    if (!span) {
      return;
    }
    applyZoomFromGesture(span.spanX, span.spanY, start);
  };

  const endTwoFingerZoomRef = useRef(() => {});
  endTwoFingerZoomRef.current = () => {
    zoomGestureStartRef.current = null;
    hitZoomBoundRef.current = false;
    setZoomGestureActiveOnJs(false);
  };

  const maybeHandleDoubleTapResetRef = useRef((_event: GestureResponderEvent) => {});
  maybeHandleDoubleTapResetRef.current = (event) => {
    if (
      followRecordingScrollRef.current ||
      trimGestureActiveRef.current ||
      event.nativeEvent.touches.length !== 1
    ) {
      return;
    }
    const now = Date.now();
    if (now - lastDoubleTapAtRef.current < 320) {
      lastDoubleTapAtRef.current = 0;
      resetZoom();
      return;
    }
    lastDoubleTapAtRef.current = now;
  };

  const zoomEnabled = !followRecordingScroll && !trimGestureActive;
  const zoomEnabledRef = useRef(zoomEnabled);
  zoomEnabledRef.current = zoomEnabled;

  const twoFingerZoomResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (event) =>
        shouldCaptureTwoFingerZoom(event.nativeEvent.touches, zoomEnabledRef.current),
      onMoveShouldSetPanResponder: (event) =>
        shouldCaptureTwoFingerZoom(event.nativeEvent.touches, zoomEnabledRef.current),
      onStartShouldSetPanResponderCapture: (event) =>
        shouldCaptureTwoFingerZoom(event.nativeEvent.touches, zoomEnabledRef.current),
      onMoveShouldSetPanResponderCapture: (event) =>
        shouldCaptureTwoFingerZoom(event.nativeEvent.touches, zoomEnabledRef.current),
      onPanResponderGrant: (event) => {
        if (event.nativeEvent.touches.length >= 2) {
          beginTwoFingerZoomRef.current(event);
          return;
        }
        maybeHandleDoubleTapResetRef.current(event);
      },
      onPanResponderMove: (event) => {
        if (event.nativeEvent.touches.length >= 2) {
          if (!zoomGestureStartRef.current) {
            beginTwoFingerZoomRef.current(event);
          }
          moveTwoFingerZoomRef.current(event);
          return;
        }
        if (zoomGestureStartRef.current) {
          endTwoFingerZoomRef.current();
        }
      },
      onPanResponderRelease: () => endTwoFingerZoomRef.current(),
      onPanResponderTerminate: () => endTwoFingerZoomRef.current(),
    })
  ).current;

  const handleScrollBeginDrag = () => {
    if (trimGestureActiveRef.current) {
      return;
    }
    isUserScrollingRef.current = true;
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    scrollOffsetRef.current = x;
    syncMetronomeGridRef.current(x);
    if (trimGestureActiveRef.current) {
      return;
    }
    if (!isUserScrollingRef.current || duration <= 0 || contentWidth <= 0) {
      return;
    }
    onSeekRef.current(scrollXToTime(x, duration, layoutPixelsPerSecond));
  };

  const handleVerticalScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    verticalScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  };

  const gestureOverlay = trimOverlay ?? moveOverlay;
  const needsTimelineScrollHelpers = Boolean(gestureOverlay || loopOverlay);

  const trimScrollHelpers = useMemo<TrimScrollHelpers | undefined>(() => {
    if (!needsTimelineScrollHelpers || viewportWidth <= 0) {
      return undefined;
    }
    return {
      viewportWidth,
      getScrollX: () => scrollOffsetRef.current,
      autoScrollForContentX: (contentX: number) => {
        const scrollX = scrollOffsetRef.current;
        const viewportX = contentX - scrollX;
        let delta = 0;
        if (viewportX < TRIM_EDGE_SCROLL_ZONE) {
          delta = -Math.min(
            TRIM_EDGE_SCROLL_MAX_SPEED,
            (TRIM_EDGE_SCROLL_ZONE - viewportX) * 0.2
          );
        } else if (viewportX > viewportWidth - TRIM_EDGE_SCROLL_ZONE) {
          delta = Math.min(
            TRIM_EDGE_SCROLL_MAX_SPEED,
            (viewportX - (viewportWidth - TRIM_EDGE_SCROLL_ZONE)) * 0.2
          );
        }
        if (delta === 0) {
          return;
        }
        const next = Math.max(0, Math.min(maxScrollXRef.current, scrollX + delta));
        if (next === scrollX) {
          return;
        }
        scrollOffsetRef.current = next;
        syncMetronomeGridRef.current(next);
        scrollRef.current?.scrollTo({ x: next, animated: false });
      },
      onTrimGestureActive: (active: boolean) => {
        trimGestureActiveRef.current = active;
        setTrimGestureActive(active);
      },
    };
  }, [needsTimelineScrollHelpers, viewportWidth]);

  const loopScrollHelpers = useMemo(() => {
    if (!trimScrollHelpers) {
      return undefined;
    }
    return {
      viewportWidth: trimScrollHelpers.viewportWidth,
      getScrollX: trimScrollHelpers.getScrollX,
      autoScrollForContentX: trimScrollHelpers.autoScrollForContentX,
      onGestureActive: trimScrollHelpers.onTrimGestureActive,
    };
  }, [trimScrollHelpers]);

  const handleScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const velocity = event.nativeEvent.velocity?.x ?? 0;
    if (Math.abs(velocity) < 0.1) {
      isUserScrollingRef.current = false;
    }
  };

  const handleMomentumScrollEnd = () => {
    isUserScrollingRef.current = false;
  };

  useEffect(() => {
    if (gestureOverlay || loopOverlay) {
      return;
    }
    trimGestureActiveRef.current = false;
    setTrimGestureActive(false);
  }, [gestureOverlay, loopOverlay]);

  useEffect(() => {
    if (
      viewportWidth <= 0 ||
      isPlaying ||
      followRecordingScroll ||
      gestureOverlay ||
      isUserScrollingRef.current
    ) {
      if (followRecordingScroll) {
        wasFollowingRecordingScrollRef.current = true;
      }
      return;
    }
    const justExitedRecordingFollow = wasFollowingRecordingScrollRef.current;
    wasFollowingRecordingScrollRef.current = false;
    scrollOffsetRef.current = scrollX;
    syncMetronomeGridRef.current(scrollX);
    scrollRef.current?.scrollTo({
      x: scrollX,
      animated: !justExitedRecordingFollow,
    });
  }, [scrollX, viewportWidth, followRecordingScroll, isPlaying, gestureOverlay, layoutPixelsPerSecond]);

  useEffect(() => {
    if (
      followRecordingScroll ||
      !isPlaying ||
      duration <= 0 ||
      viewportWidth <= 0 ||
      contentWidth <= 0
    ) {
      return;
    }

    let raf = 0;
    const tick = () => {
      const time = getPlaybackTimeRef.current?.() ?? currentTimeRef.current;
      const x = timeToScrollX(time, contentWidth, layoutPixelsPerSecond);
      scrollOffsetRef.current = x;
      syncMetronomeGridRef.current(x);
      scrollRef.current?.scrollTo({
        x,
        animated: false,
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, followRecordingScroll, duration, contentWidth, viewportWidth, layoutPixelsPerSecond]);

  useEffect(() => {
    if (!followRecordingScroll) {
      return;
    }

    const syncRecordingScroll = () => {
      if (viewportWidth <= 0) {
        return;
      }
      const propTime = currentTimeRef.current;
      const liveTime = getRecordingTimeRef.current?.() ?? propTime;
      const x = recordingTimeToScrollX(
        liveTime,
        contentWidthRef.current,
        layoutPixelsPerSecond
      );
      scrollOffsetRef.current = x;
      syncMetronomeGridRef.current(x);
      scrollRef.current?.scrollTo({ x, animated: false });
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        syncRecordingScroll();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [followRecordingScroll, viewportWidth, layoutPixelsPerSecond]);

  useEffect(() => {
    if (!followRecordingScroll || viewportWidth <= 0) {
      return;
    }

    let raf = 0;
    const tick = () => {
      if (isUserScrollingRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const time = getRecordingTimeRef.current?.() ?? currentTimeRef.current;
      const width = contentWidthRef.current;
      const x = recordingTimeToScrollX(time, width, layoutPixelsPerSecond);
      scrollOffsetRef.current = x;
      syncMetronomeGridRef.current(x);
      scrollRef.current?.scrollTo({
        x,
        animated: false,
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [followRecordingScroll, contentWidth, viewportWidth, layoutPixelsPerSecond]);

  return (
    <WaveformThemeContext.Provider value={theme}>
    <View
      ref={containerRef}
      {...twoFingerZoomResponder.panHandlers}
      onLayout={handleLayout}
      style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        bounces={false}
        nestedScrollEnabled
        scrollEnabled={
          !isPlaying &&
          !followRecordingScroll &&
          !trimGestureActive &&
          !zoomGestureActive
        }
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        style={styles.scrollView}>
        <View style={[styles.scrollContent, { width: totalContentWidth || viewportWidth }]}>
          {loopOverlay && loopScrollHelpers ? (
            <LoopRegionBar
              bandWidth={bandWidth}
              config={loopOverlay}
              disabled={isRecording}
              editDisabled={isPlaying}
              gridLines={metronomeGridLines}
              pixelsPerSecond={layoutPixelsPerSecond}
              scrollHelpers={loopScrollHelpers}
              sidePadding={sidePadding}
            />
          ) : null}
          <ScrollView
            ref={verticalScrollRef}
            bounces={false}
            nestedScrollEnabled
            scrollEnabled={verticalScrollEnabled && !trimGestureActive && !zoomGestureActive}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            style={{ height: waveformAreaHeight }}
            onScroll={handleVerticalScroll}>
            <View style={{ height: tracksContentHeight, position: 'relative' }}>
              {tracks.map((track, index) => (
                <TrackWaveformRow
                  key={track.id}
                  bandWidth={bandWidth}
                  contentWidth={contentWidth}
                  pixelsPerSecond={layoutPixelsPerSecond}
                  showBottomDivider={index < tracks.length - 1}
                  sidePadding={sidePadding}
                  track={track}
                  trackHeight={trackHeight}
                  scrollPriority={Boolean(
                    isPlaying ||
                    followRecordingScroll ||
                    (gestureOverlay && gestureOverlay.layerId !== track.id)
                  )}
                  moveOverlay={moveOverlay}
                  trimOverlay={trimOverlay}
                  trimScrollHelpers={trimScrollHelpers}
                  volumeVisualDb={volumeVisualDb}
                  onLongPress={
                    onTrackLongPressRef.current &&
                    track.id !== '__recording__' &&
                    track.id !== 'empty'
                      ? () => onTrackLongPressRef.current?.(track.id)
                      : undefined
                  }
                  onPress={(locationX) => handleTrackPress(track.id, locationX)}
                />
              ))}
              <MetronomeTrackGrid
                height={tracksContentHeight}
                lines={metronomeGridLines}
                pixelsPerSecond={layoutPixelsPerSecond}
                sidePadding={sidePadding}
              />
              {loopOverlay ? (
                <LoopColumnOverlay
                  height={tracksContentHeight}
                  loopEnabled={loopOverlay.loopEnabled}
                  loopEnd={loopOverlay.loopEnd}
                  loopStart={loopOverlay.loopStart}
                  pixelsPerSecond={layoutPixelsPerSecond}
                  sidePadding={sidePadding}
                />
              ) : null}
            </View>
          </ScrollView>
          <View
            pointerEvents="none"
            style={[styles.markerBand, { width: bandWidth }]}>
            {markerSeconds.map((second) => {
              const x = sidePadding + second * layoutPixelsPerSecond;
              const showLabel = second % markerInterval === 0;
              return (
                <View key={second} style={[styles.marker, { left: x }]}>
                  <View style={styles.markerTick} />
                  {showLabel ? (
                    <Text style={styles.markerLabel}>{formatMarkerTime(second)}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View pointerEvents="none" style={[styles.fixedPlayhead, { height: playheadHeight }]}>
        <View style={styles.playheadCapTop} />
        <View style={styles.playheadLine} />
        <View style={styles.playheadCapBottom} />
      </View>
    </View>
    </WaveformThemeContext.Provider>
  );
}

function areOverlayConfigsEqual<T extends { layerId: string }>(
  a: T | undefined,
  b: T | undefined,
  keys: (keyof T)[]
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function areWaveformViewPropsEqual(prev: Props, next: Props): boolean {
  if (prev.tracks !== next.tracks) {
    if (
      prev.tracks.length !== next.tracks.length ||
      prev.tracks.some((track, index) => !areTrackDataEqual(track, next.tracks[index]!))
    ) {
      return false;
    }
  }

  const playing = next.isPlaying && !next.recordingLayoutActive;
  if (!playing && prev.currentTime !== next.currentTime) {
    return false;
  }

  if (
    prev.duration !== next.duration ||
    prev.isRecording !== next.isRecording ||
    prev.recordingLayoutActive !== next.recordingLayoutActive ||
    prev.isPlaying !== next.isPlaying ||
    prev.getPlaybackTime !== next.getPlaybackTime ||
    prev.getRecordingTime !== next.getRecordingTime ||
    prev.onSeek !== next.onSeek ||
    prev.onTrackPress !== next.onTrackPress ||
    prev.onTrackDeselect !== next.onTrackDeselect ||
    prev.onTrackLongPress !== next.onTrackLongPress ||
    prev.onWidthChange !== next.onWidthChange ||
    prev.volumeVisualDb !== next.volumeVisualDb
  ) {
    return false;
  }

  const prevMetronome = prev.metronome;
  const nextMetronome = next.metronome;
  if (prevMetronome !== nextMetronome) {
    if (!prevMetronome || !nextMetronome) {
      return false;
    }
    if (
      prevMetronome.bpm !== nextMetronome.bpm ||
      prevMetronome.timeSignature !== nextMetronome.timeSignature ||
      prevMetronome.accentEnabled !== nextMetronome.accentEnabled ||
      prevMetronome.showGrid !== nextMetronome.showGrid
    ) {
      return false;
    }
  }

  if (
    !areOverlayConfigsEqual(prev.trimOverlay, next.trimOverlay, [
      'layerId',
      'trimIn',
      'trimOut',
      'onChange',
    ])
  ) {
    return false;
  }

  if (
    !areOverlayConfigsEqual(prev.moveOverlay, next.moveOverlay, [
      'layerId',
      'startTime',
      'trimIn',
      'onChange',
    ])
  ) {
    return false;
  }

  const prevLoop = prev.loopOverlay;
  const nextLoop = next.loopOverlay;
  if (prevLoop !== nextLoop) {
    if (!prevLoop || !nextLoop) {
      return false;
    }
    if (
      prevLoop.loopStart !== nextLoop.loopStart ||
      prevLoop.loopEnd !== nextLoop.loopEnd ||
      prevLoop.loopEnabled !== nextLoop.loopEnabled ||
      prevLoop.duration !== nextLoop.duration ||
      prevLoop.onChange !== nextLoop.onChange
    ) {
      return false;
    }
  }

  // While playing, ignore currentTime — RAF + getPlaybackTime own scroll.
  return true;
}

export const WaveformView = memo(WaveformViewComponent, areWaveformViewPropsEqual);

function createWaveformStyles(colors: VoiceMemosColorScheme) {
  return StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    position: 'relative',
    overflow: 'visible',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  trackRow: {
    overflow: 'hidden',
    position: 'relative',
  },
  trackDivider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.waveformCenterLine,
  },
  waveformBand: {
    position: 'relative',
    justifyContent: 'center',
  },
  trackLabel: {
    position: 'absolute',
    top: 4,
    fontSize: 11,
    color: colors.secondaryText,
    zIndex: 5,
  },
  mutedBadge: {
    position: 'absolute',
    top: 6,
    zIndex: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 4,
    paddingHorizontal: 4,
    backgroundColor: colors.secondaryText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.background,
    lineHeight: 13,
  },
  soloBadge: {
    position: 'absolute',
    top: 6,
    zIndex: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 4,
    paddingHorizontal: 4,
    backgroundColor: colors.soloBadge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soloBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.soloBadgeText,
    lineHeight: 13,
  },
  dimRegion: {
    position: 'absolute',
    backgroundColor: colors.waveformDimBackground,
  },
  replaceTailDim: {
    position: 'absolute',
    top: 0,
    backgroundColor: colorWithAlpha(colors.waveformDimBackground, 0.85),
  },
  barsOverlay: {
    ...StyleSheet.absoluteFill,
  },
  centerLine: {
    position: 'absolute',
    top: '50%',
    height: 1,
    marginTop: -0.5,
    backgroundColor: colors.waveformCenterLine,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
    height: '100%',
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: 1,
  },
  fixedPlayhead: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 2,
    marginLeft: -1,
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'visible',
    zIndex: 10,
  },
  playheadCapTop: {
    width: PLAYHEAD_CAP_SIZE,
    height: PLAYHEAD_CAP_SIZE,
    borderRadius: PLAYHEAD_CAP_SIZE / 2,
    backgroundColor: colors.accent,
    marginTop: -PLAYHEAD_CAP_SIZE / 2,
  },
  playheadCapBottom: {
    width: PLAYHEAD_CAP_SIZE,
    height: PLAYHEAD_CAP_SIZE,
    borderRadius: PLAYHEAD_CAP_SIZE / 2,
    backgroundColor: colors.accent,
    marginBottom: -PLAYHEAD_CAP_SIZE / 2,
  },
  playheadLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.accent,
  },
  markerBand: {
    height: MARKER_ROW_HEIGHT,
    backgroundColor: colors.waveformMarkerBackground,
    position: 'relative',
  },
  marker: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
  markerTick: {
    width: 1,
    height: 6,
    backgroundColor: colors.secondaryText,
    opacity: 0.35,
  },
  markerLabel: {
    marginTop: 2,
    fontSize: 10,
    color: colors.secondaryText,
    fontVariant: ['tabular-nums'],
  },
  trimDim: {
    position: 'absolute',
    top: 0,
    backgroundColor: colors.trimDimOverlay,
  },
  trimSelection: {
    position: 'absolute',
    top: 0,
    borderTopWidth: TRIM_EDGE_BORDER,
    borderBottomWidth: TRIM_EDGE_BORDER,
    borderLeftWidth: TRIM_SIDE_BORDER,
    borderRightWidth: TRIM_SIDE_BORDER,
    borderColor: TRIM_HANDLE_COLOR,
    backgroundColor: 'rgba(255, 204, 0, 0.08)',
    zIndex: 10,
  },
  trimSideHandle: {
    position: 'absolute',
    top: 0,
    width: TRIM_HANDLE_TOUCH,
    zIndex: 20,
  },
  moveSelection: {
    position: 'absolute',
    top: 0,
    borderWidth: MOVE_BORDER_WIDTH,
    zIndex: 10,
  },
  moveHandle: {
    position: 'absolute',
    top: 0,
    zIndex: 20,
  },
  });
}
