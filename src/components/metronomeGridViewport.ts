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
 * Reseeds when the playhead leaves the window (seek / duration-capped expand)
 * so SVG bars are not cropped or blanked.
 */
export function resolvePlaybackBarPaintRange(
  buffer: MetronomeGridBuffer,
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  duration: number,
  bufferViewports = METRONOME_GRID_BUFFER_VIEWPORTS
): MetronomeGridBuffer {
  if (viewportWidth <= 0 || pixelsPerSecond <= 0 || duration <= 0) {
    return buffer.start === 0 && buffer.end === 0 ? buffer : { start: 0, end: 0 };
  }
  const needsReseed =
    isViewportTimeBufferUninitialized(buffer) ||
    !isMetronomeGridBufferValid(
      buffer,
      scrollX,
      viewportWidth,
      pixelsPerSecond,
      0.5,
      duration
    );
  if (!needsReseed) {
    return buffer;
  }
  return getMetronomeGridBufferRange(
    scrollX,
    viewportWidth,
    pixelsPerSecond,
    duration,
    bufferViewports
  );
}

/**
 * Stable paint window while recording follow-scrolls. Reuses a buffered range
 * until the playhead nears the edge so sibling track SVGs are not remounted on
 * every live-peak React commit (stack flicker).
 */
export const RECORDING_BAR_PAINT_BUFFER_VIEWPORTS = METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS;

/** Invalidate before the tight follow overscan (0.2) would show blank bars. */
export const RECORDING_BAR_PAINT_VALIDITY_MARGIN_VIEWPORTS = 1;

export function resolveRecordingBarPaintRange(
  buffer: MetronomeGridBuffer | null,
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  bufferViewports = RECORDING_BAR_PAINT_BUFFER_VIEWPORTS,
  validityMarginViewports = RECORDING_BAR_PAINT_VALIDITY_MARGIN_VIEWPORTS
): MetronomeGridBuffer {
  if (viewportWidth <= 0 || pixelsPerSecond <= 0) {
    return buffer != null && buffer.end > buffer.start ? buffer : { start: 0, end: 0 };
  }
  if (
    isMetronomeGridBufferValid(
      buffer,
      scrollX,
      viewportWidth,
      pixelsPerSecond,
      validityMarginViewports
    )
  ) {
    return buffer!;
  }
  // Unbounded duration — memo length lags the growing capture timeline.
  return getMetronomeGridBufferRange(
    scrollX,
    viewportWidth,
    pixelsPerSecond,
    Number.POSITIVE_INFINITY,
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
  // Move expand/retract — force sync while gestureOverlay would otherwise
  // block the idle scroll path (stale grid lines past the new end).
  if (Math.abs(duration - previousDuration) > 1e-6) {
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
  // Stale buffer from a longer timeline (Move retract) — force clamp/rebuild.
  if (Number.isFinite(durationCap) && buffer.end > durationCap + 1e-6) {
    return false;
  }
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
