import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
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
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colorWithAlpha, type VoiceMemosColorScheme } from '@/constants/VoiceMemosColors';
import { fadeEnvelopeGain } from '@/src/audio/fadeCurve';
import { clampTrimValues, dbToLinear } from '@/src/audio/layerEffects';
import { snapTimeToGrid } from '@/src/audio/loopSnap';
import {
  getPixelsPerSecondForGridSubdivision,
  getTimeGridMarkerTimesFromLines,
  pickGridSubdivisionForPixelsPerSecond,
  type MetronomeGridLine,
} from '@/src/audio/metronome';
import {
  applyPinchDeltaToPixelsPerSecond,
  applyPinchDeltaToTrackZoom,
  clampTimelinePixelsPerSecond,
  clampTimelineTrackZoom,
  getTimelineZoomBounds,
  getTimelineZoomDisplayMultipliers,
  getTimelineZoomMultiplierBounds,
  isTimelineZoomAtDefault,
  pixelsPerSecondFromZoomMultiplier,
  TIMELINE_DEFAULT_PIXELS_PER_SECOND,
} from '@/src/audio/timelineZoom';
import {
  barsPerCycleAtPps,
  loopPeakIndex,
  normalizePeakAt,
  peakToAbsoluteScale,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_PIXELS_PER_SECOND,
} from '@/src/audio/waveform';
import { FloatingHeaderButton } from '@/src/components/FloatingHeaderButton';
import { LoopColumnOverlay } from '@/src/components/LoopColumnOverlay';
import { TRACK_ROW_ENTER, TRACK_ROW_EXIT } from '@/src/components/listTransitions';
import {
  LOOP_EXPAND_DURATION_MS,
  LOOP_EXPAND_EASING,
  LOOP_ROW_HEIGHT,
  LOOP_ROW_HEIGHT_EXPANDED,
  LoopRegionBar,
  type LoopOverlayConfig,
  type LoopPreviewState,
} from '@/src/components/LoopRegionBar';
import {
  buildMetronomeGridLines,
  getFollowBarPaintTimeRange,
  getMetronomeGridBufferRange,
  isMetronomeGridBufferValid,
  METRONOME_GRID_BUFFER_VIEWPORTS,
  METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS,
  MetronomeTrackGrid,
  resolvePlaybackBarPaintRange,
  shouldReseedPlaybackViewport,
  type MetronomeGridBuffer,
} from '@/src/components/MetronomeGridOverlay';
import {
  TrackFadeOverlay,
  type FadeOverlayConfig,
  type FadeRegionState,
} from '@/src/components/track-editor/TrackFadeOverlay';
import { TimelineZoomDialog } from '@/src/components/TimelineZoomDialog';
import {
  getVisibleBarIndexRange,
  getVisibleMarkerSeconds,
} from '@/src/components/waveformViewport';
import type { MetronomeSettings } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { formatMarkerTime } from '@/src/utils/format';

export type { FadeOverlayConfig, FadeRegionState };

const BAR_WIDTH = WAVEFORM_BAR_WIDTH;
const BAR_GAP = WAVEFORM_BAR_GAP;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const MARKER_ROW_HEIGHT = 24;
const PLAYHEAD_CAP_SIZE = 6;
const MIN_LABEL_SPACING = 48;
/** Fixed label column width so timestamps center on the 1px tick (tabular M:SS). */
const MARKER_LABEL_WIDTH = 28;
const MARKER_TICK_WIDTH = 1;
const TIMELINE_HEADROOM_SECONDS = 30;
const LAYOUT_DURATION_STEP_SECONDS = 30;
/** Min interval between React viewport/grid commits while auto-scrolling. */
const VIEWPORT_COMMIT_MIN_MS = 100;
const TRIM_SIDE_BORDER = 16;
const TRIM_SIDE_BORDER_EXPANDED = 24;
const TRIM_EDGE_BORDER = 2;
const TRIM_HANDLE_TOUCH = 72;
const TRIM_HANDLE_TOUCH_EXPANDED = 88;
const TRIM_EDGE_SCROLL_ZONE = 56;
const TRIM_EDGE_SCROLL_MAX_SPEED = 12;
const TRIM_HANDLE_COLOR = '#FFCC00';
const TRIM_TAP_MOVE_THRESHOLD = 6;
const TRIM_EXPAND_IDLE_MS = 3000;
const TRIM_DRAG_HANDLE_OPACITY = 0.4;
const MOVE_BORDER_WIDTH = 2;
const MIN_PINCH_SPAN = 10;
const TRACK_ZOOM_SCROLL_THRESHOLD = 1.01;
/** Keep zoom readout + Reset visible this long after a pinch ends. */
const ZOOM_CONTROLS_LINGER_MS = 5000;
/** Logic-style region header strip above the waveform body. */
const REGION_HEADER_HEIGHT = 18;
const TRACK_LOOP_EPSILON = 0.001;
/** Min cycle segment width before drawing a per-loop header icon. */
const LOOP_HEADER_ICON_MIN_WIDTH = 16;

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
  /** File origin on the timeline (layer.startTime). */
  layerStartTime: number;
  /** Full file duration for clampTrimValues. */
  layerDuration: number;
  trimIn: number;
  trimOut: number;
  onChange: (trimIn: number, trimOut: number) => void;
  snapIntervalSec?: number | null;
};

export type MoveOverlayConfig = {
  layerId: string;
  startTime: number;
  trimIn: number;
  onChange: (startTime: number) => void;
  snapIntervalSec?: number | null;
};

function resolveFadeForTrack(
  fadeOverlay: FadeOverlayConfig | undefined,
  trackId: string
): FadeRegionState | null {
  if (!fadeOverlay || fadeOverlay.layerId !== trackId) {
    return null;
  }
  return fadeOverlay.fades;
}

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
  /** Visible footprint duration (includes loops). */
  duration: number;
  /**
   * One keep-region cycle length for peak tiling.
   * Defaults to `duration` when unset (no loop).
   */
  cycleDuration?: number;
  isActive: boolean;
  isMuted?: boolean;
  isSoloed?: boolean;
  isSoloedOut?: boolean;
  isLocked?: boolean;
  /** True when the track has an active loopUntil footprint beyond one cycle. */
  isLooped?: boolean;
  /** Total cycle plays when looped (same as Loop Track dialog count). */
  loopCount?: number;
  /** Layer volume in dB; scales waveform bars for every track. */
  volumeDb?: number;
  /** Fade envelope (footprint seconds); scales waveform bars. */
  fadeInSec?: number;
  fadeOutSec?: number;
  fadeInCurve?: number;
  fadeOutCurve?: number;
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

/** Per-track loop dialog entry from the region header long-press. */
export type TrackLoopOverlayConfig = {
  onHeaderLongPress: (layerId: string) => void;
  /** When false, header long-press is disabled (playing/recording). */
  editable?: boolean;
};

export type TimelineZoomControlsState = {
  visible: boolean;
  x: number;
  y: number;
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
  /** Pause playback when the user starts scrubbing the timeline while playing. */
  onPlaybackScrubStart?: () => void;
  /** Resume playback after a scrub that began while playing. */
  onPlaybackScrubEnd?: () => void;
  onTrackPress: (trackId: string) => void;
  onTrackDeselect?: () => void;
  onTrackLongPress?: (trackId: string) => void;
  onWidthChange?: (width: number) => void;
  /** Trim/move (and loop) pan gesture active — used for draft idle autosave. */
  onEditGestureActive?: (active: boolean) => void;
  /** Zoom readout visibility + multipliers for the memo header chip. */
  onZoomControlsChange?: (state: TimelineZoomControlsState) => void;
  /** Persist grid subdivision picked from horizontal zoom on every zoom commit. */
  onMetronomeGridSubdivisionSync?: (partial: Partial<MetronomeSettings>) => void;
  /** Fires while grid lines are rebuilding after grid-affecting metronome changes. */
  onMetronomeGridProcessingChange?: (processing: boolean) => void;
  trimOverlay?: TrimOverlayConfig;
  moveOverlay?: MoveOverlayConfig;
  fadeOverlay?: FadeOverlayConfig;
  loopOverlay?: LoopOverlayConfig;
  /** Per-track loop dialog from region header (distinct from memo A–B loopOverlay). */
  trackLoopOverlay?: TrackLoopOverlayConfig;
  metronome?: MetronomeSettings;
};

