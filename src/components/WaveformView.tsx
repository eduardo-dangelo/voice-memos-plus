import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
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

function TrackWaveformRow({
  track,
  bandWidth,
  contentWidth,
  sidePadding,
  trackHeight,
  onPress,
}: {
  track: TrackData;
  bandWidth: number;
  contentWidth: number;
  sidePadding: number;
  trackHeight: number;
  onPress: (locationX: number) => void;
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
              const scaled = peakToAbsoluteScale(peak);
              const barHeight =
                scaled <= 0.01
                  ? 2
                  : Math.max(4, scaled * (trackHeight - 16));
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
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrollingRef = useRef(false);
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
    if (!isUserScrollingRef.current || duration <= 0 || contentWidth <= 0) {
      return;
    }
    const x = event.nativeEvent.contentOffset.x;
    onSeekRef.current(scrollXToTime(x, duration));
  };

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
    if (viewportWidth <= 0 || isPlaying || isRecording || isUserScrollingRef.current) {
      return;
    }
    scrollRef.current?.scrollTo({ x: scrollX, animated: true });
  }, [scrollX, viewportWidth, isRecording, isPlaying]);

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
        scrollEnabled={!isPlaying && !isRecording}
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
});
