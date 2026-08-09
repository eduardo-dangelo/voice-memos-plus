import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPinchDeltaToPixelsPerSecond,
  applyPinchDeltaToTrackZoom,
  clampTimelinePixelsPerSecond,
  clampTimelineTrackZoom,
  formatTimelineZoomMultiplier,
  getTimelineZoomBounds,
  getTimelineZoomDisplayMultipliers,
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

test('getTimelineZoomBounds does not inflate min for tiny placeholder durations', () => {
  const bounds = getTimelineZoomBounds(393, 0.01, 1);
  assert.ok(bounds.pixelsPerSecondMin <= bounds.pixelsPerSecondMax);
  assert.ok(bounds.pixelsPerSecondMax <= 384);
  assert.ok(bounds.pixelsPerSecondDefault <= bounds.pixelsPerSecondMax);
  // Must not lock live recording zoom to viewport/0.01 (~39300).
  assert.ok(bounds.pixelsPerSecondMin < 1000);
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

test('formatTimelineZoomMultiplier trims whole numbers and keeps one decimal', () => {
  assert.equal(formatTimelineZoomMultiplier(1), '1×');
  assert.equal(formatTimelineZoomMultiplier(2), '2×');
  assert.equal(formatTimelineZoomMultiplier(1.5), '1.5×');
  assert.equal(formatTimelineZoomMultiplier(1.54), '1.5×');
  assert.equal(formatTimelineZoomMultiplier(1.56), '1.6×');
});

test('getTimelineZoomDisplayMultipliers uses default pps for x and trackZoom for y', () => {
  const multipliers = getTimelineZoomDisplayMultipliers(96, 2.5, 48);
  assert.equal(multipliers.x, 2);
  assert.equal(multipliers.y, 2.5);
});