function mixHexTowardWhite(hex: string, amount: number, alpha = 1): string {
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
  const t = Math.max(0, Math.min(1, amount));
  const a = Math.max(0, Math.min(1, alpha));
  const r = Math.round(parseInt(value.slice(0, 2), 16) + (255 - parseInt(value.slice(0, 2), 16)) * t);
  const g = Math.round(parseInt(value.slice(2, 4), 16) + (255 - parseInt(value.slice(2, 4), 16)) * t);
  const b = Math.round(parseInt(value.slice(4, 6), 16) + (255 - parseInt(value.slice(4, 6), 16)) * t);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

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
  layerStartTime,
  layerDuration,
  trimIn,
  trimOut,
  pixelsPerSecond,
  snapIntervalSec,
  onChange,
  trimScrollHelpers,
}: {
  track: TrackData;
  sidePadding: number;
  trackHeight: number;
  layerStartTime: number;
  layerDuration: number;
  trimIn: number;
  trimOut: number;
  pixelsPerSecond: number;
  snapIntervalSec?: number | null;
  onChange: (trimIn: number, trimOut: number) => void;
  trimScrollHelpers: TrimScrollHelpers;
}) {
  type TrimSide = 'left' | 'right';
  const { styles } = useWaveformTheme();
  const cycleDuration = Math.max(0.01, track.cycleDuration ?? track.duration);
  const trimLeft = sidePadding + track.startTime * pixelsPerSecond;
  const trimRight = sidePadding + (track.startTime + cycleDuration) * pixelsPerSecond;
  const startTrimIn = useRef(trimIn);
  const startTrimOut = useRef(trimOut);
  const scrollXAtGrant = useRef(0);
  const dragActiveRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const trimScrollHelpersRef = useRef(trimScrollHelpers);
  const layerStartTimeRef = useRef(layerStartTime);
  const layerDurationRef = useRef(layerDuration);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  const snapIntervalRef = useRef(snapIntervalSec);
  onChangeRef.current = onChange;
  trimScrollHelpersRef.current = trimScrollHelpers;
  layerStartTimeRef.current = layerStartTime;
  layerDurationRef.current = layerDuration;
  pixelsPerSecondRef.current = pixelsPerSecond;
  snapIntervalRef.current = snapIntervalSec;

  const [expandedSide, setExpandedSide] = useState<TrimSide | null>(null);
  const expandedSideRef = useRef(expandedSide);
  expandedSideRef.current = expandedSide;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leftBorderSV = useSharedValue(TRIM_SIDE_BORDER);
  const rightBorderSV = useSharedValue(TRIM_SIDE_BORDER);
  const leftHandleTouchSV = useSharedValue(TRIM_HANDLE_TOUCH);
  const rightHandleTouchSV = useSharedValue(TRIM_HANDLE_TOUCH);
  const selectionOpacitySV = useSharedValue(1);
  const trimLeftSV = useSharedValue(trimLeft);
  const trimRightSV = useSharedValue(trimRight);
  const trackHeightSV = useSharedValue(trackHeight);
  trimLeftSV.value = trimLeft;
  trimRightSV.value = trimRight;
  trackHeightSV.value = trackHeight;

  useEffect(() => {
    const timing = { duration: LOOP_EXPAND_DURATION_MS, easing: LOOP_EXPAND_EASING };
    leftBorderSV.value = withTiming(
      expandedSide === 'left' ? TRIM_SIDE_BORDER_EXPANDED : TRIM_SIDE_BORDER,
      timing
    );
    rightBorderSV.value = withTiming(
      expandedSide === 'right' ? TRIM_SIDE_BORDER_EXPANDED : TRIM_SIDE_BORDER,
      timing
    );
    leftHandleTouchSV.value = withTiming(
      expandedSide === 'left' ? TRIM_HANDLE_TOUCH_EXPANDED : TRIM_HANDLE_TOUCH,
      timing
    );
    rightHandleTouchSV.value = withTiming(
      expandedSide === 'right' ? TRIM_HANDLE_TOUCH_EXPANDED : TRIM_HANDLE_TOUCH,
      timing
    );
  }, [
    expandedSide,
    leftBorderSV,
    leftHandleTouchSV,
    rightBorderSV,
    rightHandleTouchSV,
  ]);

  const clearIdleTimer = () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const scheduleIdleCollapse = () => {
    clearIdleTimer();
    if (expandedSideRef.current == null) {
      return;
    }
    idleTimerRef.current = setTimeout(() => {
      setExpandedSide(null);
    }, TRIM_EXPAND_IDLE_MS);
  };

  const expandSide = (side: TrimSide) => {
    setExpandedSide(side);
    scheduleIdleCollapse();
  };

  const collapseSide = () => {
    if (expandedSideRef.current == null) {
      return;
    }
    setExpandedSide(null);
  };

  const toggleExpandedFromTap = (side: TrimSide) => {
    if (expandedSideRef.current === side) {
      collapseSide();
    } else {
      expandSide(side);
    }
  };

  const noteInteraction = () => {
    if (expandedSideRef.current != null) {
      scheduleIdleCollapse();
    }
  };

  useEffect(() => {
    if (expandedSide != null) {
      scheduleIdleCollapse();
    } else {
      clearIdleTimer();
    }
    return clearIdleTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduleIdleCollapse uses refs
  }, [expandedSide]);

  const animatedSelectionStyle = useAnimatedStyle(() => ({
    borderLeftWidth: leftBorderSV.value,
    borderRightWidth: rightBorderSV.value,
    opacity: selectionOpacitySV.value,
  }));

  const animatedLeftHandleStyle = useAnimatedStyle(() => ({
    width: leftHandleTouchSV.value,
    left: trimLeftSV.value - leftHandleTouchSV.value / 2,
    height: trackHeightSV.value,
  }));

  const animatedRightHandleStyle = useAnimatedStyle(() => ({
    width: rightHandleTouchSV.value,
    left: trimRightSV.value - rightHandleTouchSV.value / 2,
    height: trackHeightSV.value,
  }));

  const beginTrimGestureRef = useRef((_side: TrimSide) => {});
  beginTrimGestureRef.current = () => {
    dragActiveRef.current = false;
    scrollXAtGrant.current = trimScrollHelpersRef.current.getScrollX();
    startTrimIn.current = trimIn;
    startTrimOut.current = trimOut;
    trimScrollHelpersRef.current.onTrimGestureActive(true);
  };

  const endTrimGestureRef = useRef(
    (_side: TrimSide, _event: GestureResponderEvent, _gesture: PanResponderGestureState) => {}
  );
  endTrimGestureRef.current = (side, _event, gesture) => {
    const movement = Math.abs(gesture.dx) + Math.abs(gesture.dy);
    const isTap = !dragActiveRef.current && movement < TRIM_TAP_MOVE_THRESHOLD;
    selectionOpacitySV.value = withTiming(1, { duration: 120 });
    trimScrollHelpersRef.current.onTrimGestureActive(false);
    if (isTap) {
      toggleExpandedFromTap(side);
      return;
    }
    expandSide(side);
  };

  const getEffectiveDx = (gesture: PanResponderGestureState): number => {
    const helpers = trimScrollHelpersRef.current;
    return gesture.dx + (helpers.getScrollX() - scrollXAtGrant.current);
  };

  const ensureDragActive = (side: TrimSide, gesture: PanResponderGestureState) => {
    if (dragActiveRef.current) {
      return true;
    }
    const movement = Math.abs(gesture.dx) + Math.abs(gesture.dy);
    if (movement < TRIM_TAP_MOVE_THRESHOLD) {
      return false;
    }
    dragActiveRef.current = true;
    selectionOpacitySV.value = withTiming(TRIM_DRAG_HANDLE_OPACITY, { duration: 80 });
    expandSide(side);
    return true;
  };

  /** Snap a file-time trim edge; do not clamp to memo layoutDuration. */
  const applyTrimSnap = (fileTime: number): number => {
    const interval = snapIntervalRef.current;
    if (interval == null || !(interval > 0)) {
      return fileTime;
    }
    const timelineTime = layerStartTimeRef.current + fileTime;
    const snappedTimeline = Math.round(timelineTime / interval) * interval;
    return snappedTimeline - layerStartTimeRef.current;
  };

  const leftMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  leftMoveRef.current = (_event, gesture) => {
    if (!ensureDragActive('left', gesture)) {
      return;
    }
    noteInteraction();
    const pps = pixelsPerSecondRef.current;
    const effectiveDx = getEffectiveDx(gesture);
    const rawIn = applyTrimSnap(startTrimIn.current + effectiveDx / pps);
    const next = clampTrimValues(
      rawIn,
      startTrimOut.current,
      layerDurationRef.current,
      null
    );
    onChangeRef.current(next.trimIn, next.trimOut);
  };

  const rightMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  rightMoveRef.current = (_event, gesture) => {
    if (!ensureDragActive('right', gesture)) {
      return;
    }
    noteInteraction();
    const pps = pixelsPerSecondRef.current;
    const effectiveDx = getEffectiveDx(gesture);
    const rawOut = applyTrimSnap(startTrimOut.current + effectiveDx / pps);
    const next = clampTrimValues(
      startTrimIn.current,
      rawOut,
      layerDurationRef.current,
      null
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
      onPanResponderGrant: () => beginTrimGestureRef.current('left'),
      onPanResponderMove: (event, gesture) => leftMoveRef.current(event, gesture),
      onPanResponderRelease: (event, gesture) =>
        endTrimGestureRef.current('left', event, gesture),
      onPanResponderTerminate: (event, gesture) =>
        endTrimGestureRef.current('left', event, gesture),
    })
  ).current;

  const rightResponder = useRef(
    PanResponder.create({
      ...trimPanCapture,
      onPanResponderGrant: () => beginTrimGestureRef.current('right'),
      onPanResponderMove: (event, gesture) => rightMoveRef.current(event, gesture),
      onPanResponderRelease: (event, gesture) =>
        endTrimGestureRef.current('right', event, gesture),
      onPanResponderTerminate: (event, gesture) =>
        endTrimGestureRef.current('right', event, gesture),
    })
  ).current;

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.trimSelection,
          {
            left: trimLeft,
            width: Math.max(TRIM_SIDE_BORDER_EXPANDED * 2, trimRight - trimLeft),
            height: trackHeight,
          },
          animatedSelectionStyle,
        ]}
      />
      <Animated.View
        {...leftResponder.panHandlers}
        style={[styles.trimSideHandle, animatedLeftHandleStyle]}
      />
      <Animated.View
        {...rightResponder.panHandlers}
        style={[styles.trimSideHandle, animatedRightHandleStyle]}
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
  layoutDuration,
  snapIntervalSec,
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
  layoutDuration: number;
  snapIntervalSec?: number | null;
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
  const trimInRef = useRef(trimIn);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  const layoutDurationRef = useRef(layoutDuration);
  const snapIntervalRef = useRef(snapIntervalSec);
  onChangeRef.current = onChange;
  trimScrollHelpersRef.current = trimScrollHelpers;
  trimInRef.current = trimIn;
  pixelsPerSecondRef.current = pixelsPerSecond;
  layoutDurationRef.current = layoutDuration;
  snapIntervalRef.current = snapIntervalSec;

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

  const moveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  moveRef.current = (_event, gesture) => {
    const pps = pixelsPerSecondRef.current;
    const effectiveDx = getEffectiveDx(gesture);
    const trimInValue = trimInRef.current;
    let nextStartTime = startLayerStartTime.current + effectiveDx / pps;
    const interval = snapIntervalRef.current;
    if (interval != null && interval > 0) {
      const activeStart = nextStartTime + trimInValue;
      const snappedActive = snapTimeToGrid(
        activeStart,
        interval,
        layoutDurationRef.current
      );
      nextStartTime = snappedActive - trimInValue;
    }
    nextStartTime = Math.max(-trimInValue, nextStartTime);
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
  if ((a.cycleDuration ?? a.duration) !== (b.cycleDuration ?? b.duration)) {
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
  if (a.isLocked !== b.isLocked) {
    return false;
  }
  if (Boolean(a.isLooped) !== Boolean(b.isLooped)) {
    return false;
  }
  if ((a.loopCount ?? 0) !== (b.loopCount ?? 0)) {
    return false;
  }
  if (a.volumeDb !== b.volumeDb) {
    return false;
  }
  if (
    a.fadeInSec !== b.fadeInSec ||
    a.fadeOutSec !== b.fadeOutSec ||
    a.fadeInCurve !== b.fadeInCurve ||
    a.fadeOutCurve !== b.fadeOutCurve
  ) {
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
  layoutDuration: number;
  visibleTimeStart: number;
  visibleTimeEnd: number;
  onPress: (locationX: number) => void;
  onLongPress?: () => void;
  trimOverlay?: TrimOverlayConfig;
  moveOverlay?: MoveOverlayConfig;
  fadeOverlay?: FadeOverlayConfig;
  trackLoopOverlay?: TrackLoopOverlayConfig;
  trimScrollHelpers?: TrimScrollHelpers;
  showBottomDivider?: boolean;
};

function areTrackWaveformRowPropsEqual(
  prev: TrackWaveformRowProps,
  next: TrackWaveformRowProps
): boolean {
  if (
    prev.sidePadding !== next.sidePadding ||
    prev.trackHeight !== next.trackHeight ||
    prev.pixelsPerSecond !== next.pixelsPerSecond ||
    prev.layoutDuration !== next.layoutDuration ||
    prev.visibleTimeStart !== next.visibleTimeStart ||
    prev.visibleTimeEnd !== next.visibleTimeEnd ||
    prev.showBottomDivider !== next.showBottomDivider ||
    prev.trimScrollHelpers !== next.trimScrollHelpers
  ) {
    return false;
  }
  // contentWidth/bandWidth grow with layout headroom; ignore when bar counts are unchanged.
  if (prev.contentWidth !== next.contentWidth || prev.bandWidth !== next.bandWidth) {
    const prevBars = getTrackBarCount(
      prev.track.duration,
      prev.contentWidth,
      prev.pixelsPerSecond
    );
    const nextBars = getTrackBarCount(
      next.track.duration,
      next.contentWidth,
      next.pixelsPerSecond
    );
    if (prevBars !== nextBars) {
      return false;
    }
    const prevLive = prev.track.liveRecording;
    const nextLive = next.track.liveRecording;
    if (prevLive || nextLive) {
      if (!prevLive || !nextLive) {
        return false;
      }
      if (
        getTrackBarCount(prevLive.duration, prev.contentWidth, prev.pixelsPerSecond) !==
        getTrackBarCount(nextLive.duration, next.contentWidth, next.pixelsPerSecond)
      ) {
        return false;
      }
    }
  }
  if (
    prev.trimOverlay?.layerId !== next.trimOverlay?.layerId ||
    prev.trimOverlay?.layerStartTime !== next.trimOverlay?.layerStartTime ||
    prev.trimOverlay?.layerDuration !== next.trimOverlay?.layerDuration ||
    prev.trimOverlay?.trimIn !== next.trimOverlay?.trimIn ||
    prev.trimOverlay?.trimOut !== next.trimOverlay?.trimOut ||
    prev.trimOverlay?.snapIntervalSec !== next.trimOverlay?.snapIntervalSec
  ) {
    return false;
  }
  if (
    prev.moveOverlay?.layerId !== next.moveOverlay?.layerId ||
    prev.moveOverlay?.startTime !== next.moveOverlay?.startTime ||
    prev.moveOverlay?.trimIn !== next.moveOverlay?.trimIn ||
    prev.moveOverlay?.snapIntervalSec !== next.moveOverlay?.snapIntervalSec
  ) {
    return false;
  }
  if (
    prev.trackLoopOverlay?.editable !== next.trackLoopOverlay?.editable ||
    prev.trackLoopOverlay?.onHeaderLongPress !== next.trackLoopOverlay?.onHeaderLongPress
  ) {
    return false;
  }
  const prevFade = resolveFadeForTrack(prev.fadeOverlay, prev.track.id);
  const nextFade = resolveFadeForTrack(next.fadeOverlay, next.track.id);
  if (
    prev.fadeOverlay?.layerId !== next.fadeOverlay?.layerId ||
    prev.fadeOverlay?.editable !== next.fadeOverlay?.editable ||
    prev.fadeOverlay?.snapIntervalSec !== next.fadeOverlay?.snapIntervalSec ||
    prevFade?.fadeInSec !== nextFade?.fadeInSec ||
    prevFade?.fadeOutSec !== nextFade?.fadeOutSec ||
    prevFade?.fadeInCurve !== nextFade?.fadeInCurve ||
    prevFade?.fadeOutCurve !== nextFade?.fadeOutCurve
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
  layoutDuration,
  visibleTimeStart,
  visibleTimeEnd,
  onPress,
  onLongPress,
  trimOverlay,
  moveOverlay,
  fadeOverlay,
  trackLoopOverlay,
  trimScrollHelpers,
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

  const cycleDuration = Math.max(
    TRACK_LOOP_EPSILON,
    track.cycleDuration ?? track.duration
  );
  const barCount = getTrackBarCount(track.duration, contentWidth, pixelsPerSecond);
  const barsPerCycle = Math.min(
    contentWidth / BAR_STEP,
    barsPerCycleAtPps(cycleDuration, pixelsPerSecond, BAR_STEP)
  );
  const cycleBarCount = Math.max(1, Math.floor(barsPerCycle));
  const trackOffset = track.startTime * pixelsPerSecond;
  const trackWidth = barCount * BAR_STEP;

  const visibleBars = useMemo(() => {
    // Invalid / unset viewport must not mount every bar (stack arm remount freeze).
    if (visibleTimeEnd <= visibleTimeStart) {
      return { startIndex: 0, endIndex: 0 };
    }
    return getVisibleBarIndexRange(
      visibleTimeStart,
      visibleTimeEnd,
      track.startTime,
      barCount,
      pixelsPerSecond,
      BAR_STEP
    );
  }, [barCount, pixelsPerSecond, track.startTime, visibleTimeEnd, visibleTimeStart]);

  const liveRecording = track.liveRecording;
  const liveBarCount = liveRecording
    ? getTrackBarCount(liveRecording.duration, contentWidth, pixelsPerSecond)
    : 0;
  const liveTrackOffset = liveRecording ? liveRecording.startTime * pixelsPerSecond : 0;
  const liveTrackWidth = liveBarCount * BAR_STEP;

  const visibleLiveBars = useMemo(() => {
    if (!liveRecording) {
      return { startIndex: 0, endIndex: 0 };
    }
    if (visibleTimeEnd <= visibleTimeStart) {
      return { startIndex: 0, endIndex: 0 };
    }
    return getVisibleBarIndexRange(
      visibleTimeStart,
      visibleTimeEnd,
      liveRecording.startTime,
      liveBarCount,
      pixelsPerSecond,
      BAR_STEP
    );
  }, [
    liveBarCount,
    liveRecording,
    pixelsPerSecond,
    visibleTimeEnd,
    visibleTimeStart,
  ]);

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

  const volumeScale = dbToLinear(track.volumeDb ?? 0);
  const showTrimOverlay = trimOverlay?.layerId === track.id;
  const showMoveOverlay = moveOverlay?.layerId === track.id;
  const trackFadeState = resolveFadeForTrack(fadeOverlay, track.id);
  const showFadeOverlay = fadeOverlay?.layerId === track.id && trackFadeState != null;
  const showRegionChrome =
    track.isActive && !showTrimOverlay && trackWidth > 0;
  const headerHeight = showRegionChrome ? REGION_HEADER_HEIGHT : 0;
  const bodyHeight = Math.max(0, trackHeight - headerHeight);
  const bodyTop = headerHeight;
  const headerLongPressEnabled =
    Boolean(trackLoopOverlay) &&
    trackLoopOverlay?.editable !== false &&
    !showTrimOverlay &&
    !showMoveOverlay;
  const barColor = getTrackBarColor(track, colors);
  const mutedBarColor = colors.waveformBar;
  const loopedBarColor =
    track.isMuted || track.isSoloedOut
      ? mutedBarColor
      : mixHexTowardWhite(track.color ?? colors.accent, 0.45);
  const bandBackground = getTrackBandBackground(track, colors);
  const trackColor = track.color ?? colors.accent;
  // Lighter, slightly translucent track color — stronger than the body tint.
  const headerColor = mixHexTowardWhite(trackColor, 0.35, 0.52);
  // Faded tint for looped cycles (mirrors loopedBarColor treatment).
  const loopedHeaderColor = mixHexTowardWhite(trackColor, 0.55, 0.38);
  const hasLoopedHeaderCycles = cycleDuration + TRACK_LOOP_EPSILON < track.duration;
  const headerCycleSegments = useMemo(() => {
    if (!showRegionChrome || trackWidth <= 0) {
      return [] as { left: number; width: number; isLoop: boolean }[];
    }
    if (!hasLoopedHeaderCycles) {
      return [{ left: 0, width: trackWidth, isLoop: false }];
    }
    const segments: { left: number; width: number; isLoop: boolean }[] = [];
    const cycleWidthPx = cycleDuration * pixelsPerSecond;
    let left = 0;
    let cycleIndex = 0;
    while (left < trackWidth - 0.5) {
      const width = Math.min(cycleWidthPx, trackWidth - left);
      if (width > 0.5) {
        segments.push({ left, width, isLoop: cycleIndex > 0 });
      }
      left += cycleWidthPx;
      cycleIndex += 1;
      if (cycleIndex > 10_000) {
        break;
      }
    }
    return segments;
  }, [showRegionChrome, trackWidth, hasLoopedHeaderCycles, cycleDuration, pixelsPerSecond]);
  // Keep selected region fill in the same ballpark as the pre-header selection tint.
  const regionBodyColor = colorWithAlpha(trackColor, 0.08);
  // Match region header label (#FFFFFF) on the tinted selected header; gray elsewhere.
  const statusIconTint = track.isActive ? '#FFFFFF' : colors.lockBadge;
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
      ? trackOffset
      : fullSelectionStart;
  const selectionEnd =
    showTrimOverlay && trimOverlay
      ? trackOffset + cycleDuration * pixelsPerSecond
      : fullSelectionEnd;
  const selectionWidth = selectionEnd - selectionStart;

  const rowContent = (
    <View
      style={[
        styles.waveformBand,
        { width: bandWidth, height: trackHeight },
      ]}>
      {/* Active lane fill only for t >= 0 — left padding stays empty/dimmed. */}
      {contentWidth > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.trackContentBackground,
            {
              left: sidePadding,
              width: contentWidth,
              height: trackHeight,
              backgroundColor: bandBackground,
            },
          ]}
        />
      ) : null}
      <TimelineDimRegions
        bandWidth={bandWidth}
        contentWidth={contentWidth}
        height={trackHeight}
        sidePadding={sidePadding}
      />
      <View
        pointerEvents="none"
        style={[
          styles.centerLine,
          {
            left: sidePadding,
            width: contentWidth,
            top: bodyTop + bodyHeight / 2,
            marginTop: -0.5,
          },
        ]}
      />
      {showRegionChrome ? (
        <View
          pointerEvents="none"
          style={[
            styles.regionBodyFill,
            {
              left: sidePadding + trackOffset,
              top: bodyTop,
              width: trackWidth,
              height: bodyHeight,
              backgroundColor: regionBodyColor,
            },
          ]}
        />
      ) : null}
      {showRegionChrome ? (
        <Pressable
          delayLongPress={LONG_PRESS_DELAY_MS}
          disabled={!headerLongPressEnabled}
          style={[
            styles.regionHeader,
            {
              left: sidePadding + trackOffset,
              width: trackWidth,
              height: headerHeight,
              backgroundColor: hasLoopedHeaderCycles ? 'transparent' : headerColor,
            },
          ]}
          onLongPress={() => {
            if (!headerLongPressEnabled || !trackLoopOverlay) {
              return;
            }
            clearLongPressTimer();
            longPressTriggeredRef.current = true;
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            trackLoopOverlay.onHeaderLongPress(track.id);
          }}>
          {hasLoopedHeaderCycles
            ? headerCycleSegments.map((segment, index) => (
                <View
                  key={`header-cycle-${index}`}
                  pointerEvents="none"
                  style={[
                    styles.regionHeaderCycleFill,
                    {
                      left: segment.left,
                      width: segment.width,
                      backgroundColor: segment.isLoop ? loopedHeaderColor : headerColor,
                    },
                  ]}
                />
              ))
            : null}
          {hasLoopedHeaderCycles
            ? headerCycleSegments.map((segment, index) =>
                segment.isLoop && segment.width >= LOOP_HEADER_ICON_MIN_WIDTH ? (
                  <View
                    key={`header-loop-icon-${index}`}
                    pointerEvents="none"
                    style={[
                      styles.regionHeaderCycleIcon,
                      { left: segment.left + 4 },
                    ]}>
                    <SymbolView name={{ ios: 'repeat' }} size={11} tintColor="#FFFFFF" />
                  </View>
                ) : null
              )
            : null}
          {track.showLabel && track.label ? (
            <Text
              numberOfLines={1}
              pointerEvents="none"
              style={[
                styles.regionHeaderLabel,
                {
                  maxWidth: Math.max(
                    0,
                    trackWidth -
                      (track.isLocked ||
                      track.isLooped ||
                      track.isMuted ||
                      track.isSoloed
                        ? 44
                        : 10)
                  ),
                },
              ]}>
              {track.label}
            </Text>
          ) : null}
          {track.isMuted ? (
            <View pointerEvents="none" style={[styles.regionHeaderBadge, styles.mutedBadge]}>
              <Text style={styles.mutedBadgeText}>M</Text>
            </View>
          ) : null}
          {track.isSoloed ? (
            <View pointerEvents="none" style={[styles.regionHeaderBadge, styles.soloBadge]}>
              <Text style={styles.soloBadgeText}>S</Text>
            </View>
          ) : null}
          {track.isLocked ? (
            <View pointerEvents="none" style={styles.regionHeaderLock}>
              <SymbolView name={{ ios: 'lock.fill' }} size={11} tintColor={statusIconTint} />
            </View>
          ) : null}
          {track.isLooped ? (
            <View pointerEvents="none" style={[styles.regionHeaderLock, styles.regionHeaderLoop]}>
              <SymbolView name={{ ios: 'repeat' }} size={11} tintColor={statusIconTint} />
              {track.loopCount != null && track.loopCount > 1 ? (
                <Text style={[styles.loopCountText, { color: statusIconTint }]}>
                  {track.loopCount}×
                </Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      ) : trackWidth > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.floatingStatusRow,
            {
              left: sidePadding + trackOffset + 4,
              maxWidth: Math.max(0, trackWidth - 8),
            },
          ]}>
          {track.showLabel && track.label ? (
            <Text numberOfLines={1} style={styles.floatingStatusLabel}>
              {track.label}
            </Text>
          ) : null}
          {track.isMuted ? (
            <View style={[styles.regionHeaderBadge, styles.mutedBadge]}>
              <Text style={styles.mutedBadgeText}>M</Text>
            </View>
          ) : null}
          {track.isSoloed ? (
            <View style={[styles.regionHeaderBadge, styles.soloBadge]}>
              <Text style={styles.soloBadgeText}>S</Text>
            </View>
          ) : null}
          {track.isLocked ? (
            <View style={styles.regionHeaderLock}>
              <SymbolView name={{ ios: 'lock.fill' }} size={11} tintColor={statusIconTint} />
            </View>
          ) : null}
          {track.isLooped ? (
            <View style={[styles.regionHeaderLock, styles.regionHeaderLoop]}>
              <SymbolView name={{ ios: 'repeat' }} size={11} tintColor={statusIconTint} />
              {track.loopCount != null && track.loopCount > 1 ? (
                <Text style={[styles.loopCountText, { color: statusIconTint }]}>
                  {track.loopCount}×
                </Text>
              ) : null}
            </View>
          ) : null}
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
                  top: bodyTop,
                  height: bodyHeight,
                  width: trackWidth,
                },
              ]}>
              {Array.from(
                { length: Math.max(0, visibleBars.endIndex - visibleBars.startIndex) },
                (_, offset) => {
                  const index = visibleBars.startIndex + offset;
                  const peakIndex = loopPeakIndex(index, barsPerCycle, cycleBarCount);
                  // Sample one bar — never allocate a full-track resample on zoom.
                  const peak = normalizePeakAt(track.peaks, cycleBarCount, peakIndex);
                  const barTime = (index * BAR_STEP) / pixelsPerSecond;
                  const trackFades = {
                    fadeInSec: track.fadeInSec ?? 0,
                    fadeOutSec: track.fadeOutSec ?? 0,
                    fadeInCurve: track.fadeInCurve ?? 0,
                    fadeOutCurve: track.fadeOutCurve ?? 0,
                  };
                  let fadeScale = 1;
                  if (
                    trackFades.fadeInSec > 0 ||
                    trackFades.fadeOutSec > 0
                  ) {
                    fadeScale = fadeEnvelopeGain(
                      barTime,
                      track.duration,
                      trackFades
                    );
                  }
                  const scaled = peakToAbsoluteScale(peak) * volumeScale * fadeScale;
                  const maxBar = Math.max(4, bodyHeight - 8);
                  const barHeight =
                    scaled <= 0.01
                      ? 2
                      : Math.max(4, Math.min(maxBar, scaled * maxBar));
                  const isLoopedCycle = barTime >= cycleDuration - TRACK_LOOP_EPSILON;
                  const fillColor = isLoopedCycle ? loopedBarColor : barColor;
                  return (
                    <View
                      key={index}
                      style={[
                        styles.bar,
                        {
                          left: index * BAR_STEP,
                          top: (bodyHeight - barHeight) / 2,
                          height: barHeight,
                          backgroundColor: fillColor,
                        },
                      ]}
                    />
                  );
                }
              )}
              {/* Cycle seams for looped footprints */}
              {cycleDuration + TRACK_LOOP_EPSILON < track.duration
                ? Array.from(
                    {
                      length: Math.max(
                        0,
                        Math.floor(track.duration / cycleDuration) - 1
                      ),
                    },
                    (_, seamIndex) => {
                      const seamTime = (seamIndex + 1) * cycleDuration;
                      const seamX = seamTime * pixelsPerSecond;
                      if (seamX <= 0 || seamX >= trackWidth) {
                        return null;
                      }
                      return (
                        <View
                          key={`seam-${seamIndex}`}
                          style={[
                            styles.loopSeam,
                            {
                              left: seamX,
                              height: bodyHeight,
                              backgroundColor: colorWithAlpha('#000000', 0.18),
                            },
                          ]}
                        />
                      );
                    }
                  )
                : null}
            </View>
          ) : null}
          {replaceTailDimWidth > 0 ? (
            <View
              style={[
                styles.replaceTailDim,
                {
                  left: replaceTailDimLeft,
                  top: bodyTop,
                  width: replaceTailDimWidth,
                  height: bodyHeight,
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
                  top: bodyTop,
                  height: bodyHeight,
                  width: liveTrackWidth,
                },
              ]}>
              {Array.from(
                { length: Math.max(0, visibleLiveBars.endIndex - visibleLiveBars.startIndex) },
                (_, offset) => {
                  const index = visibleLiveBars.startIndex + offset;
                  const peak = normalizePeakAt(liveRecording?.peaks, liveBarCount, index);
                  const scaled = peakToAbsoluteScale(peak);
                  const maxBar = Math.max(4, bodyHeight - 8);
                  const barHeight =
                    scaled <= 0.01
                      ? 2
                      : Math.max(4, Math.min(maxBar, scaled * maxBar));
                  return (
                    <View
                      key={`live-${index}`}
                      style={[
                        styles.bar,
                        {
                          left: index * BAR_STEP,
                          top: (bodyHeight - barHeight) / 2,
                          height: barHeight,
                          backgroundColor: colors.recordRed,
                        },
                      ]}
                    />
                  );
                }
              )}
            </View>
          ) : null}
        </View>
      ) : null}
      {showTrimOverlay && trimOverlay && trimScrollHelpers ? (
        <TrackTrimOverlay
          layerDuration={trimOverlay.layerDuration}
          layerStartTime={trimOverlay.layerStartTime}
          pixelsPerSecond={pixelsPerSecond}
          sidePadding={sidePadding}
          snapIntervalSec={trimOverlay.snapIntervalSec}
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
          layoutDuration={layoutDuration}
          pixelsPerSecond={pixelsPerSecond}
          sidePadding={sidePadding}
          snapIntervalSec={moveOverlay.snapIntervalSec}
          track={track}
          trackColor={trackColor}
          trackHeight={trackHeight}
          trimIn={moveOverlay.trimIn}
          trimScrollHelpers={trimScrollHelpers}
          onChange={moveOverlay.onChange}
        />
      ) : null}
      {showFadeOverlay && trackFadeState && fadeOverlay && trimScrollHelpers ? (
        <TrackFadeOverlay
          bodyHeight={bodyHeight}
          bodyTop={bodyTop}
          editable={fadeOverlay.layerId === track.id && fadeOverlay.editable !== false}
          fades={trackFadeState}
          layoutDuration={layoutDuration}
          pixelsPerSecond={pixelsPerSecond}
          sidePadding={sidePadding}
          snapIntervalSec={fadeOverlay.snapIntervalSec}
          track={track}
          trackHeight={trackHeight}
          trimScrollHelpers={trimScrollHelpers}
          onChange={
            fadeOverlay.layerId === track.id && fadeOverlay.editable !== false
              ? fadeOverlay.onChange
              : undefined
          }
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
            // Body tint already covers the region when chrome is shown — avoid stacking.
            backgroundColor: showRegionChrome
              ? 'transparent'
              : colorWithAlpha(trackColor, 0.08),
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

  // Single host for idle + play/record so toggling never remounts the bar subtree.
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
  onPlaybackScrubStart,
  onPlaybackScrubEnd,
  onTrackPress,
  onTrackDeselect,
  onTrackLongPress,
  onWidthChange,
  onEditGestureActive,
  onZoomControlsChange,
  onMetronomeGridSubdivisionSync,
  onMetronomeGridProcessingChange,
  trimOverlay,
  moveOverlay,
  fadeOverlay,
  loopOverlay,
  trackLoopOverlay,
  metronome,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useMemo(() => createWaveformStyles(colors), [colors]);
  const theme = useMemo(() => ({ colors, styles }), [colors, styles]);
  const scrollRef = useRef<GHScrollView>(null);
  const verticalScrollRef = useRef<GHScrollView>(null);
  const isUserScrollingRef = useRef(false);
  const resumeAfterScrubRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const verticalScrollOffsetRef = useRef(0);
  const trimGestureActiveRef = useRef(false);
  const zoomGestureActiveRef = useRef(false);
  const loopBarGestureRef = useRef<unknown>(undefined);
  const [trimGestureActive, setTrimGestureActive] = useState(false);
  const [zoomGestureActive, setZoomGestureActive] = useState(false);
  const [showZoomControls, setShowZoomControls] = useState(false);
  const [zoomDialogVisible, setZoomDialogVisible] = useState(false);
  const zoomDialogVisibleRef = useRef(false);
  zoomDialogVisibleRef.current = zoomDialogVisible;
  /** Skip enter on first paint so opening a memo does not fade every row. */
  const [trackTransitionsReady, setTrackTransitionsReady] = useState(false);
  useEffect(() => {
    setTrackTransitionsReady(true);
  }, []);
  const zoomControlsHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxScrollXRef = useRef(0);
  const maxScrollYRef = useRef(0);
  const getPlaybackTimeRef = useRef(getPlaybackTime);
  getPlaybackTimeRef.current = getPlaybackTime;
  const getRecordingTimeRef = useRef(getRecordingTime);
  getRecordingTimeRef.current = getRecordingTime;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const contentWidthRef = useRef(0);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onPlaybackScrubStartRef = useRef(onPlaybackScrubStart);
  onPlaybackScrubStartRef.current = onPlaybackScrubStart;
  const onPlaybackScrubEndRef = useRef(onPlaybackScrubEnd);
  onPlaybackScrubEndRef.current = onPlaybackScrubEnd;
  const onTrackPressRef = useRef(onTrackPress);
  onTrackPressRef.current = onTrackPress;
  const onTrackDeselectRef = useRef(onTrackDeselect);
  onTrackDeselectRef.current = onTrackDeselect;
  const onTrackLongPressRef = useRef(onTrackLongPress);
  onTrackLongPressRef.current = onTrackLongPress;
  const onEditGestureActiveRef = useRef(onEditGestureActive);
  onEditGestureActiveRef.current = onEditGestureActive;
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
  const pendingZoomRef = useRef<{
    pixelsPerSecond: number;
    trackZoom: number;
    scrollX: number;
    scrollY: number;
    maxScrollX: number;
  } | null>(null);
  const zoomCommitRafRef = useRef<number | null>(null);
  const scheduleZoomCommitRef = useRef(() => {});
  const containerRef = useRef<View>(null);
  const containerPageOffsetRef = useRef<PageOffset>({ x: 0, y: 0 });
  const loopOverlayRef = useRef(loopOverlay);
  loopOverlayRef.current = loopOverlay;
  const [loopRowExpanded, setLoopRowExpanded] = useState(false);
  const [loopPreview, setLoopPreview] = useState<LoopPreviewState | null>(null);
  /** Layout budget always uses the collapsed row; expand extra is animated separately. */
  const loopRowHeight = loopOverlay ? LOOP_ROW_HEIGHT : 0;
  const loopRowHeightRef = useRef(loopRowHeight);
  loopRowHeightRef.current = loopOverlay
    ? loopRowExpanded
      ? LOOP_ROW_HEIGHT_EXPANDED
      : LOOP_ROW_HEIGHT
    : 0;
  const loopExpandExtraSV = useSharedValue(0);
  const waveformAreaHeightSV = useSharedValue(1);
  const lastDoubleTapAtRef = useRef(0);
  const frozenZoomRef = useRef<FrozenTimelineZoom | null>(null);
  const prevFollowRecordingScrollRef = useRef(false);
  const wasFollowingRecordingScrollRef = useRef(false);

  // Follow-scroll RAF only while capturing — not during armed/warmup (avoids
  // fighting prepare/finalize/commit and freezing at 00:00).
  const followRecordingScroll = isRecording;
  // Still grow timeline headroom while armed/precount so the lane doesn't
  // collapse to a solid viewport-width block that looks like fake audio.
  const recordingLayoutHeadroom = recordingLayoutActive || isRecording;
  const followRecordingScrollRef = useRef(followRecordingScroll);
  followRecordingScrollRef.current = followRecordingScroll;
  const [followLayoutDuration, setFollowLayoutDuration] = useState(0);
  const followLayoutDurationRef = useRef(0);
  const zoomBounds = useMemo(
    () => getTimelineZoomBounds(viewportWidth, duration, tracks.length),
    [viewportWidth, duration, tracks.length]
  );
  zoomBoundsRef.current = zoomBounds;
  // Frozen for the whole take — rotation / split-view width changes must not
  // recompute pps mid-record (headroom still uses the new viewportWidth).
  const frozenZoom = followRecordingScroll ? frozenZoomRef.current : null;
  const layoutPixelsPerSecond = frozenZoom?.pixelsPerSecond ?? pixelsPerSecond;
  const layoutTrackZoom = frozenZoom?.trackZoom ?? trackZoom;

  const baseLayoutDuration = getLayoutDuration(
    duration,
    currentTime,
    viewportWidth,
    recordingLayoutHeadroom,
    layoutPixelsPerSecond
  );
  const layoutDuration = recordingLayoutHeadroom
    ? Math.max(baseLayoutDuration, followLayoutDuration)
    : baseLayoutDuration;
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
    viewportHeight > 0 ? viewportHeight - MARKER_ROW_HEIGHT - loopRowHeight : 1
  );
  waveformAreaHeightSV.value = waveformAreaHeight;
  const waveformAreaHeightRef = useRef(waveformAreaHeight);
  waveformAreaHeightRef.current = waveformAreaHeight;
  const tracksLengthRef = useRef(tracks.length);
  tracksLengthRef.current = tracks.length;
  const playheadHeight = waveformAreaHeight + loopRowHeight;
  const baseTrackHeight = waveformAreaHeight / Math.max(1, tracks.length);
  const trackHeight = baseTrackHeight * layoutTrackZoom;
  const tracksContentHeight = trackHeight * Math.max(1, tracks.length);
  const verticalScrollEnabled = layoutTrackZoom > TRACK_ZOOM_SCROLL_THRESHOLD;
  maxScrollYRef.current = Math.max(0, tracksContentHeight - waveformAreaHeight);

  const scrollX = timeToScrollX(currentTime, contentWidth, layoutPixelsPerSecond);

  const markerInterval = getMarkerInterval(layoutPixelsPerSecond);

  const [viewportTimeBuffer, setViewportTimeBuffer] = useState<MetronomeGridBuffer>({
    start: 0,
    end: 0,
  });
  const viewportTimeBufferRef = useRef<MetronomeGridBuffer | null>(null);

  const [metronomeGridLines, setMetronomeGridLines] = useState<MetronomeGridLine[]>([]);
  const metronomeGridBufferRef = useRef<MetronomeGridBuffer | null>(null);

  const timelineMarkers = useMemo(() => {
    if (metronome?.showGrid && metronome.gridBasis === 'time') {
      const { tickTimes, labelTimes } = getTimeGridMarkerTimesFromLines(
        metronomeGridLines,
        layoutPixelsPerSecond,
        MIN_LABEL_SPACING,
        layoutDuration
      );
      return {
        tickTimes,
        labelTimes: new Set(labelTimes),
      };
    }

    const seconds = getVisibleMarkerSeconds(
      viewportTimeBuffer.start,
      viewportTimeBuffer.end,
      layoutDuration,
      markerInterval
    );
    return {
      tickTimes: seconds,
      labelTimes: new Set(seconds.filter((second) => second % markerInterval === 0)),
    };
  }, [
    layoutDuration,
    layoutPixelsPerSecond,
    markerInterval,
    metronome?.showGrid,
    metronome?.gridBasis,
    metronomeGridLines,
    viewportTimeBuffer.end,
    viewportTimeBuffer.start,
  ]);

  const metronomeRef = useRef(metronome);
  metronomeRef.current = metronome;
  const subdivisionSyncFromZoomRef = useRef(false);
  const zoomSyncFromSubdivisionRef = useRef(false);
  const onMetronomeGridSubdivisionSyncRef = useRef(onMetronomeGridSubdivisionSync);
  onMetronomeGridSubdivisionSyncRef.current = onMetronomeGridSubdivisionSync;
  const onMetronomeGridProcessingChangeRef = useRef(onMetronomeGridProcessingChange);
  onMetronomeGridProcessingChangeRef.current = onMetronomeGridProcessingChange;
  const [metronomeGridProcessing, setMetronomeGridProcessing] = useState(false);
  const notifyMetronomeGridProcessingRef = useRef((_value: boolean) => {});
  notifyMetronomeGridProcessingRef.current = (value: boolean) => {
    setMetronomeGridProcessing(value);
    onMetronomeGridProcessingChangeRef.current?.(
      value && !zoomDialogVisibleRef.current
    );
  };
  const prevGridProcessingKeyRef = useRef<string | null>(null);
  const layoutPixelsPerSecondRef = useRef(layoutPixelsPerSecond);
  layoutPixelsPerSecondRef.current = layoutPixelsPerSecond;
  const viewportWidthRef = useRef(viewportWidth);
  viewportWidthRef.current = viewportWidth;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const layoutDurationRef = useRef(layoutDuration);
  layoutDurationRef.current = layoutDuration;
  const lastViewportCommitMsRef = useRef(0);
  const prevPlaybackDurationRef = useRef(0);

  const syncViewportBuffersRef = useRef((_scrollX: number, _force = false) => {});
  const autoScrollingRef = useRef(false);
  autoScrollingRef.current = isPlaying || followRecordingScroll;
  syncViewportBuffersRef.current = (nextScrollX: number, force = false) => {
    const settings = metronomeRef.current;
    const pps = layoutPixelsPerSecondRef.current;
    const vpWidth = viewportWidthRef.current;
    const gridDuration = Math.max(durationRef.current, layoutDurationRef.current);
    const bufferViewports = autoScrollingRef.current
      ? METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS
      : METRONOME_GRID_BUFFER_VIEWPORTS;
    // Wider validity margin while auto-scrolling so React bar remounts are rare.
    const validityMarginViewports = autoScrollingRef.current ? 1.5 : 0.5;
    const now = Date.now();
    const throttleCommits =
      autoScrollingRef.current &&
      !force &&
      now - lastViewportCommitMsRef.current < VIEWPORT_COMMIT_MIN_MS;

    const viewportBufferValid =
      !force &&
      isMetronomeGridBufferValid(
        viewportTimeBufferRef.current,
        nextScrollX,
        vpWidth,
        pps,
        validityMarginViewports,
        gridDuration
      );

    if (!viewportBufferValid && vpWidth > 0 && pps > 0 && gridDuration > 0) {
      const buffer = getMetronomeGridBufferRange(
        nextScrollX,
        vpWidth,
        pps,
        gridDuration,
        bufferViewports
      );
      // Always commit when invalid — never leave auto-scroll painting stale/empty.
      // Throttle only applies to already-valid refreshes (playback visible paint).
      viewportTimeBufferRef.current = buffer;
      lastViewportCommitMsRef.current = now;
      setViewportTimeBuffer((prev) =>
        prev.start === buffer.start && prev.end === buffer.end ? prev : buffer
      );
    } else if (
      // Playback paints visible-only bars; refresh the React window on the
      // throttle cadence so remounts track the playhead (ScrollView alone
      // cannot create bars ahead of the last paint range).
      isPlayingRef.current &&
      !followRecordingScroll &&
      !throttleCommits &&
      vpWidth > 0 &&
      pps > 0
    ) {
      const visible = getFollowBarPaintTimeRange(nextScrollX, vpWidth, pps);
      viewportTimeBufferRef.current = visible;
      lastViewportCommitMsRef.current = now;
      setViewportTimeBuffer((prev) =>
        prev.start === visible.start && prev.end === visible.end ? prev : visible
      );
    } else if (vpWidth <= 0 || pps <= 0 || gridDuration <= 0) {
      viewportTimeBufferRef.current = null;
      setViewportTimeBuffer((prev) =>
        prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 }
      );
    }

    if (!settings || !settings.showGrid || vpWidth <= 0 || pps <= 0 || gridDuration <= 0) {
      metronomeGridBufferRef.current = null;
      setMetronomeGridLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    if (
      !force &&
      isMetronomeGridBufferValid(
        metronomeGridBufferRef.current,
        nextScrollX,
        vpWidth,
        pps,
        validityMarginViewports,
        gridDuration
      )
    ) {
      return;
    }

    if (throttleCommits) {
      return;
    }

    const buffer = getMetronomeGridBufferRange(
      nextScrollX,
      vpWidth,
      pps,
      gridDuration,
      bufferViewports
    );
    metronomeGridBufferRef.current = buffer;
    lastViewportCommitMsRef.current = now;
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

  // Keep the old name as an alias so existing call sites stay valid.
  const syncMetronomeGridRef = syncViewportBuffersRef;

  useEffect(() => {
    syncMetronomeGridRef.current(scrollOffsetRef.current, true);
  }, [
    metronome?.bpm,
    metronome?.timeSignature,
    metronome?.accentEnabled,
    metronome?.showGrid,
    metronome?.gridBasis,
    metronome?.metronomeGridSubdivision,
    metronome?.timeGridSubdivision,
    layoutPixelsPerSecond,
    viewportWidth,
  ]);

  useEffect(() => {
    return () => {
      notifyMetronomeGridProcessingRef.current(false);
    };
  }, []);

  useLayoutEffect(() => {
    const notify = (value: boolean) => notifyMetronomeGridProcessingRef.current(value);
    const gridKey = metronome
      ? [
          metronome.showGrid,
          metronome.gridBasis,
          metronome.metronomeGridSubdivision,
          metronome.timeGridSubdivision,
          metronome.bpm,
          metronome.timeSignature,
        ].join(':')
      : 'off';

    if (followRecordingScrollRef.current || !metronome?.showGrid) {
      prevGridProcessingKeyRef.current = gridKey;
      notify?.(false);
      return;
    }

    const prevKey = prevGridProcessingKeyRef.current;
    prevGridProcessingKeyRef.current = gridKey;
    const isGridChange = prevKey !== null && prevKey !== gridKey;
    if (isGridChange) {
      notify?.(true);
    }

    const bounds = zoomBoundsRef.current;
    const targetPps = clampTimelinePixelsPerSecond(
      getPixelsPerSecondForGridSubdivision(
        metronome,
        bounds.pixelsPerSecondDefault,
        bounds.pixelsPerSecondMax
      ),
      bounds
    );
    const waitingForZoomSnap =
      isGridChange &&
      !zoomGestureActiveRef.current &&
      !subdivisionSyncFromZoomRef.current &&
      Math.abs(layoutPixelsPerSecond - targetPps) > 0.5;
    if (waitingForZoomSnap) {
      const timeout = setTimeout(() => {
        notify?.(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        notify?.(false);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) {
        cancelAnimationFrame(raf2);
      }
    };
  }, [
    metronome?.showGrid,
    metronome?.gridBasis,
    metronome?.metronomeGridSubdivision,
    metronome?.timeGridSubdivision,
    metronome?.bpm,
    metronome?.timeSignature,
    metronomeGridLines,
    layoutPixelsPerSecond,
  ]);

  useEffect(() => {
    if (
      !metronome?.showGrid ||
      zoomGestureActiveRef.current ||
      subdivisionSyncFromZoomRef.current ||
      followRecordingScrollRef.current
    ) {
      return;
    }
    const bounds = zoomBoundsRef.current;
    const target = clampTimelinePixelsPerSecond(
      getPixelsPerSecondForGridSubdivision(
        metronome,
        bounds.pixelsPerSecondDefault,
        bounds.pixelsPerSecondMax
      ),
      bounds
    );
    if (Math.abs(pixelsPerSecondRef.current - target) <= 0.5) {
      return;
    }
    zoomSyncFromSubdivisionRef.current = true;
    setPixelsPerSecond(target);
    queueMicrotask(() => {
      zoomSyncFromSubdivisionRef.current = false;
    });
  }, [
    metronome?.showGrid,
    metronome?.bpm,
    metronome?.timeSignature,
    metronome?.gridBasis,
    metronome?.metronomeGridSubdivision,
    metronome?.timeGridSubdivision,
  ]);

  // Seed a bounded window when width/duration catch up. Do not depend on
  // layoutDuration while recording — headroom steps would remount every bar.
  const playbackSeedDuration = isRecording ? 0 : duration;
  useLayoutEffect(() => {
    if (isRecording) {
      prevPlaybackDurationRef.current = duration;
      return;
    }
    const previousDuration = prevPlaybackDurationRef.current;
    prevPlaybackDurationRef.current = duration;
    if (
      !shouldReseedPlaybackViewport(
        viewportTimeBufferRef.current,
        viewportWidth,
        layoutPixelsPerSecond,
        duration,
        previousDuration
      )
    ) {
      return;
    }
    syncMetronomeGridRef.current(scrollOffsetRef.current, true);
  }, [isRecording, layoutPixelsPerSecond, playbackSeedDuration, viewportWidth]);

  useLayoutEffect(() => {
    const wasFollowing = prevFollowRecordingScrollRef.current;
    if (followRecordingScroll && !wasFollowing) {
      const bounds = zoomBoundsRef.current;
      // Clamp first, then cap at capture density. Cap-after-clamp so an inflated
      // bounds.min cannot re-raise pps above WAVEFORM_PIXELS_PER_SECOND (live
      // peaks are always captured at design density; higher display pps upsamples
      // / stretches bars). Zoomed-in → Record intentionally drops to 1× for the
      // take; do not force zoom-*up* when already zoomed out.
      // Sync React state so stop/unfreeze does not snap back to a stretched pps.
      const frozenPps = Math.min(
        WAVEFORM_PIXELS_PER_SECOND,
        clampTimelinePixelsPerSecond(pixelsPerSecond, bounds)
      );
      const snapshot: FrozenTimelineZoom = {
        pixelsPerSecond: frozenPps,
        trackZoom: clampTimelineTrackZoom(trackZoom, bounds),
        verticalScrollY: verticalScrollOffsetRef.current,
      };
      frozenZoomRef.current = snapshot;
      if (frozenPps !== pixelsPerSecond) {
        setPixelsPerSecond(frozenPps);
      }
      verticalScrollRef.current?.scrollTo({ y: snapshot.verticalScrollY, animated: false });
    } else if (!followRecordingScroll && wasFollowing) {
      frozenZoomRef.current = null;
    }
    prevFollowRecordingScrollRef.current = followRecordingScroll;
  }, [followRecordingScroll, pixelsPerSecond, trackZoom]);

  useEffect(() => {
    if (followRecordingScroll || isPlaying) {
      return;
    }
    const nextPps = clampTimelinePixelsPerSecond(pixelsPerSecondRef.current, zoomBounds);
    setPixelsPerSecond(nextPps);
    setTrackZoom((current) => clampTimelineTrackZoom(current, zoomBounds));
    if (nextPps !== pixelsPerSecondRef.current) {
      syncSubdivisionFromZoomRef.current(nextPps);
    }
  }, [zoomBounds, followRecordingScroll, isPlaying]);

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

    // Content width for the *upcoming* pps — do not clamp against stale maxScrollXRef.
    const nextLayoutDuration = Math.max(durationRef.current, layoutDurationRef.current);
    const nextTargetWidth =
      nextLayoutDuration > 0 ? nextLayoutDuration * nextPixelsPerSecond : 0;
    const nextBarCount =
      nextTargetWidth > 0
        ? Math.max(1, Math.floor(nextTargetWidth / BAR_STEP))
        : viewportWidth > 0
          ? Math.max(1, Math.floor(viewportWidth / BAR_STEP))
          : 0;
    const nextContentWidth =
      nextBarCount > 0 ? Math.max(viewportWidth, nextBarCount * BAR_STEP) : viewportWidth;
    const nextMaxScrollX = Math.max(0, nextContentWidth);
    const nextScrollX = Math.max(
      0,
      Math.min(nextMaxScrollX, padding + timeAtFocal * nextPixelsPerSecond - start.focalX)
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

    pendingZoomRef.current = {
      pixelsPerSecond: nextPixelsPerSecond,
      trackZoom: nextTrackZoom,
      scrollX: nextScrollX,
      scrollY: nextScrollY,
      maxScrollX: nextMaxScrollX,
    };
    scheduleZoomCommitRef.current();
  }, [tracks.length, viewportWidth, waveformAreaHeight]);

  const syncSubdivisionFromZoomRef = useRef((_pps: number) => {});
  syncSubdivisionFromZoomRef.current = (pps: number) => {
    if (zoomSyncFromSubdivisionRef.current) {
      return;
    }
    const settings = metronomeRef.current;
    if (!settings) {
      return;
    }
    const onSync = onMetronomeGridSubdivisionSyncRef.current;
    if (!onSync) {
      return;
    }

    const bounds = zoomBoundsRef.current;
    const picked = pickGridSubdivisionForPixelsPerSecond(
      settings,
      pps,
      bounds.pixelsPerSecondDefault,
      bounds.pixelsPerSecondMax
    );
    const currentSub =
      settings.gridBasis === 'time'
        ? settings.timeGridSubdivision
        : settings.metronomeGridSubdivision;
    const pickedSub =
      settings.gridBasis === 'time'
        ? picked.timeGridSubdivision
        : picked.metronomeGridSubdivision;
    if (currentSub === pickedSub) {
      return;
    }

    subdivisionSyncFromZoomRef.current = true;
    onSync(picked);
    queueMicrotask(() => {
      subdivisionSyncFromZoomRef.current = false;
    });
  };

  const commitPendingZoom = useCallback(() => {
    zoomCommitRafRef.current = null;
    const pending = pendingZoomRef.current;
    if (!pending) {
      return;
    }
    pendingZoomRef.current = null;

    const ppsUnchanged = pending.pixelsPerSecond === pixelsPerSecondRef.current;
    const trackZoomUnchanged = pending.trackZoom === trackZoomRef.current;
    if (ppsUnchanged && trackZoomUnchanged) {
      // Still apply scroll if focal math moved (bound clamp with no pps change).
      scrollOffsetRef.current = pending.scrollX;
      verticalScrollOffsetRef.current = pending.scrollY;
      maxScrollXRef.current = pending.maxScrollX;
      layoutPixelsPerSecondRef.current = pending.pixelsPerSecond;
      syncMetronomeGridRef.current(pending.scrollX, true);
      scrollRef.current?.scrollTo({ x: pending.scrollX, animated: false });
      verticalScrollRef.current?.scrollTo({ y: pending.scrollY, animated: false });
      return;
    }

    pixelsPerSecondRef.current = pending.pixelsPerSecond;
    trackZoomRef.current = pending.trackZoom;
    // Sync viewport with the gesture's new pps before React re-renders layout.
    layoutPixelsPerSecondRef.current = pending.pixelsPerSecond;
    maxScrollXRef.current = pending.maxScrollX;
    scrollOffsetRef.current = pending.scrollX;
    verticalScrollOffsetRef.current = pending.scrollY;

    setPixelsPerSecond(pending.pixelsPerSecond);
    setTrackZoom(pending.trackZoom);
    syncMetronomeGridRef.current(pending.scrollX, true);
    scrollRef.current?.scrollTo({ x: pending.scrollX, animated: false });
    verticalScrollRef.current?.scrollTo({ y: pending.scrollY, animated: false });
    syncSubdivisionFromZoomRef.current(pending.pixelsPerSecond);
  }, []);

  const scheduleZoomCommit = useCallback(() => {
    if (zoomCommitRafRef.current != null) {
      return;
    }
    zoomCommitRafRef.current = requestAnimationFrame(() => {
      commitPendingZoom();
    });
  }, [commitPendingZoom]);

  const flushZoomCommit = useCallback(() => {
    if (zoomCommitRafRef.current != null) {
      cancelAnimationFrame(zoomCommitRafRef.current);
      zoomCommitRafRef.current = null;
    }
    commitPendingZoom();
  }, [commitPendingZoom]);

  // Keep schedule ref current for applyZoomFromGesture (defined above commit helpers).
  scheduleZoomCommitRef.current = scheduleZoomCommit;

  const applyZoomMultipliersRef = useRef((_x: number, _y: number) => {});
  applyZoomMultipliersRef.current = (x: number, y: number) => {
    const bounds = zoomBoundsRef.current;
    const viewportWidth = viewportWidthRef.current;
    const defaultPps = bounds.pixelsPerSecondDefault;
    const nextPixelsPerSecond = pixelsPerSecondFromZoomMultiplier(x, defaultPps, bounds);
    const nextTrackZoom = clampTimelineTrackZoom(Math.round(y), bounds);

    if (
      nextPixelsPerSecond === pixelsPerSecondRef.current &&
      nextTrackZoom === trackZoomRef.current
    ) {
      return;
    }

    const playheadTime = scrollXToTime(
      scrollOffsetRef.current,
      durationRef.current,
      pixelsPerSecondRef.current
    );

    const wah = waveformAreaHeightRef.current;
    const trackCount = Math.max(1, tracksLengthRef.current);
    const nextLayoutDuration = Math.max(durationRef.current, layoutDurationRef.current);
    const nextTargetWidth =
      nextLayoutDuration > 0 ? nextLayoutDuration * nextPixelsPerSecond : 0;
    const nextBarCount =
      nextTargetWidth > 0
        ? Math.max(1, Math.floor(nextTargetWidth / BAR_STEP))
        : viewportWidth > 0
          ? Math.max(1, Math.floor(viewportWidth / BAR_STEP))
          : 0;
    const nextContentWidth =
      nextBarCount > 0 ? Math.max(viewportWidth, nextBarCount * BAR_STEP) : viewportWidth;
    const nextMaxScrollX = Math.max(0, nextContentWidth);
    const nextScrollX = timeToScrollX(playheadTime, nextContentWidth, nextPixelsPerSecond);

    const oldTrackHeight = (wah / trackCount) * trackZoomRef.current;
    const nextTrackHeight = (wah / trackCount) * nextTrackZoom;
    const focalYInTracks = wah / 2;
    const trackIndex =
      oldTrackHeight > 0
        ? (verticalScrollOffsetRef.current + focalYInTracks) / oldTrackHeight
        : 0;
    const nextTracksContentHeight = nextTrackHeight * trackCount;
    const nextMaxScrollY = Math.max(0, nextTracksContentHeight - wah);
    const nextScrollY = Math.max(
      0,
      Math.min(nextMaxScrollY, trackIndex * nextTrackHeight - focalYInTracks)
    );

    pendingZoomRef.current = {
      pixelsPerSecond: nextPixelsPerSecond,
      trackZoom: nextTrackZoom,
      scrollX: nextScrollX,
      scrollY: nextScrollY,
      maxScrollX: nextMaxScrollX,
    };
    scheduleZoomCommitRef.current();
  };

  const handleZoomDialogChangeX = useCallback((nextX: number) => {
    const bounds = zoomBoundsRef.current;
    const currentY = trackZoomRef.current;
    applyZoomMultipliersRef.current(nextX, currentY);
  }, []);

  const handleZoomDialogChangeY = useCallback((nextY: number) => {
    const bounds = zoomBoundsRef.current;
    const currentX = pixelsPerSecondRef.current / bounds.pixelsPerSecondDefault;
    applyZoomMultipliersRef.current(currentX, nextY);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomCommitRafRef.current != null) {
        cancelAnimationFrame(zoomCommitRafRef.current);
        zoomCommitRafRef.current = null;
      }
    };
  }, []);

  const clearZoomControlsHideTimeout = useCallback(() => {
    if (zoomControlsHideTimeoutRef.current != null) {
      clearTimeout(zoomControlsHideTimeoutRef.current);
      zoomControlsHideTimeoutRef.current = null;
    }
  }, []);

  const hideZoomControls = useCallback(() => {
    clearZoomControlsHideTimeout();
    setShowZoomControls(false);
  }, [clearZoomControlsHideTimeout]);

  const resetZoom = useCallback(() => {
    const bounds = zoomBoundsRef.current;
    setPixelsPerSecond(bounds.pixelsPerSecondDefault);
    setTrackZoom(1);
    verticalScrollOffsetRef.current = 0;
    verticalScrollRef.current?.scrollTo({ y: 0, animated: true });
    syncSubdivisionFromZoomRef.current(bounds.pixelsPerSecondDefault);
    hideZoomControls();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [hideZoomControls]);

  const handleZoomDialogReset = useCallback(() => {
    resetZoom();
  }, [resetZoom]);

  useEffect(() => {
    onMetronomeGridProcessingChangeRef.current?.(
      metronomeGridProcessing && !zoomDialogVisible
    );
  }, [metronomeGridProcessing, zoomDialogVisible]);

  const onZoomControlsChangeRef = useRef(onZoomControlsChange);
  onZoomControlsChangeRef.current = onZoomControlsChange;

  useEffect(() => {
    const multipliers = getTimelineZoomDisplayMultipliers(
      pixelsPerSecond,
      trackZoom,
      zoomBounds.pixelsPerSecondDefault
    );
    onZoomControlsChangeRef.current?.({
      visible: showZoomControls,
      x: multipliers.x,
      y: multipliers.y,
    });
  }, [showZoomControls, pixelsPerSecond, trackZoom, zoomBounds.pixelsPerSecondDefault]);

  useEffect(() => {
    return () => {
      onZoomControlsChangeRef.current?.({ visible: false, x: 1, y: 1 });
    };
  }, []);

  useEffect(() => {
    if (zoomGestureActive) {
      clearZoomControlsHideTimeout();
      setShowZoomControls(true);
      return;
    }
    if (!showZoomControls) {
      return;
    }
    clearZoomControlsHideTimeout();
    zoomControlsHideTimeoutRef.current = setTimeout(() => {
      zoomControlsHideTimeoutRef.current = null;
      setShowZoomControls(false);
    }, ZOOM_CONTROLS_LINGER_MS);
    return () => {
      clearZoomControlsHideTimeout();
    };
  }, [zoomGestureActive, showZoomControls, clearZoomControlsHideTimeout]);

  useEffect(() => {
    return () => {
      clearZoomControlsHideTimeout();
    };
  }, [clearZoomControlsHideTimeout]);

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
    const loopOffset = loopOverlayRef.current ? loopRowHeightRef.current : 0;
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
    flushZoomCommit();
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

  const timelineZoomResponder = useRef(
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

  const finishPlaybackScrubIfNeeded = () => {
    if (!resumeAfterScrubRef.current) {
      return;
    }
    resumeAfterScrubRef.current = false;
    onPlaybackScrubEndRef.current?.();
  };

  const handleScrollBeginDrag = () => {
    if (trimGestureActiveRef.current) {
      return;
    }
    isUserScrollingRef.current = true;
    if (isPlayingRef.current) {
      resumeAfterScrubRef.current = true;
      onPlaybackScrubStartRef.current?.();
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    scrollOffsetRef.current = x;
    // RAF already syncs viewport buffers while auto-following; skip duplicate setState.
    if (!autoScrollingRef.current) {
      syncMetronomeGridRef.current(x);
    }
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
        onEditGestureActiveRef.current?.(active);
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

  const handleLoopExpandedChange = useCallback((nextExpanded: boolean) => {
    setLoopRowExpanded(nextExpanded);
    loopExpandExtraSV.value = withTiming(
      nextExpanded ? LOOP_ROW_HEIGHT_EXPANDED - LOOP_ROW_HEIGHT : 0,
      {
        duration: LOOP_EXPAND_DURATION_MS,
        easing: LOOP_EXPAND_EASING,
      }
    );
  }, [loopExpandExtraSV]);

  const handleLoopPreviewChange = useCallback((preview: LoopPreviewState | null) => {
    setLoopPreview(preview);
  }, []);

  const loopBarConfig = useMemo((): LoopOverlayConfig | undefined => {
    if (!loopOverlay) {
      return undefined;
    }
    return {
      ...loopOverlay,
      onPreviewChange: handleLoopPreviewChange,
      onExpandedChange: handleLoopExpandedChange,
    };
  }, [handleLoopExpandedChange, handleLoopPreviewChange, loopOverlay]);

  useEffect(() => {
    if (!loopOverlay) {
      setLoopRowExpanded(false);
      setLoopPreview(null);
      loopExpandExtraSV.value = 0;
    }
  }, [loopExpandExtraSV, loopOverlay]);

  const animatedTracksViewportStyle = useAnimatedStyle(() => ({
    height: Math.max(1, waveformAreaHeightSV.value - loopExpandExtraSV.value),
    overflow: 'hidden',
  }));

  const overlayLoopStart = loopPreview?.start ?? loopOverlay?.loopStart ?? 0;
  const overlayLoopEnd = loopPreview?.end ?? loopOverlay?.loopEnd ?? 0;
  const overlayLoopEnabled = loopPreview?.enabled ?? loopOverlay?.loopEnabled ?? false;

  const handleScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const velocity = event.nativeEvent.velocity?.x ?? 0;
    if (Math.abs(velocity) < 0.1) {
      isUserScrollingRef.current = false;
      finishPlaybackScrubIfNeeded();
    }
  };

  const handleMomentumScrollEnd = () => {
    isUserScrollingRef.current = false;
    finishPlaybackScrubIfNeeded();
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
    let bufferSyncRaf = 0;
    let pendingBufferScrollX = 0;
    let appState: string = AppState.currentState;

    const syncScrollToPlaybackTime = () => {
      const time = getPlaybackTimeRef.current?.() ?? currentTimeRef.current;
      const x = timeToScrollX(time, contentWidth, layoutPixelsPerSecond);
      scrollOffsetRef.current = x;
      scrollRef.current?.scrollTo({
        x,
        animated: false,
      });
      syncMetronomeGridRef.current(x);
    };

    const tick = () => {
      // App Switcher / background: stop scroll RAF; native audio keeps playing.
      if (appState !== 'active') {
        raf = 0;
        return;
      }
      // User scrub can start before isPlaying flips false; don't fight the drag.
      if (isUserScrollingRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const time = getPlaybackTimeRef.current?.() ?? currentTimeRef.current;
      const x = timeToScrollX(time, contentWidth, layoutPixelsPerSecond);
      scrollOffsetRef.current = x;
      // Scroll first; coalesce React viewport/grid updates onto the next frame so
      // bar remounts never land in the same frame as scrollTo (reads as shake).
      scrollRef.current?.scrollTo({
        x,
        animated: false,
      });
      pendingBufferScrollX = x;
      if (bufferSyncRaf === 0) {
        bufferSyncRaf = requestAnimationFrame(() => {
          bufferSyncRaf = 0;
          syncMetronomeGridRef.current(pendingBufferScrollX);
        });
      }
      raf = requestAnimationFrame(tick);
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      if (nextState === 'active') {
        syncScrollToPlaybackTime();
        if (raf === 0) {
          raf = requestAnimationFrame(tick);
        }
      } else if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
        if (bufferSyncRaf !== 0) {
          cancelAnimationFrame(bufferSyncRaf);
          bufferSyncRaf = 0;
        }
      }
    });

    if (appState === 'active') {
      raf = requestAnimationFrame(tick);
    } else {
      syncScrollToPlaybackTime();
    }

    return () => {
      subscription.remove();
      cancelAnimationFrame(raf);
      if (bufferSyncRaf !== 0) {
        cancelAnimationFrame(bufferSyncRaf);
      }
    };
  }, [isPlaying, followRecordingScroll, duration, contentWidth, viewportWidth, layoutPixelsPerSecond]);

  useEffect(() => {
    if (!followRecordingScroll || viewportWidth <= 0) {
      return;
    }

    let raf = 0;
    let bufferSyncRaf = 0;
    let pendingBufferScrollX = 0;
    let appState: string = AppState.currentState;

    const syncRecordingScroll = () => {
      const time = getRecordingTimeRef.current?.() ?? currentTimeRef.current;
      const x = recordingTimeToScrollX(
        time,
        contentWidthRef.current,
        layoutPixelsPerSecond
      );
      scrollOffsetRef.current = x;
      scrollRef.current?.scrollTo({ x, animated: false });
      syncMetronomeGridRef.current(x);
    };

    const tick = () => {
      // App Switcher / background: stop scroll RAF; capture keeps running.
      if (appState !== 'active') {
        raf = 0;
        return;
      }
      // Keep scheduling while scrubbing — an early return would kill the loop.
      if (isUserScrollingRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const time = getRecordingTimeRef.current?.() ?? currentTimeRef.current;
      const nextLayoutDuration = getLayoutDuration(
        Math.max(durationRef.current, time),
        time,
        viewportWidthRef.current,
        true,
        layoutPixelsPerSecond
      );
      if (nextLayoutDuration !== followLayoutDurationRef.current) {
        followLayoutDurationRef.current = nextLayoutDuration;
        setFollowLayoutDuration(nextLayoutDuration);
      }
      const x = recordingTimeToScrollX(
        time,
        contentWidthRef.current,
        layoutPixelsPerSecond
      );
      scrollOffsetRef.current = x;
      // Scroll first; coalesce React viewport/grid updates onto the next frame so
      // bar remounts never land in the same frame as scrollTo (reads as shake).
      scrollRef.current?.scrollTo({
        x,
        animated: false,
      });
      pendingBufferScrollX = x;
      if (bufferSyncRaf === 0) {
        bufferSyncRaf = requestAnimationFrame(() => {
          bufferSyncRaf = 0;
          syncMetronomeGridRef.current(pendingBufferScrollX);
        });
      }
      raf = requestAnimationFrame(tick);
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      if (nextState === 'active') {
        syncRecordingScroll();
        if (raf === 0) {
          raf = requestAnimationFrame(tick);
        }
      } else if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
        if (bufferSyncRaf !== 0) {
          cancelAnimationFrame(bufferSyncRaf);
          bufferSyncRaf = 0;
        }
      }
    });

    if (appState === 'active') {
      raf = requestAnimationFrame(tick);
    } else {
      syncRecordingScroll();
    }

    return () => {
      subscription.remove();
      cancelAnimationFrame(raf);
      if (bufferSyncRaf !== 0) {
        cancelAnimationFrame(bufferSyncRaf);
      }
    };
  }, [followRecordingScroll, contentWidth, viewportWidth, layoutPixelsPerSecond]);

  useEffect(() => {
    if (followRecordingScroll) {
      return;
    }
    followLayoutDurationRef.current = 0;
    setFollowLayoutDuration(0);
  }, [followRecordingScroll]);

  // During capture or playback follow, paint the visible viewport plus a small
  // overscan so virtualization edges stay off-screen between React refreshes.
  // Idle/scrub keep the larger buffered overscan.
  const barPaintTimeRange =
    (isRecording || isPlaying) && viewportWidth > 0 && layoutPixelsPerSecond > 0
      ? getFollowBarPaintTimeRange(
          Math.max(
            0,
            isRecording
              ? (getRecordingTimeRef.current?.() ?? currentTime) *
                  layoutPixelsPerSecond
              : scrollOffsetRef.current
          ),
          viewportWidth,
          layoutPixelsPerSecond
        )
      : resolvePlaybackBarPaintRange(
          viewportTimeBuffer,
          scrollX,
          viewportWidth,
          layoutPixelsPerSecond,
          Math.max(duration, layoutDuration)
        );

  const zoomMultipliers = getTimelineZoomDisplayMultipliers(
    layoutPixelsPerSecond,
    layoutTrackZoom,
    zoomBounds.pixelsPerSecondDefault
  );
  const zoomMultiplierBounds = getTimelineZoomMultiplierBounds(zoomBounds);
  const showZoomButton =
    zoomEnabled && !isTimelineZoomAtDefault(zoomMultipliers.x, zoomMultipliers.y);
  const loopBarTopOffset = loopOverlay
    ? loopRowExpanded
      ? LOOP_ROW_HEIGHT_EXPANDED
      : LOOP_ROW_HEIGHT
    : 0;

  return (
    <WaveformThemeContext.Provider value={theme}>
    <View
      ref={containerRef}
      {...timelineZoomResponder.panHandlers}
      onLayout={handleLayout}
      style={styles.container}>
      <GHScrollView
        ref={scrollRef}
        horizontal
        bounces={false}
        nestedScrollEnabled
        waitFor={loopBarConfig ? loopBarGestureRef : undefined}
        scrollEnabled={
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
          {loopBarConfig && loopScrollHelpers ? (
            <LoopRegionBar
              bandWidth={bandWidth}
              config={loopBarConfig}
              disabled={isRecording}
              editDisabled={isPlaying}
              gridLines={metronomeGridLines}
              nativeGestureRef={loopBarGestureRef}
              pixelsPerSecond={layoutPixelsPerSecond}
              scrollHelpers={loopScrollHelpers}
              sidePadding={sidePadding}
            />
          ) : null}
          <Animated.View style={animatedTracksViewportStyle}>
            <GHScrollView
              ref={verticalScrollRef}
              bounces={false}
              nestedScrollEnabled
              scrollEnabled={verticalScrollEnabled && !trimGestureActive && !zoomGestureActive}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
              onScroll={handleVerticalScroll}>
              <View style={{ height: tracksContentHeight, position: 'relative' }}>
                {tracks.map((track, index) => {
                  const animateTrackTransition =
                    trackTransitionsReady &&
                    !isRecording &&
                    !recordingLayoutActive &&
                    track.id !== '__recording__' &&
                    track.id !== 'empty';
                  return (
                    <Animated.View
                      key={track.id}
                      entering={animateTrackTransition ? TRACK_ROW_ENTER : undefined}
                      exiting={animateTrackTransition ? TRACK_ROW_EXIT : undefined}
                      needsOffscreenAlphaCompositing={
                        !isRecording && !recordingLayoutActive && !isPlaying
                      }
                      style={{ width: bandWidth, height: trackHeight }}>
                      <TrackWaveformRow
                        bandWidth={bandWidth}
                        contentWidth={contentWidth}
                        layoutDuration={layoutDuration}
                        pixelsPerSecond={layoutPixelsPerSecond}
                        showBottomDivider={index < tracks.length - 1}
                        sidePadding={sidePadding}
                        track={track}
                        trackHeight={trackHeight}
                        visibleTimeEnd={barPaintTimeRange.end}
                        visibleTimeStart={barPaintTimeRange.start}
                        fadeOverlay={fadeOverlay}
                        moveOverlay={moveOverlay}
                        trackLoopOverlay={trackLoopOverlay}
                        trimOverlay={trimOverlay}
                        trimScrollHelpers={trimScrollHelpers}
                        onLongPress={
                          onTrackLongPressRef.current &&
                          track.id !== '__recording__' &&
                          track.id !== 'empty'
                            ? () => onTrackLongPressRef.current?.(track.id)
                            : undefined
                        }
                        onPress={(locationX) => handleTrackPress(track.id, locationX)}
                      />
                    </Animated.View>
                  );
                })}
                <MetronomeTrackGrid
                  height={tracksContentHeight}
                  lines={metronomeGridLines}
                  pixelsPerSecond={layoutPixelsPerSecond}
                  sidePadding={sidePadding}
                />
              </View>
            </GHScrollView>
            {loopOverlay ? (
              <LoopColumnOverlay
                loopEnabled={overlayLoopEnabled}
                loopEnd={overlayLoopEnd}
                loopStart={overlayLoopStart}
                pixelsPerSecond={layoutPixelsPerSecond}
                sidePadding={sidePadding}
              />
            ) : null}
          </Animated.View>
          <View
            pointerEvents="none"
            style={[styles.markerBand, { width: bandWidth }]}>
            {timelineMarkers.tickTimes.map((time) => {
              const x = Math.round(sidePadding + time * layoutPixelsPerSecond);
              const showLabel = timelineMarkers.labelTimes.has(time);
              return (
                <View key={time} style={[styles.marker, { left: x }]}>
                  <View style={styles.markerTick} />
                  {showLabel ? (
                    <View style={styles.markerLabelWrap}>
                      <Text style={styles.markerLabel}>{formatMarkerTime(time)}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </GHScrollView>
      {showZoomButton ? (
        <View
          pointerEvents="box-none"
          style={[styles.zoomButtonOverlay, { top: loopBarTopOffset + 8 }]}>
          <FloatingHeaderButton
            accessibilityLabel="Timeline zoom"
            icon="magnifyingglass"
            size="small"
            tintColor={colors.secondaryText}
            onPress={() => setZoomDialogVisible(true)}
          />
        </View>
      ) : null}
      <TimelineZoomDialog
        visible={zoomDialogVisible}
        x={zoomMultipliers.x}
        xMax={zoomMultiplierBounds.xMax}
        xMin={zoomMultiplierBounds.xMin}
        y={zoomMultipliers.y}
        yMax={zoomMultiplierBounds.yMax}
        yMin={zoomMultiplierBounds.yMin}
        processing={metronomeGridProcessing}
        onChangeX={handleZoomDialogChangeX}
        onChangeY={handleZoomDialogChangeY}
        onClose={() => setZoomDialogVisible(false)}
        onReset={handleZoomDialogReset}
      />
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
  const followTimeFromRefs = playing || next.recordingLayoutActive;
  if (!followTimeFromRefs && prev.currentTime !== next.currentTime) {
    return false;
  }
  // During live recording layout, duration is driven by RAF/refs + LiveRecordingWaveform.
  if (!next.recordingLayoutActive && prev.duration !== next.duration) {
    return false;
  }

  if (
    prev.isRecording !== next.isRecording ||
    prev.recordingLayoutActive !== next.recordingLayoutActive ||
    prev.isPlaying !== next.isPlaying ||
    prev.getPlaybackTime !== next.getPlaybackTime ||
    prev.getRecordingTime !== next.getRecordingTime ||
    prev.onSeek !== next.onSeek ||
    prev.onPlaybackScrubStart !== next.onPlaybackScrubStart ||
    prev.onPlaybackScrubEnd !== next.onPlaybackScrubEnd ||
    prev.onTrackPress !== next.onTrackPress ||
    prev.onTrackDeselect !== next.onTrackDeselect ||
    prev.onTrackLongPress !== next.onTrackLongPress ||
    prev.onWidthChange !== next.onWidthChange ||
    prev.onEditGestureActive !== next.onEditGestureActive ||
    prev.onZoomControlsChange !== next.onZoomControlsChange ||
    prev.onMetronomeGridSubdivisionSync !== next.onMetronomeGridSubdivisionSync ||
    prev.onMetronomeGridProcessingChange !== next.onMetronomeGridProcessingChange
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
      prevMetronome.showGrid !== nextMetronome.showGrid ||
      prevMetronome.gridBasis !== nextMetronome.gridBasis ||
      prevMetronome.metronomeGridSubdivision !== nextMetronome.metronomeGridSubdivision ||
      prevMetronome.timeGridSubdivision !== nextMetronome.timeGridSubdivision
    ) {
      return false;
    }
  }

  if (
    !areOverlayConfigsEqual(prev.trimOverlay, next.trimOverlay, [
      'layerId',
      'layerStartTime',
      'layerDuration',
      'trimIn',
      'trimOut',
      'onChange',
      'snapIntervalSec',
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
      'snapIntervalSec',
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
      prevLoop.onChange !== nextLoop.onChange ||
      prevLoop.onOpenSettings !== nextLoop.onOpenSettings ||
      prevLoop.holdExpanded !== nextLoop.holdExpanded ||
      prevLoop.snapIntervalSec !== nextLoop.snapIntervalSec
    ) {
      return false;
    }
  }

  const prevFade = prev.fadeOverlay;
  const nextFade = next.fadeOverlay;
  if (prevFade !== nextFade) {
    if (!prevFade || !nextFade) {
      return false;
    }
    if (
      prevFade.layerId !== nextFade.layerId ||
      prevFade.editable !== nextFade.editable ||
      prevFade.snapIntervalSec !== nextFade.snapIntervalSec ||
      prevFade.onChange !== nextFade.onChange
    ) {
      return false;
    }
  }

  const prevTrackLoop = prev.trackLoopOverlay;
  const nextTrackLoop = next.trackLoopOverlay;
  if (prevTrackLoop !== nextTrackLoop) {
    if (!prevTrackLoop || !nextTrackLoop) {
      return false;
    }
    if (
      prevTrackLoop.onHeaderLongPress !== nextTrackLoop.onHeaderLongPress ||
      prevTrackLoop.editable !== nextTrackLoop.editable
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
  zoomButtonOverlay: {
    position: 'absolute',
    left: 8,
    zIndex: 10,
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
  trackContentBackground: {
    position: 'absolute',
    top: 0,
  },
  regionHeader: {
    position: 'absolute',
    top: 0,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    overflow: 'hidden',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  regionHeaderCycleFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 0,
  },
  regionHeaderCycleIcon: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 1,
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionHeaderLabel: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
    zIndex: 2,
  },
  floatingTrackLabel: {
    position: 'absolute',
    top: 4,
    fontSize: 11,
    color: colors.secondaryText,
    zIndex: 5,
  },
  floatingStatusRow: {
    position: 'absolute',
    top: 3,
    zIndex: 6,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  floatingStatusLabel: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.secondaryText,
  },
  floatingBadge: {
    position: 'absolute',
    top: 4,
  },
  floatingLock: {
    position: 'absolute',
    top: 3,
    zIndex: 6,
    width: 14,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionHeaderBadge: {
    marginLeft: 4,
    position: 'relative',
    top: 0,
  },
  regionHeaderLock: {
    marginLeft: 4,
    zIndex: 6,
    width: 14,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionHeaderLoop: {
    width: 'auto',
    minWidth: 14,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 1,
  },
  floatingLoop: {
    width: 'auto',
    minWidth: 14,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 1,
  },
  loopCountText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  regionBodyFill: {
    position: 'absolute',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  mutedBadge: {
    zIndex: 6,
    minWidth: 14,
    height: 13,
    borderRadius: 2,
    paddingHorizontal: 3,
    backgroundColor: colors.secondaryText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.background,
    lineHeight: 11,
  },
  soloBadge: {
    zIndex: 6,
    minWidth: 14,
    height: 13,
    borderRadius: 2,
    paddingHorizontal: 3,
    backgroundColor: colors.soloBadge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soloBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.soloBadgeText,
    lineHeight: 11,
  },
  dimRegion: {
    position: 'absolute',
    backgroundColor: colors.waveformDimBackground,
  },
  replaceTailDim: {
    position: 'absolute',
    backgroundColor: colorWithAlpha(colors.waveformDimBackground, 0.85),
  },
  barsOverlay: {
    ...StyleSheet.absoluteFill,
  },
  centerLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: colors.waveformCenterLine,
  },
  barsRow: {
    height: '100%',
  },
  loopSeam: {
    position: 'absolute',
    top: 0,
    width: StyleSheet.hairlineWidth,
  },
  bar: {
    position: 'absolute',
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
  },
  markerTick: {
    width: MARKER_TICK_WIDTH,
    height: 6,
    backgroundColor: colors.secondaryText,
    opacity: 0.35,
  },
  markerLabelWrap: {
    position: 'absolute',
    top: 8,
    left: MARKER_TICK_WIDTH / 2,
    width: MARKER_LABEL_WIDTH,
    marginLeft: -MARKER_LABEL_WIDTH / 2,
    alignItems: 'center',
  },
  markerLabel: {
    fontSize: 10,
    textAlign: 'center',
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
    borderColor: TRIM_HANDLE_COLOR,
    backgroundColor: 'rgba(255, 204, 0, 0.08)',
    zIndex: 10,
  },
  trimSideHandle: {
    position: 'absolute',
    top: 0,
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
