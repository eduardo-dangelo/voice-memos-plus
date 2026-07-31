import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { colorDesaturatedWithAlpha } from '@/constants/VoiceMemosColors';
import { hasAnySoloActive } from '@/src/audio/layerEffects';
import {
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
} from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

const BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
const LANE_HEIGHT = 64;
const PLAYHEAD_LINE_WIDTH = 2;
const PLAYHEAD_CAP_SIZE = 6;
/** Keep a faint hint of track hue; mostly grayscale. */
const UNPLAYED_SATURATION = 0.12;
const UNPLAYED_ALPHA = 0.45;

type MiniTrack = {
  id: string;
  peaks?: number[];
  startTime: number;
  duration: number;
  color: string;
  isMuted: boolean;
  isSoloedOut: boolean;
};

type Props = {
  memo: Memo;
  currentTime: number;
  duration: number;
};

function buildMiniTracks(memo: Memo): MiniTrack[] {
  const anySoloActive = hasAnySoloActive(memo.layers.map((entry) => getLayerEffects(entry)));

  return [...memo.layers]
    .filter((layer) => layer.duration > 0)
    .sort((a, b) => b.order - a.order)
    .map((layer) => {
      const effects = getLayerEffects(layer);
      const activeDuration = getLayerActiveDuration(layer);
      return {
        id: layer.id,
        peaks: slicePeaksForTrim(
          layer.waveformPeaks,
          layer.duration,
          effects.trimIn,
          effects.trimOut
        ),
        startTime: getLayerActiveStartTime(layer),
        duration: Math.max(activeDuration, 0.01),
        color: resolveTrackColor(layer.color),
        isMuted: Boolean(effects.muted),
        isSoloedOut: anySoloActive && !effects.solo,
      };
    });
}

export function MiniWaveformTracks({ memo, currentTime, duration }: Props) {
  const colors = useVoiceMemosColors();
  const styles = useStyles(colors);
  const [width, setWidth] = useState(0);
  const tracks = useMemo(() => buildMiniTracks(memo), [memo]);

  if (tracks.length === 0 || duration <= 0) {
    return null;
  }

  const totalHeight = tracks.length * LANE_HEIGHT;
  const laneHeight = LANE_HEIGHT;
  const playheadLeft =
    width > 0 ? Math.max(0, Math.min(1, currentTime / duration)) * width : 0;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) {
      setWidth(next);
    }
  };

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.container, { height: totalHeight }]}
      onLayout={onLayout}>
      <View style={[styles.lanesClip, { height: totalHeight }]}>
        {tracks.map((track) => {
          const activeColor =
            track.isMuted || track.isSoloedOut ? colors.waveformBar : track.color;
          const unplayedColor = colorDesaturatedWithAlpha(
            activeColor,
            UNPLAYED_SATURATION,
            UNPLAYED_ALPHA
          );
          const left = width > 0 ? (track.startTime / duration) * width : 0;
          const trackWidth =
            width > 0 ? Math.max(0, (track.duration / duration) * width) : 0;
          const barCount = Math.max(0, Math.floor(trackWidth / BAR_STEP));
          const normalized =
            barCount > 0 ? normalizePeaksForBarCount(track.peaks, barCount) : [];
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
                  {normalized.map((peak, index) => {
                    const scaled = peakToAbsoluteScale(peak);
                    const barHeight =
                      scaled <= 0.01
                        ? 1
                        : Math.max(1.5, Math.min(maxBarHeight, scaled * maxBarHeight));
                    const barTime =
                      width > 0 ? ((left + index * BAR_STEP) / width) * duration : 0;
                    const backgroundColor =
                      barTime < currentTime ? activeColor : unplayedColor;
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
            </View>
          );
        })}
      </View>
      {width > 0 ? (
        <View style={[styles.playhead, { left: playheadLeft, height: totalHeight }]}>
          <View style={styles.playheadCapTop} />
          <View style={styles.playheadLine} />
          <View style={styles.playheadCapBottom} />
        </View>
      ) : null}
    </View>
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
