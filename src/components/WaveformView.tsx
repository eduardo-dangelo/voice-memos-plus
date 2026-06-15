import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import {
  getPeaksForMemo,
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
const WAVEFORM_HEIGHT = 180;
const MARKER_ROW_HEIGHT = 24;
const TRACK_HEIGHT = WAVEFORM_HEIGHT + MARKER_ROW_HEIGHT;
const MIN_LABEL_SPACING = 48;

type Props = {
  peaks?: number[];
  currentTime: number;
  duration: number;
  isRecording?: boolean;
  isPlaying?: boolean;
  getPlaybackTime?: () => number;
  onSeek: (time: number) => void;
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

export function WaveformView({
  peaks,
  currentTime,
  duration,
  isRecording = false,
  isPlaying = false,
  getPlaybackTime,
  onSeek,
  onWidthChange,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const getPlaybackTimeRef = useRef(getPlaybackTime);
  getPlaybackTimeRef.current = getPlaybackTime;
  const [viewportWidth, setViewportWidth] = useState(0);

  const targetWidth = duration > 0 ? duration * PIXELS_PER_SECOND : 0;
  const barCount =
    targetWidth > 0
      ? Math.max(1, Math.floor(targetWidth / BAR_STEP))
      : viewportWidth > 0
        ? Math.max(1, Math.floor(viewportWidth / BAR_STEP))
        : 0;
  const contentWidth =
    barCount > 0 ? Math.max(viewportWidth, barCount * BAR_STEP) : viewportWidth;
  const sidePadding = viewportWidth / 2;
  const totalContentWidth = viewportWidth + contentWidth;

  const normalizedPeaks = useMemo(() => {
    const source = getPeaksForMemo(peaks, barCount);
    return barCount > 0 ? resamplePeaks(source, barCount) : [];
  }, [barCount, peaks]);

  const scrollX =
    duration > 0
      ? Math.max(0, Math.min(contentWidth, (currentTime / duration) * contentWidth))
      : 0;

  const markerInterval = getMarkerInterval();
  const markerSeconds = useMemo(() => {
    if (duration <= 0) {
      return [];
    }
    const ticks: number[] = [];
    for (let second = 0; second <= Math.ceil(duration); second += 1) {
      ticks.push(second);
    }
    return ticks;
  }, [duration]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setViewportWidth(nextWidth);
    onWidthChange?.(nextWidth);
  };

  const handlePress = (locationX: number) => {
    if (duration <= 0 || contentWidth <= 0) {
      return;
    }
    const waveformX = locationX - sidePadding;
    const ratio = Math.max(0, Math.min(1, waveformX / contentWidth));
    onSeek(ratio * duration);
  };

  useEffect(() => {
    if (viewportWidth <= 0 || isPlaying) {
      return;
    }
    scrollRef.current?.scrollTo({ x: scrollX, animated: !isRecording });
  }, [scrollX, viewportWidth, isRecording, isPlaying]);

  useEffect(() => {
    if (!isPlaying || duration <= 0 || viewportWidth <= 0 || contentWidth <= 0) {
      return;
    }

    let raf = 0;
    const tick = () => {
      const time = getPlaybackTimeRef.current?.() ?? currentTime;
      const x = Math.max(0, Math.min(contentWidth, (time / duration) * contentWidth));
      scrollRef.current?.scrollTo({ x, animated: false });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, duration, contentWidth, viewportWidth, currentTime]);

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        bounces={false}
        nestedScrollEnabled
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.scrollView}>
        <Pressable
          onPress={(event) => handlePress(event.nativeEvent.locationX)}
          style={[styles.scrollContent, { width: totalContentWidth || viewportWidth }]}>
          <View style={[styles.waveformBand, { width: totalContentWidth || viewportWidth }]}>
            <View
              pointerEvents="none"
              style={[styles.centerLine, { left: sidePadding, width: contentWidth }]}
            />
            <View
              pointerEvents="none"
              style={[styles.barsRow, { marginLeft: sidePadding, width: contentWidth }]}>
              {normalizedPeaks.map((peak, index) => {
                const barHeight = Math.max(4, peak * (WAVEFORM_HEIGHT - 16));
                return (
                  <View
                    key={index}
                    style={[
                      styles.bar,
                      {
                        height: barHeight,
                        backgroundColor: VoiceMemosColors.waveformBar,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
          <View
            pointerEvents="none"
            style={[styles.markerBand, { width: totalContentWidth || viewportWidth }]}>
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
        </Pressable>
      </ScrollView>
      <View pointerEvents="none" style={styles.fixedPlayhead}>
        <View style={styles.playheadCap} />
        <View style={styles.playheadLine} />
        <View style={styles.playheadCap} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: TRACK_HEIGHT,
    position: 'relative',
  },
  scrollView: {
    height: TRACK_HEIGHT,
  },
  scrollContent: {
    height: TRACK_HEIGHT,
  },
  waveformBand: {
    height: WAVEFORM_HEIGHT,
    backgroundColor: VoiceMemosColors.waveformBandBackground,
    position: 'relative',
    justifyContent: 'center',
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
    height: WAVEFORM_HEIGHT,
    width: 2,
    marginLeft: -1,
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  playheadCap: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: VoiceMemosColors.accent,
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
