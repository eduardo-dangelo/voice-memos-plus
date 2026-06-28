import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

import { colorWithAlpha, type VoiceMemosColorScheme } from '@/constants/VoiceMemosColors';
import { LoopRegionBar, LOOP_ROW_HEIGHT, type LoopOverlayConfig } from '@/src/components/LoopRegionBar';
import { clampTrimValues, dbToLinear } from '@/src/audio/layerEffects';
import {
  getPeaksForMemo,
  peakToAbsoluteScale,
  resamplePeaks,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_PIXELS_PER_SECOND,
} from '@/src/audio/waveform';
import { formatMarkerTime } from '@/src/utils/format';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const BAR_WIDTH = WAVEFORM_BAR_WIDTH;
const BAR_GAP = WAVEFORM_BAR_GAP;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const PIXELS_PER_SECOND = WAVEFORM_PIXELS_PER_SECOND;
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
  isRecording: boolean
): number {
  if (!isRecording) {
    return duration;
  }
  const viewportSeconds = viewportWidth > 0 ? viewportWidth / PIXELS_PER_SECOND : 0;
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
  label?: string;
  showLabel?: boolean;
  color?: string;
};

type Props = {
  tracks: TrackData[];
  currentTime: number;
  duration: number;
  isRecording?: boolean;
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
  volumeVisualDb?: number;
};

function getMarkerInterval(): number {
  if (PIXELS_PER_SECOND >= MIN_LABEL_SPACING) {
    return 1;
  }
  if (PIXELS_PER_SECOND * 5 >= MIN_LABEL_SPACING) {
    return 5;
  }
  if (PIXELS_PER_SECOND * 10 >= MIN_LABEL_SPACING) {
    return 10;
  }
  return 30;
}

function getTrackBarCount(trackDuration: number, contentWidth: number): number {
  if (trackDuration <= 0) {
    return 0;
  }
  const targetWidth = trackDuration * PIXELS_PER_SECOND;
  return Math.max(1, Math.floor(Math.min(contentWidth, targetWidth) / BAR_STEP));
}

function timeToScrollX(time: number, contentWidth: number): number {
  return Math.max(0, Math.min(contentWidth, time * PIXELS_PER_SECOND));
}

function scrollXToTime(x: number, duration: number): number {
  return Math.max(0, Math.min(duration, x / PIXELS_PER_SECOND));
}

