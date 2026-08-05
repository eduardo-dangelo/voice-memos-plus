import { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { colorDesaturatedWithAlpha } from '@/constants/VoiceMemosColors';
import { hasAnySoloActive } from '@/src/audio/layerEffects';
import {
  barsPerCycleAtPps,
  loopPeakIndex,
  normalizePeaksForBarCount,
  peakToAbsoluteScale,
  slicePeaksForTrim,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
} from '@/src/audio/waveform';
import { resolveTrackColor } from '@/src/components/TrackColorPicker';
import type { Memo } from '@/src/storage/types';
import {
  getLayerActiveDuration,
  getLayerActiveStartTime,
  getLayerEffects,
  getLayerFootprintDuration,
} from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
const LANE_HEIGHT = 64;
const PLAYHEAD_LINE_WIDTH = 2;
const PLAYHEAD_CAP_SIZE = 6;
/** Keep a faint hint of track hue; mostly grayscale. */
const UNPLAYED_SATURATION = 0.12;
const UNPLAYED_ALPHA = 0.45;
const PAN_ACTIVE_OFFSET_X = 8;
/** Slightly loose so minor diagonal scrubs still win over vertical list scroll. */
const PAN_FAIL_OFFSET_Y = 24;
const TAP_MAX_DISTANCE = 10;
const SCRUB_ENGINE_THROTTLE_MS = 32;

type MiniTrack = {
  id: string;
  peaks?: number[];
  startTime: number;
  duration: number;
  cycleDuration: number;
  color: string;
  isMuted: boolean;
  isSoloed: boolean;
  isSoloedOut: boolean;
};

type Props = {
  memo: Memo;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onPress?: () => void;
};

function buildMiniTracks(memo: Memo): MiniTrack[] {
  const anySoloActive = hasAnySoloActive(memo.layers.map((entry) => getLayerEffects(entry)));

  return [...memo.layers]
    .filter((layer) => layer.duration > 0)
    .sort((a, b) => b.order - a.order)
    .map((layer) => {
      const effects = getLayerEffects(layer);
      const activeDuration = getLayerActiveDuration(layer);
      const footprintDuration = getLayerFootprintDuration(layer);
      return {
        id: layer.id,
        peaks: slicePeaksForTrim(
          layer.waveformPeaks,
          layer.duration,
          effects.trimIn,
          effects.trimOut
        ),
        startTime: getLayerActiveStartTime(layer),
        duration: Math.max(footprintDuration, 0.01),
        cycleDuration: Math.max(activeDuration, 0.01),
        color: resolveTrackColor(layer.color),
        isMuted: Boolean(effects.muted),
        isSoloed: Boolean(effects.solo),
        isSoloedOut: anySoloActive && !effects.solo,
      };
    });
}

function timeFromX(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) {
    return 0;
  }
  const ratio = Math.max(0, Math.min(1, x / width));
  return ratio * duration;
}

