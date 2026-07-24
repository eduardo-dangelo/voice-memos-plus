import {
  getMetronomeGridLinesInRange,
  type MetronomeGridLine,
} from '@/src/audio/metronome';
import type { MetronomeSettings } from '@/src/storage/types';

/** Viewport widths of overscan on each side of the visible range. */
export const METRONOME_GRID_BUFFER_VIEWPORTS = 2;

/** Extra overscan while the timeline is auto-scrolling (play / live record). */
export const METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS = 3;

export type MetronomeGridBuffer = {
  start: number;
  end: number;
};

/**
 * Visible timeline range for a centered playhead.
 * scrollX = playheadTime * pixelsPerSecond (playhead fixed at viewport center).
 */
export function getVisibleTimeRange(
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number
): { start: number; end: number } {
  if (viewportWidth <= 0 || pixelsPerSecond <= 0) {
    return { start: 0, end: 0 };
  }
  const playheadTime = scrollX / pixelsPerSecond;
  const halfViewportSec = viewportWidth / pixelsPerSecond / 2;
  const start = Math.max(0, playheadTime - halfViewportSec);
  const end = playheadTime + halfViewportSec;
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
  validityMarginViewports = 0.5,
  duration = Number.POSITIVE_INFINITY
): boolean {
  if (!buffer || viewportWidth <= 0 || pixelsPerSecond <= 0) {
    return false;
  }
  const visible = getVisibleTimeRange(scrollX, viewportWidth, pixelsPerSecond);
  const margin = (viewportWidth / pixelsPerSecond) * validityMarginViewports;
  const durationCap =
    Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const visibleStart = Math.max(0, visible.start);
  const visibleEnd = Math.min(visible.end, durationCap);

  // No left margin required when the buffer already starts at the timeline origin.
  const leftMargin = buffer.start <= 0 ? 0 : margin;
  // No right margin past the timeline end — buffer.end is clamped to duration there.
  const rightMargin = buffer.end >= durationCap - 1e-6 ? 0 : margin;

  return visibleStart >= buffer.start + leftMargin && visibleEnd <= buffer.end - rightMargin;
}

export function buildMetronomeGridLines(
  settings: MetronomeSettings,
  buffer: MetronomeGridBuffer,
  pixelsPerSecond: number
): MetronomeGridLine[] {
  return getMetronomeGridLinesInRange(settings, buffer.start, buffer.end, pixelsPerSecond);
}
