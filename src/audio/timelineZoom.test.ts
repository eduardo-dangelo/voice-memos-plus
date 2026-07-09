import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPinchDeltaToPixelsPerSecond,
  applyPinchDeltaToTrackZoom,
  clampTimelinePixelsPerSecond,
  clampTimelineTrackZoom,
  getTimelineZoomBounds,
  TIMELINE_FULL_ZOOM_SPAN_PX,
  TIMELINE_MIN_PIXELS_PER_SECOND,
  TIMELINE_DEFAULT_PIXELS_PER_SECOND,
} from './timelineZoom';

test('getTimelineZoomBounds fits full recording at min zoom', () => {
  const bounds = getTimelineZoomBounds(400, 20, 3);
  assert.equal(bounds.pixelsPerSecondMin, 20);
  assert.equal(bounds.trackZoomMax, 3);
  assert.equal(bounds.pixelsPerSecondDefault, TIMELINE_DEFAULT_PIXELS_PER_SECOND);
});

test('getTimelineZoomBounds clamps very long recordings', () => {
  const bounds = getTimelineZoomBounds(400, 3600, 1);
  assert.equal(bounds.pixelsPerSecondMin, TIMELINE_MIN_PIXELS_PER_SECOND);
});

test('clampTimelinePixelsPerSecond respects bounds', () => {
  const bounds = getTimelineZoomBounds(400, 20, 2);
  assert.equal(clampTimelinePixelsPerSecond(1, bounds), bounds.pixelsPerSecondMin);
  assert.equal(clampTimelineTrackZoom(5, bounds), 2);
});

test('applyPinchDeltaToPixelsPerSecond reaches max on full spread', () => {
  const bounds = getTimelineZoomBounds(400, 20, 2);
  const result = applyPinchDeltaToPixelsPerSecond(
    bounds.pixelsPerSecondMin,
    100,
    100 + TIMELINE_FULL_ZOOM_SPAN_PX,
    bounds
  );
  assert.equal(result, bounds.pixelsPerSecondMax);
});

test('applyPinchDeltaToPixelsPerSecond reaches min on full pinch', () => {
  const bounds = getTimelineZoomBounds(400, 20, 2);
  const result = applyPinchDeltaToPixelsPerSecond(
    bounds.pixelsPerSecondMax,
    200,
    200 - TIMELINE_FULL_ZOOM_SPAN_PX,
    bounds
  );
  assert.equal(result, bounds.pixelsPerSecondMin);
});

test('applyPinchDeltaToPixelsPerSecond interpolates partial delta', () => {
  const bounds = getTimelineZoomBounds(400, 20, 2);
  const mid = (bounds.pixelsPerSecondMin + bounds.pixelsPerSecondMax) / 2;
  const result = applyPinchDeltaToPixelsPerSecond(
    bounds.pixelsPerSecondMin,
    100,
    100 + TIMELINE_FULL_ZOOM_SPAN_PX / 2,
    bounds
  );
  assert.equal(result, mid);
});

test('applyPinchDeltaToTrackZoom reaches max on full spread', () => {
  const bounds = getTimelineZoomBounds(400, 20, 4);
  const result = applyPinchDeltaToTrackZoom(1, 100, 100 + TIMELINE_FULL_ZOOM_SPAN_PX, bounds);
  assert.equal(result, 4);
});

test('applyPinchDeltaToTrackZoom reaches min on full pinch', () => {
  const bounds = getTimelineZoomBounds(400, 20, 4);
  const result = applyPinchDeltaToTrackZoom(4, 200, 200 - TIMELINE_FULL_ZOOM_SPAN_PX, bounds);
  assert.equal(result, 1);
});