function isTrackEmptyPress(
  locationX: number,
  sidePadding: number,
  contentWidth: number,
  track: TrackData
): boolean {
  const contentStart = sidePadding;
  const contentEnd = sidePadding + contentWidth;
  const barStart = sidePadding + track.startTime * PIXELS_PER_SECOND;
  const barEnd = sidePadding + (track.startTime + track.duration) * PIXELS_PER_SECOND;

  return (
    locationX < contentStart ||
    locationX > contentEnd ||
    locationX < barStart ||
    locationX > barEnd
  );
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
  onChange,
  trimScrollHelpers,
}: {
  track: TrackData;
  sidePadding: number;
  trackHeight: number;
  trimIn: number;
  trimOut: number;
  onChange: (trimIn: number, trimOut: number) => void;
  trimScrollHelpers: TrimScrollHelpers;
}) {
  const { styles } = useWaveformTheme();
  const trackOffset = sidePadding + track.startTime * PIXELS_PER_SECOND;
  const trimLeft = trackOffset + trimIn * PIXELS_PER_SECOND;
  const trimRight = trackOffset + trimOut * PIXELS_PER_SECOND;
  const trackEnd = trackOffset + track.duration * PIXELS_PER_SECOND;
  const startTrimIn = useRef(trimIn);
  const startTrimOut = useRef(trimOut);
  const scrollXAtGrant = useRef(0);
  const onChangeRef = useRef(onChange);
  const trimScrollHelpersRef = useRef(trimScrollHelpers);
  const trackRef = useRef(track);
  const sidePaddingRef = useRef(sidePadding);
  onChangeRef.current = onChange;
  trimScrollHelpersRef.current = trimScrollHelpers;
  trackRef.current = track;
  sidePaddingRef.current = sidePadding;

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
    const offset = sidePaddingRef.current + trackData.startTime * PIXELS_PER_SECOND;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      offset + (startTrimIn.current + preliminaryDx / PIXELS_PER_SECOND) * PIXELS_PER_SECOND
    );
    const effectiveDx = getEffectiveDx(gesture);
    const next = clampTrimValues(
      startTrimIn.current + effectiveDx / PIXELS_PER_SECOND,
      startTrimOut.current,
      trackData.duration
    );
    onChangeRef.current(next.trimIn, next.trimOut);
  };

  const rightMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  rightMoveRef.current = (_event, gesture) => {
    const trackData = trackRef.current;
    const offset = sidePaddingRef.current + trackData.startTime * PIXELS_PER_SECOND;
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      offset + (startTrimOut.current + preliminaryDx / PIXELS_PER_SECOND) * PIXELS_PER_SECOND
    );
    const effectiveDx = getEffectiveDx(gesture);
    const next = clampTrimValues(
      startTrimIn.current,
      startTrimOut.current + effectiveDx / PIXELS_PER_SECOND,
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
  onChange,
  trimScrollHelpers,
}: {
  track: TrackData;
  sidePadding: number;
  trackHeight: number;
  trackColor: string;
  layerStartTime: number;
  trimIn: number;
  onChange: (startTime: number) => void;
  trimScrollHelpers: TrimScrollHelpers;
}) {
  const { styles } = useWaveformTheme();
  const segmentLeft = sidePadding + track.startTime * PIXELS_PER_SECOND;
  const segmentWidth = track.duration * PIXELS_PER_SECOND;
  const startLayerStartTime = useRef(layerStartTime);
  const scrollXAtGrant = useRef(0);
  const onChangeRef = useRef(onChange);
  const trimScrollHelpersRef = useRef(trimScrollHelpers);
  const sidePaddingRef = useRef(sidePadding);
  const trimInRef = useRef(trimIn);
  onChangeRef.current = onChange;
  trimScrollHelpersRef.current = trimScrollHelpers;
  sidePaddingRef.current = sidePadding;
  trimInRef.current = trimIn;

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
    const preliminaryDx = getEffectiveDx(gesture);
    applyEdgeAutoScroll(
      segmentLeft + preliminaryDx
    );
    const effectiveDx = getEffectiveDx(gesture);
    const nextStartTime = Math.max(
      -trimInRef.current,
      startLayerStartTime.current + effectiveDx / PIXELS_PER_SECOND
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
  if (track.isMuted) {
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

function TrackWaveformRow({
  track,
  bandWidth,
  contentWidth,
  sidePadding,
  trackHeight,
  onPress,
  onLongPress,
  trimOverlay,
  moveOverlay,
  volumeVisualDb,
  trimScrollHelpers,
  scrollPriority = false,
}: {
  track: TrackData;
  bandWidth: number;
  contentWidth: number;
  sidePadding: number;
  trackHeight: number;
  onPress: (locationX: number) => void;
  onLongPress?: () => void;
  trimOverlay?: TrimOverlayConfig;
  moveOverlay?: MoveOverlayConfig;
  volumeVisualDb?: number;
  trimScrollHelpers?: TrimScrollHelpers;
  scrollPriority?: boolean;
}) {
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

  const barCount = getTrackBarCount(track.duration, contentWidth);
  const trackOffset = track.startTime * PIXELS_PER_SECOND;
  const trackWidth = barCount * BAR_STEP;

  const normalizedPeaks = useMemo(() => {
    const source =
      track.peaks && track.peaks.length > 0
        ? track.peaks.slice(0, barCount)
        : getPeaksForMemo(track.peaks, barCount);
    return barCount > 0 ? resamplePeaks(source, barCount) : [];
  }, [barCount, track.peaks]);

  const volumeScale =
    track.isActive && volumeVisualDb !== undefined
      ? dbToLinear(volumeVisualDb)
      : 1;
  const showTrimOverlay = trimOverlay?.layerId === track.id;
  const showMoveOverlay = moveOverlay?.layerId === track.id;
  const barColor = getTrackBarColor(track, colors);
  const bandBackground = getTrackBandBackground(track, colors);
  const trackColor = track.color ?? colors.accent;

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
      {trackWidth > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.barsRow,
            {
              marginLeft: sidePadding + trackOffset,
              width: trackWidth,
            },
          ]}>
          {normalizedPeaks.map((peak, index) => {
            const scaled = peakToAbsoluteScale(peak) * volumeScale;
            const barHeight =
              scaled <= 0.01
                ? 2
                : Math.max(4, Math.min(trackHeight - 16, scaled * (trackHeight - 16)));
            return (
              <View
                key={index}
                style={[
                  styles.bar,
                  {
                    height: barHeight,
                    backgroundColor: barColor,
                  },
                ]}
              />
            );
          })}
        </View>
      ) : null}
      {showTrimOverlay && trimOverlay && trimScrollHelpers ? (
        <TrackTrimOverlay
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
          sidePadding={sidePadding}
          track={track}
          trackColor={trackColor}
          trackHeight={trackHeight}
          trimIn={moveOverlay.trimIn}
          trimScrollHelpers={trimScrollHelpers}
          onChange={moveOverlay.onChange}
        />
      ) : null}
    </View>
  );

  if (scrollPriority) {
    return (
      <View
        style={[styles.trackRow, { height: trackHeight }]}
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
      </View>
    );
  }

  return (
    <Pressable
      delayLongPress={LONG_PRESS_DELAY_MS}
      onLongPress={onLongPress}
      onPress={(event) => onPress(event.nativeEvent.locationX)}
      style={[styles.trackRow, { height: trackHeight }]}>
      {rowContent}
    </Pressable>
  );
}

