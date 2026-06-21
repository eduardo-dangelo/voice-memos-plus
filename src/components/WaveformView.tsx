import { useEffect, useMemo, useRef, useState } from 'react';
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

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { clampTrimValues, dbToLinear, shiftTrimWindow } from '@/src/audio/layerEffects';
import {
  getPeaksForMemo,
  peakToAbsoluteScale,
  resamplePeaks,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_PIXELS_PER_SECOND,
} from '@/src/audio/waveform';
import { formatMarkerTime } from '@/src/utils/format';

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
  onWidthChange?: (width: number) => void;
  trimOverlay?: TrimOverlayConfig;
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

  const bodyMoveRef = useRef((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {});
  bodyMoveRef.current = (_event, gesture) => {
    const trackData = trackRef.current;
    const offset = sidePaddingRef.current + trackData.startTime * PIXELS_PER_SECOND;
    const preliminaryDx = getEffectiveDx(gesture);
    const preliminary = shiftTrimWindow(
      startTrimIn.current,
      startTrimOut.current,
      preliminaryDx / PIXELS_PER_SECOND,
      trackData.duration
    );
    const preliminaryCenter =
      offset + ((preliminary.trimIn + preliminary.trimOut) / 2) * PIXELS_PER_SECOND;
    applyEdgeAutoScroll(preliminaryCenter);
    const effectiveDx = getEffectiveDx(gesture);
    const next = shiftTrimWindow(
      startTrimIn.current,
      startTrimOut.current,
      effectiveDx / PIXELS_PER_SECOND,
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

  const bodyResponder = useRef(
    PanResponder.create({
      ...trimPanCapture,
      onPanResponderGrant: () => beginTrimGestureRef.current(),
      onPanResponderMove: (event, gesture) => bodyMoveRef.current(event, gesture),
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
        {...bodyResponder.panHandlers}
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

function TrackWaveformRow({
  track,
  bandWidth,
  contentWidth,
  sidePadding,
  trackHeight,
  onPress,
  trimOverlay,
  volumeVisualDb,
  trimScrollHelpers,
}: {
  track: TrackData;
  bandWidth: number;
  contentWidth: number;
  sidePadding: number;
  trackHeight: number;
  onPress: (locationX: number) => void;
  trimOverlay?: TrimOverlayConfig;
  volumeVisualDb?: number;
  trimScrollHelpers?: TrimScrollHelpers;
}) {
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

  return (
    <Pressable
      onPress={(event) => onPress(event.nativeEvent.locationX)}
      style={[styles.trackRow, { height: trackHeight }]}>
      <View
        style={[
          styles.waveformBand,
          { width: bandWidth, height: trackHeight },
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
                      backgroundColor: track.isActive
                        ? VoiceMemosColors.accent
                        : VoiceMemosColors.waveformBar,
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
      </View>
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
  onWidthChange,
  trimOverlay,
  volumeVisualDb,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrollingRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const trimGestureActiveRef = useRef(false);
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
    viewportHeight > 0 ? viewportHeight - MARKER_ROW_HEIGHT : 1
  );
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
    onTrackPressRef.current(trackId);
    if (duration <= 0 || contentWidth <= 0) {
      return;
    }
    const waveformX = locationX - sidePadding;
    onSeek(scrollXToTime(waveformX, duration));
  };

  const handleScrollBeginDrag = () => {
    isUserScrollingRef.current = true;
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    scrollOffsetRef.current = x;
    if (trimOverlay || trimGestureActiveRef.current) {
      return;
    }
    if (!isUserScrollingRef.current || duration <= 0 || contentWidth <= 0) {
      return;
    }
    onSeekRef.current(scrollXToTime(x, duration));
  };

  const trimScrollHelpers = useMemo<TrimScrollHelpers | undefined>(() => {
    if (!trimOverlay || viewportWidth <= 0) {
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
      },
    };
  }, [trimOverlay, viewportWidth]);

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
    if (
      viewportWidth <= 0 ||
      isPlaying ||
      isRecording ||
      trimOverlay ||
      isUserScrollingRef.current
    ) {
      return;
    }
    scrollRef.current?.scrollTo({ x: scrollX, animated: true });
  }, [scrollX, viewportWidth, isRecording, isPlaying, trimOverlay]);

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
    <View onLayout={handleLayout} style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        bounces={false}
        nestedScrollEnabled
        scrollEnabled={!isPlaying && !isRecording && !trimOverlay}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        style={styles.scrollView}>
        <View style={[styles.scrollContent, { width: totalContentWidth || viewportWidth }]}>
          {tracks.map((track) => (
            <TrackWaveformRow
              key={track.id}
              bandWidth={bandWidth}
              contentWidth={contentWidth}
              sidePadding={sidePadding}
              track={track}
              trackHeight={trackHeight}
              trimOverlay={trimOverlay}
              trimScrollHelpers={trimScrollHelpers}
              volumeVisualDb={volumeVisualDb}
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
      <View pointerEvents="none" style={[styles.fixedPlayhead, { height: waveformAreaHeight }]}>
        <View style={styles.playheadCapTop} />
        <View style={styles.playheadLine} />
        <View style={styles.playheadCapBottom} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: VoiceMemosColors.waveformBandBackground,
    position: 'relative',
    justifyContent: 'center',
  },
  dimRegion: {
    position: 'absolute',
    backgroundColor: VoiceMemosColors.waveformDimBackground,
  },
  centerLine: {
    position: 'absolute',
    top: '50%',
    height: 1,
    marginTop: -0.5,
    backgroundColor: VoiceMemosColors.waveformCenterLine,
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
    backgroundColor: VoiceMemosColors.accent,
    marginTop: -PLAYHEAD_CAP_SIZE / 2,
  },
  playheadCapBottom: {
    width: PLAYHEAD_CAP_SIZE,
    height: PLAYHEAD_CAP_SIZE,
    borderRadius: PLAYHEAD_CAP_SIZE / 2,
    backgroundColor: VoiceMemosColors.accent,
    marginBottom: -PLAYHEAD_CAP_SIZE / 2,
  },
  playheadLine: {
    flex: 1,
    width: 2,
    backgroundColor: VoiceMemosColors.accent,
  },
  markerBand: {
    height: MARKER_ROW_HEIGHT,
    backgroundColor: VoiceMemosColors.waveformMarkerBackground,
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
    backgroundColor: VoiceMemosColors.secondaryText,
    opacity: 0.35,
  },
  markerLabel: {
    marginTop: 2,
    fontSize: 10,
    color: VoiceMemosColors.secondaryText,
    fontVariant: ['tabular-nums'],
  },
  trimDim: {
    position: 'absolute',
    top: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
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
});
