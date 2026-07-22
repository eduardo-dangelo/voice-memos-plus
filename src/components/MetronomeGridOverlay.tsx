import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import {
  getMetronomeGridLinesInRange,
  type MetronomeGridLine,
  type MetronomeGridLineKind,
} from '@/src/audio/metronome';
import type { MetronomeSettings } from '@/src/storage/types';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

/** Viewport widths of overscan on each side of the visible range. */
export const METRONOME_GRID_BUFFER_VIEWPORTS = 2;

/** Extra overscan while the timeline is auto-scrolling (play / live record). */
export const METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS = 6;

export type MetronomeGridBuffer = {
  start: number;
  end: number;
};

export function getVisibleTimeRange(
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number
): { start: number; end: number } {
  if (viewportWidth <= 0 || pixelsPerSecond <= 0) {
    return { start: 0, end: 0 };
  }
  const start = Math.max(0, scrollX / pixelsPerSecond);
  const end = start + viewportWidth / pixelsPerSecond;
  return { start, end };
}

export function getMetronomeGridBufferRange(
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  duration: number,
  bufferViewports = METRONOME_GRID_BUFFER_VIEWPORTS
): MetronomeGridBuffer {
  const visible = getVisibleTimeRange(scrollX, viewportWidth, pixelsPerSecond);
  const pad = (viewportWidth / Math.max(pixelsPerSecond, 1)) * bufferViewports;
  return {
    start: Math.max(0, visible.start - pad),
    end: Math.max(0, Math.min(Math.max(0, duration), visible.end + pad)),
  };
}

/** True when the visible range still sits comfortably inside the buffer. */
export function isMetronomeGridBufferValid(
  buffer: MetronomeGridBuffer | null,
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  validityMarginViewports = 0.5
): boolean {
  if (!buffer || viewportWidth <= 0 || pixelsPerSecond <= 0) {
    return false;
  }
  const visible = getVisibleTimeRange(scrollX, viewportWidth, pixelsPerSecond);
  const margin = (viewportWidth / pixelsPerSecond) * validityMarginViewports;
  return visible.start >= buffer.start + margin && visible.end <= buffer.end - margin;
}

export function buildMetronomeGridLines(
  settings: MetronomeSettings,
  buffer: MetronomeGridBuffer,
  pixelsPerSecond: number
): MetronomeGridLine[] {
  return getMetronomeGridLinesInRange(settings, buffer.start, buffer.end, pixelsPerSecond);
}

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
              left: sidePadding + line.time * pixelsPerSecond,
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
          style={[styles.rulerMarker, { left: sidePadding + line.time * pixelsPerSecond }]}>
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