export function WaveformView({
  tracks,
  currentTime,
  duration,
  isRecording = false,
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
  volumeVisualDb,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useMemo(() => createWaveformStyles(colors), [colors]);
  const theme = useMemo(() => ({ colors, styles }), [colors, styles]);
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrollingRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const trimGestureActiveRef = useRef(false);
  const [trimGestureActive, setTrimGestureActive] = useState(false);
  const maxScrollXRef = useRef(0);
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

  const layoutDuration = getLayoutDuration(
    duration,
    currentTime,
    viewportWidth,
    isRecording
  );
  const targetWidth = layoutDuration > 0 ? layoutDuration * PIXELS_PER_SECOND : 0;
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
  const trackHeight = waveformAreaHeight / Math.max(1, tracks.length);

  const scrollX = timeToScrollX(currentTime, contentWidth);

  const markerInterval = getMarkerInterval();
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

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewportWidth(width);
    setViewportHeight(height);
    onWidthChange?.(width);
  };

  const handleTrackPress = (trackId: string, locationX: number) => {
    const track = tracks.find((entry) => entry.id === trackId);
    if (track && isTrackEmptyPress(locationX, sidePadding, contentWidth, track)) {
      onTrackDeselectRef.current?.();
    } else {
      onTrackPressRef.current(trackId);
    }
    if (isPlaying || duration <= 0 || contentWidth <= 0) {
      return;
    }
    const waveformX = locationX - sidePadding;
    onSeek(scrollXToTime(waveformX, duration));
  };

  const handleScrollBeginDrag = () => {
    if (trimGestureActiveRef.current) {
      return;
    }
    isUserScrollingRef.current = true;
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    scrollOffsetRef.current = x;
    if (trimGestureActiveRef.current) {
      return;
    }
    if (!isUserScrollingRef.current || duration <= 0 || contentWidth <= 0) {
      return;
    }
    onSeekRef.current(scrollXToTime(x, duration));
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
      isRecording ||
      gestureOverlay ||
      isUserScrollingRef.current
    ) {
      return;
    }
    scrollRef.current?.scrollTo({ x: scrollX, animated: true });
  }, [scrollX, viewportWidth, isRecording, isPlaying, gestureOverlay]);

  useEffect(() => {
    if (!isPlaying || duration <= 0 || viewportWidth <= 0 || contentWidth <= 0) {
      return;
    }

    let raf = 0;
    const tick = () => {
      const time = getPlaybackTimeRef.current?.() ?? currentTimeRef.current;
      scrollRef.current?.scrollTo({ x: timeToScrollX(time, contentWidth), animated: false });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, duration, contentWidth, viewportWidth]);

  useEffect(() => {
    if (!isRecording || viewportWidth <= 0) {
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
      scrollRef.current?.scrollTo({ x: timeToScrollX(time, width), animated: false });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRecording, viewportWidth]);

  return (
    <WaveformThemeContext.Provider value={theme}>
    <View onLayout={handleLayout} style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        bounces={false}
        nestedScrollEnabled
        scrollEnabled={!isPlaying && !isRecording && !trimGestureActive}
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
              disabled={isPlaying || isRecording}
              scrollHelpers={loopScrollHelpers}
              sidePadding={sidePadding}
            />
          ) : null}
          {tracks.map((track) => (
            <TrackWaveformRow
              key={track.id}
              bandWidth={bandWidth}
              contentWidth={contentWidth}
              sidePadding={sidePadding}
              track={track}
              trackHeight={trackHeight}
              scrollPriority={Boolean(
                isPlaying ||
                isRecording ||
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
          <View
            pointerEvents="none"
            style={[styles.markerBand, { width: bandWidth }]}>
            {markerSeconds.map((second) => {
              const x = sidePadding + second * PIXELS_PER_SECOND;
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
  dimRegion: {
    position: 'absolute',
    backgroundColor: colors.waveformDimBackground,
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
