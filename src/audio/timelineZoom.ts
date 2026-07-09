export const TIMELINE_DEFAULT_PIXELS_PER_SECOND = 48;
export const TIMELINE_MIN_PIXELS_PER_SECOND = 8;
export const TIMELINE_MAX_PIXELS_PER_SECOND = 384;
export const TIMELINE_VISIBLE_SECONDS_AT_MAX_ZOOM = 4;

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
  const pixelsPerSecondMin =
    viewportWidth > 0 && duration > 0
      ? Math.max(TIMELINE_MIN_PIXELS_PER_SECOND, viewportWidth / duration)
      : TIMELINE_MIN_PIXELS_PER_SECOND;
  const pixelsPerSecondMax =
    viewportWidth > 0
      ? Math.min(
          TIMELINE_MAX_PIXELS_PER_SECOND,
          viewportWidth / TIMELINE_VISIBLE_SECONDS_AT_MAX_ZOOM
        )
      : TIMELINE_MAX_PIXELS_PER_SECOND;
  const pixelsPerSecondDefault = Math.max(
    TIMELINE_DEFAULT_PIXELS_PER_SECOND,
    pixelsPerSecondMin
  );

  return {
    pixelsPerSecondMin,
    pixelsPerSecondMax: Math.max(pixelsPerSecondMin, pixelsPerSecondMax),
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

export const TIMELINE_FULL_ZOOM_SPAN_PX = 120;

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
