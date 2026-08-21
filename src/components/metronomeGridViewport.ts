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

/**
 * Extra paint past each screen edge while play/record follow scrolls.
 * Fraction of viewport width — scales for phone and iPad without device branches.
 */
export const FOLLOW_BAR_PAINT_OVERSCAN_VIEWPORTS = 0.2;

/**
 * Visible range plus a small overscan so virtualization edges stay off-screen
 * between React paint refreshes during auto-scroll.
 */
export function getFollowBarPaintTimeRange(
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  overscanViewports = FOLLOW_BAR_PAINT_OVERSCAN_VIEWPORTS
): { start: number; end: number } {
  const visible = getVisibleTimeRange(scrollX, viewportWidth, pixelsPerSecond);
  if (viewportWidth <= 0 || pixelsPerSecond <= 0) {
    return visible;
  }
  const pad = (viewportWidth / pixelsPerSecond) * overscanViewports;
  return {
    start: Math.max(0, visible.start - pad),
    end: visible.end + pad,
  };
}

/** Dummy/empty-lane duration used before a real clip length is known. */
export const PLACEHOLDER_TIMELINE_DURATION_SEC = 0.02;

export function isViewportTimeBufferUninitialized(
  buffer: MetronomeGridBuffer | null
): boolean {
  return buffer == null || buffer.end <= buffer.start;
}

/**
 * Playback paint window: keep an already-valid buffer, otherwise seed a bounded
 * overscan range. Never expands to the full timeline (stack-arm remount freeze).
 */
export function resolvePlaybackBarPaintRange(
  buffer: MetronomeGridBuffer,
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  duration: number,
  bufferViewports = METRONOME_GRID_BUFFER_VIEWPORTS
): MetronomeGridBuffer {
  if (buffer.end > buffer.start) {
    return buffer;
  }
  if (viewportWidth <= 0 || pixelsPerSecond <= 0 || duration <= 0) {
    return buffer.start === 0 && buffer.end === 0 ? buffer : { start: 0, end: 0 };
  }
  return getMetronomeGridBufferRange(
    scrollX,
    viewportWidth,
    pixelsPerSecond,
    duration,
    bufferViewports
  );
}

/** True when first layout/duration catch-up must reseed (not every recording tick). */
export function shouldReseedPlaybackViewport(
  buffer: MetronomeGridBuffer | null,
  viewportWidth: number,
  pixelsPerSecond: number,
  duration: number,
  previousDuration: number
): boolean {
  if (viewportWidth <= 0 || pixelsPerSecond <= 0 || duration <= 0) {
    return false;
  }
  if (isViewportTimeBufferUninitialized(buffer)) {
    return true;
  }
  return (
    previousDuration <= PLACEHOLDER_TIMELINE_DURATION_SEC &&
    duration > PLACEHOLDER_TIMELINE_DURATION_SEC
  );
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
  const durationCap = Math.max(0, duration);
  // Clamp start into [0, duration] first so a stale scroll/pps pair (e.g. mid-zoom
  // before layout catches up) cannot produce start > end and blank the waveform.
  const start = Math.max(0, Math.min(durationCap, visible.start - pad));
  const end = Math.max(start, Math.min(durationCap, Math.max(0, visible.end + pad)));
  return { start, end };
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
