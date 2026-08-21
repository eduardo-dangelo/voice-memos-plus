import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import {
  type MetronomeGridLine,
  type MetronomeGridLineKind,
} from '@/src/audio/metronome';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

export {
  buildMetronomeGridLines,
  FOLLOW_BAR_PAINT_OVERSCAN_VIEWPORTS,
  getFollowBarPaintTimeRange,
  getMetronomeGridBufferRange,
  getVisibleTimeRange,
  isMetronomeGridBufferValid,
  isViewportTimeBufferUninitialized,
  METRONOME_GRID_BUFFER_VIEWPORTS,
  METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS,
  PLACEHOLDER_TIMELINE_DURATION_SEC,
  resolvePlaybackBarPaintRange,
  shouldReseedPlaybackViewport,
  type MetronomeGridBuffer,
} from './metronomeGridViewport';

const LINE_WIDTH: Record<MetronomeGridLineKind, number> = {
  bar: 1.5,
  secondary: 1,
  beat: StyleSheet.hairlineWidth,
};

/** Dark: softer bars. Light: stronger beats so they read on pale waveforms. */
function getTrackLineOpacity(dark: boolean): Record<MetronomeGridLineKind, number> {
  return dark
    ? { bar: 0.16, secondary: 0.12, beat: 0.1 }
    : { bar: 0.26, secondary: 0.2, beat: 0.18 };
}

function getRulerTickOpacity(dark: boolean): Record<MetronomeGridLineKind, number> {
  return dark
    ? { bar: 0.36, secondary: 0.28, beat: 0.22 }
    : { bar: 0.5, secondary: 0.4, beat: 0.36 };
}

type TrackGridProps = {
  height: number;
  lines: MetronomeGridLine[];
  sidePadding: number;
  pixelsPerSecond: number;
};

function MetronomeTrackGridComponent({
  height,
  lines,
  sidePadding,
  pixelsPerSecond,
}: TrackGridProps) {
  const colors = useVoiceMemosColors();
  const scheme = useColorScheme();
  const lineColor = colors.secondaryText;
  const lineOpacity = useMemo(() => getTrackLineOpacity(scheme === 'dark'), [scheme]);

  if (height <= 0 || lines.length === 0) {
    return null;
  }

  return (
    <View pointerEvents="none" style={[styles.layer, { height }]}>
      {lines.map((line) => (
        <View
          key={`${line.kind}-${line.time}`}
          style={[
            styles.line,
            {
              left: Math.round(sidePadding + line.time * pixelsPerSecond),
              width: LINE_WIDTH[line.kind],
              height,
              backgroundColor: lineColor,
              opacity: lineOpacity[line.kind],
            },
          ]}
        />
      ))}
    </View>
  );
}

export const MetronomeTrackGrid = memo(MetronomeTrackGridComponent);

type RulerTickProps = {
  lines: MetronomeGridLine[];
  sidePadding: number;
  pixelsPerSecond: number;
  height: number;
};

function MetronomeRulerTicksComponent({
  lines,
  sidePadding,
  pixelsPerSecond,
  height,
}: RulerTickProps) {
  const colors = useVoiceMemosColors();
  const scheme = useColorScheme();
  const tickColor = colors.secondaryText;
  const maxHeight = Math.min(height, 8);
  const tickOpacity = useMemo(() => getRulerTickOpacity(scheme === 'dark'), [scheme]);

  const tickHeight: Record<MetronomeGridLineKind, number> = useMemo(
    () => ({
      bar: maxHeight,
      secondary: Math.max(4, maxHeight * 0.75),
      beat: Math.max(3, maxHeight * 0.55),
    }),
    [maxHeight]
  );

  return (
    <>
      {lines.map((line) => (
        <View
          key={`ruler-${line.kind}-${line.time}`}
          pointerEvents="none"
          style={[styles.rulerMarker, { left: Math.round(sidePadding + line.time * pixelsPerSecond) }]}>
          <View
            style={{
              width: line.kind === 'bar' ? 1.5 : 1,
              height: tickHeight[line.kind],
              backgroundColor: tickColor,
              opacity: tickOpacity[line.kind],
            }}
          />
        </View>
      ))}
    </>
  );
}

export const MetronomeRulerTicks = memo(MetronomeRulerTicksComponent);

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  line: {
    position: 'absolute',
    top: 0,
  },
  rulerMarker: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
});
