export const TIMELINE_DEFAULT_PIXELS_PER_SECOND = 48;
export const TIMELINE_MIN_PIXELS_PER_SECOND = 8;
export const TIMELINE_MAX_PIXELS_PER_SECOND = 384;
export const TIMELINE_VISIBLE_SECONDS_AT_MAX_ZOOM = 1.2;

export type TimelineZoomBounds = {
  pixelsPerSecondMin: number;
  pixelsPerSecondMax: number;
  pixelsPerSecondDefault: number;
  trackZoomMin: number;
  trackZoomMax: number;
};

export function getTimelineZoomBounds(
  viewportWidth: number,
  duration: number,
  trackCount: number
): TimelineZoomBounds {
  // Cap max first so tiny placeholder durations cannot push bounds into
  // nonsensical ranges (historically tens of thousands of px/s).
  const pixelsPerSecondMax =
    viewportWidth > 0
      ? Math.min(
          TIMELINE_MAX_PIXELS_PER_SECOND,
          viewportWidth / TIMELINE_VISIBLE_SECONDS_AT_MAX_ZOOM
        )
      : TIMELINE_MAX_PIXELS_PER_SECOND;

  // fitPps = pps needed to exactly fill the viewport with the full duration.
  // That is only a zoom-*out* floor for long content. When fitPps is above the
  // design default, the clip is shorter than the viewport at 1× — do not raise
  // min (that forced zoom-*in* on empty/short iPad timelines and stretched
  // design-density peaks).
  let pixelsPerSecondMin = TIMELINE_MIN_PIXELS_PER_SECOND;
  if (viewportWidth > 0 && duration > 0) {
    const fitPps = viewportWidth / duration;
    if (fitPps > TIMELINE_DEFAULT_PIXELS_PER_SECOND) {
      pixelsPerSecondMin = TIMELINE_MIN_PIXELS_PER_SECOND;
    } else {
      pixelsPerSecondMin = Math.max(TIMELINE_MIN_PIXELS_PER_SECOND, fitPps);
    }
  }
  pixelsPerSecondMin = Math.min(pixelsPerSecondMin, pixelsPerSecondMax);

  const pixelsPerSecondDefault = Math.max(
    pixelsPerSecondMin,
    Math.min(TIMELINE_DEFAULT_PIXELS_PER_SECOND, pixelsPerSecondMax)
  );

  return {
    pixelsPerSecondMin,
    pixelsPerSecondMax,
    pixelsPerSecondDefault,
    trackZoomMin: 1,
    trackZoomMax: Math.max(1, trackCount),
  };
}

export function clampTimelinePixelsPerSecond(
  value: number,
  bounds: TimelineZoomBounds
): number {
  return Math.max(bounds.pixelsPerSecondMin, Math.min(bounds.pixelsPerSecondMax, value));
}

export function clampTimelineTrackZoom(
  value: number,
  bounds: TimelineZoomBounds
): number {
  return Math.max(bounds.trackZoomMin, Math.min(bounds.trackZoomMax, value));
}

export const TIMELINE_FULL_ZOOM_SPAN_PX = 280;

export function applyPinchDeltaToPixelsPerSecond(
  startPps: number,
  startSpanX: number,
  currentSpanX: number,
  bounds: TimelineZoomBounds
): number {
  const spanDelta = currentSpanX - startSpanX;
  const range = bounds.pixelsPerSecondMax - bounds.pixelsPerSecondMin;
  return clampTimelinePixelsPerSecond(
    startPps + (spanDelta / TIMELINE_FULL_ZOOM_SPAN_PX) * range,
    bounds
  );
}

export function applyPinchDeltaToTrackZoom(
  startTrackZoom: number,
  startSpanY: number,
  currentSpanY: number,
  bounds: TimelineZoomBounds
): number {
  const spanDelta = currentSpanY - startSpanY;
  const range = bounds.trackZoomMax - bounds.trackZoomMin;
  return clampTimelineTrackZoom(
    startTrackZoom + (spanDelta / TIMELINE_FULL_ZOOM_SPAN_PX) * range,
    bounds
  );
}

const ZOOM_DEFAULT_TOLERANCE = 0.05;

/** Whether horizontal and vertical zoom multipliers are at default (1×). */
export function isTimelineZoomAtDefault(x: number, y: number): boolean {
  return (
    Math.abs(x - 1) < ZOOM_DEFAULT_TOLERANCE && Math.abs(y - 1) < ZOOM_DEFAULT_TOLERANCE
  );
}

/** Format a zoom multiplier for UI (e.g. `1×`, `1.5×`, `2×`). */
export function formatTimelineZoomMultiplier(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '1×';
  }
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded}×`;
  }
  return `${rounded.toFixed(1)}×`;
}

/** Horizontal multiplier relative to default pps; vertical is trackZoom as-is. */
export function getTimelineZoomDisplayMultipliers(
  pixelsPerSecond: number,
  trackZoom: number,
  pixelsPerSecondDefault: number
): { x: number; y: number } {
  const defaultPps =
    pixelsPerSecondDefault > 0 ? pixelsPerSecondDefault : TIMELINE_DEFAULT_PIXELS_PER_SECOND;
  return {
    x: pixelsPerSecond / defaultPps,
    y: trackZoom,
  };
}

export function getTimelineZoomMultiplierBounds(bounds: TimelineZoomBounds): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  const defaultPps =
    bounds.pixelsPerSecondDefault > 0
      ? bounds.pixelsPerSecondDefault
      : TIMELINE_DEFAULT_PIXELS_PER_SECOND;
  return {
    xMin: bounds.pixelsPerSecondMin / defaultPps,
    xMax: bounds.pixelsPerSecondMax / defaultPps,
    yMin: bounds.trackZoomMin,
    yMax: bounds.trackZoomMax,
  };
}

export function pixelsPerSecondFromZoomMultiplier(
  multiplier: number,
  pixelsPerSecondDefault: number,
  bounds: TimelineZoomBounds
): number {
  const defaultPps =
    pixelsPerSecondDefault > 0 ? pixelsPerSecondDefault : TIMELINE_DEFAULT_PIXELS_PER_SECOND;
  return clampTimelinePixelsPerSecond(multiplier * defaultPps, bounds);
}