export function MiniWaveformTracks({
  memo,
  currentTime,
  duration,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onPress,
}: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const [width, setWidth] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const tracks = useMemo(() => buildMiniTracks(memo), [memo]);
  const widthRef = useRef(width);
  const durationRef = useRef(duration);
  const onSeekRef = useRef(onSeek);
  const onScrubStartRef = useRef(onScrubStart);
  const onScrubEndRef = useRef(onScrubEnd);
  const onPressRef = useRef(onPress);
  const scrubActiveRef = useRef(false);
  const scrubTimeRef = useRef<number | null>(null);
  const lastEngineSeekAtRef = useRef(0);

  widthRef.current = width;
  durationRef.current = duration;
  onSeekRef.current = onSeek;
  onScrubStartRef.current = onScrubStart;
  onScrubEndRef.current = onScrubEnd;
  onPressRef.current = onPress;

  const pushEngineSeek = (time: number, force: boolean) => {
    const now = Date.now();
    if (!force && now - lastEngineSeekAtRef.current < SCRUB_ENGINE_THROTTLE_MS) {
      return;
    }
    lastEngineSeekAtRef.current = now;
    onSeekRef.current(time);
  };

  const applyScrubX = (x: number, forceEngine: boolean) => {
    const time = timeFromX(x, widthRef.current, durationRef.current);
    scrubTimeRef.current = time;
    setScrubTime(time);
    pushEngineSeek(time, forceEngine);
  };

  const handlePanStart = (x: number) => {
    scrubActiveRef.current = true;
    lastEngineSeekAtRef.current = 0;
    onScrubStartRef.current?.();
    applyScrubX(x, true);
  };

  const handlePanUpdate = (x: number) => {
    if (!scrubActiveRef.current) {
      return;
    }
    applyScrubX(x, false);
  };

  const handlePanEnd = () => {
    if (!scrubActiveRef.current) {
      return;
    }
    scrubActiveRef.current = false;
    const time = scrubTimeRef.current;
    if (time != null) {
      pushEngineSeek(time, true);
    }
    onScrubEndRef.current?.();
    scrubTimeRef.current = null;
    setScrubTime(null);
  };

  const handleTap = () => {
    onPressRef.current?.();
  };

  const gesture = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Pan()
          .activeOffsetX([-PAN_ACTIVE_OFFSET_X, PAN_ACTIVE_OFFSET_X])
          .failOffsetY([-PAN_FAIL_OFFSET_Y, PAN_FAIL_OFFSET_Y])
          .onStart((event) => {
            runOnJS(handlePanStart)(event.x);
          })
          .onUpdate((event) => {
            runOnJS(handlePanUpdate)(event.x);
          })
          .onEnd(() => {
            runOnJS(handlePanEnd)();
          })
          .onFinalize((_event, success) => {
            if (!success) {
              runOnJS(handlePanEnd)();
            }
          }),
        Gesture.Tap()
          .maxDistance(TAP_MAX_DISTANCE)
          .onEnd(() => {
            runOnJS(handleTap)();
          })
      ),
    // Handlers close over refs; gesture instance is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    []
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) {
      setWidth(next);
    }
  };

  const playheadTime = scrubTime ?? currentTime;
  const barStepTime = width > 0 && duration > 0 ? (BAR_STEP / width) * duration : 0;
  // Keep played coloring; only skip redundant bar style rebuilds within the same bar.
  // Playhead still uses full-precision playheadTime above.
  const rawColorTime = scrubTime ?? currentTime;
  const colorTime =
    barStepTime > 0 ? Math.floor(rawColorTime / barStepTime) * barStepTime : rawColorTime;

  const lanes = useMemo(() => {
    if (tracks.length === 0 || duration <= 0 || width <= 0) {
      return null;
    }
    const laneHeight = LANE_HEIGHT;
    return tracks.map((track) => {
      const activeColor =
        track.isMuted || track.isSoloedOut ? colors.waveformBar : track.color;
      const unplayedColor = colorDesaturatedWithAlpha(
        activeColor,
        UNPLAYED_SATURATION,
        UNPLAYED_ALPHA
      );
      const left = (track.startTime / duration) * width;
      const trackWidth = Math.max(0, (track.duration / duration) * width);
      const barCount = Math.max(0, Math.floor(trackWidth / BAR_STEP));
      const effectivePps = duration > 0 ? width / duration : 0;
      const barsPerCycle = barsPerCycleAtPps(track.cycleDuration, effectivePps, BAR_STEP);
      const cycleBarCount = Math.max(1, Math.floor(barsPerCycle));
      const cyclePeaks =
        barCount > 0 ? normalizePeaksForBarCount(track.peaks, cycleBarCount) : [];
      const maxBarHeight = Math.max(2, laneHeight - 2);

      return (
        <View
          key={track.id}
          style={[
            styles.lane,
            {
              height: laneHeight,
              backgroundColor: colors.waveformBandBackground,
            },
          ]}>
          {trackWidth > 0 ? (
            <View style={[styles.barsRow, { left, width: trackWidth, height: laneHeight }]}>
              {Array.from({ length: barCount }, (_, index) => {
                const peak =
                  cyclePeaks[loopPeakIndex(index, barsPerCycle, cycleBarCount)] ?? 0;
                const scaled = peakToAbsoluteScale(peak);
                const barHeight =
                  scaled <= 0.01
                    ? 1
                    : Math.max(1.5, Math.min(maxBarHeight, scaled * maxBarHeight));
                const barTime = ((left + index * BAR_STEP) / width) * duration;
                const backgroundColor = barTime < colorTime ? activeColor : unplayedColor;
                return (
                  <View
                    key={index}
                    style={[
                      styles.bar,
                      {
                        left: index * BAR_STEP,
                        top: (laneHeight - barHeight) / 2,
                        width: WAVEFORM_BAR_WIDTH,
                        height: barHeight,
                        backgroundColor,
                      },
                    ]}
                  />
                );
              })}
            </View>
          ) : null}
          {trackWidth > 0 && track.isMuted ? (
            <View
              pointerEvents="none"
              style={[styles.floatingBadge, styles.mutedBadge, { left: left + 4 }]}>
              <Text style={styles.mutedBadgeText}>M</Text>
            </View>
          ) : null}
          {trackWidth > 0 && track.isSoloed ? (
            <View
              pointerEvents="none"
              style={[
                styles.floatingBadge,
                styles.soloBadge,
                { left: left + (track.isMuted ? 26 : 4) },
              ]}>
              <Text style={styles.soloBadgeText}>S</Text>
            </View>
          ) : null}
        </View>
      );
    });
  }, [tracks, width, duration, colorTime, colors, styles]);

  if (tracks.length === 0 || duration <= 0) {
    return null;
  }

  const totalHeight = tracks.length * LANE_HEIGHT;
  const playheadLeft =
    width > 0 ? Math.max(0, Math.min(1, playheadTime / duration)) * width : 0;

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityLabel="Edit Recording"
        accessibilityRole="button"
        importantForAccessibility="yes"
        style={[styles.container, { height: totalHeight }]}
        onLayout={onLayout}>
        <View style={[styles.lanesClip, { height: totalHeight }]}>{lanes}</View>
        {width > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.playhead, { left: playheadLeft, height: totalHeight }]}>
            <View style={styles.playheadCapTop} />
            <View style={styles.playheadLine} />
            <View style={styles.playheadCapBottom} />
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function useStyles(colors: ReturnType<typeof useVoiceMemosColors>) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: '100%',
          overflow: 'visible',
          borderRadius: 6,
          marginTop: 4,
        },
        lanesClip: {
          width: '100%',
          overflow: 'hidden',
          borderRadius: 6,
        },
        lane: {
          width: '100%',
          overflow: 'hidden',
        },
        barsRow: {
          position: 'absolute',
          top: 0,
        },
        bar: {
          position: 'absolute',
          borderRadius: 1,
        },
        floatingBadge: {
          position: 'absolute',
          top: 4,
        },
        mutedBadge: {
          zIndex: 6,
          minWidth: 18,
          height: 16,
          borderRadius: 3,
          paddingHorizontal: 4,
          backgroundColor: colors.secondaryText,
          alignItems: 'center',
          justifyContent: 'center',
        },
        mutedBadgeText: {
          fontSize: 10,
          fontWeight: '700',
          color: colors.background,
          lineHeight: 12,
        },
        soloBadge: {
          zIndex: 6,
          minWidth: 18,
          height: 16,
          borderRadius: 3,
          paddingHorizontal: 4,
          backgroundColor: colors.soloBadge,
          alignItems: 'center',
          justifyContent: 'center',
        },
        soloBadgeText: {
          fontSize: 10,
          fontWeight: '700',
          color: colors.soloBadgeText,
          lineHeight: 12,
        },
        playhead: {
          position: 'absolute',
          top: 0,
          width: PLAYHEAD_LINE_WIDTH,
          marginLeft: -PLAYHEAD_LINE_WIDTH / 2,
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
          width: PLAYHEAD_LINE_WIDTH,
          backgroundColor: colors.accent,
        },
      }),
    [colors]
  );
}
