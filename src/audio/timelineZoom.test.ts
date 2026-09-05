import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPinchDeltaToPixelsPerSecond,
  applyPinchDeltaToTrackZoom,
  clampTimelinePixelsPerSecond,
  clampTimelineTrackZoom,
  formatTimelineZoomMultiplier,
  getInitialTimelinePixelsPerSecond,
  getTimelineZoomBounds,
  getTimelineZoomDisplayMultipliers,
  getTimelineZoomMultiplierBounds,
  pixelsPerSecondFromZoomMultiplier,
  TIMELINE_FULL_ZOOM_SPAN_PX,
  TIMELINE_MIN_PIXELS_PER_SECOND,
  TIMELINE_DEFAULT_PIXELS_PER_SECOND,
  TIMELINE_MAX_PIXELS_PER_SECOND,
  TIMELINE_REGULAR_INITIAL_ZOOM_MULTIPLIER,
  TIMELINE_VISIBLE_SECONDS_AT_MAX_ZOOM,
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
  assert.ok(bounds.pixelsPerSecondMax <= TIMELINE_MAX_PIXELS_PER_SECOND);
  assert.ok(bounds.pixelsPerSecondDefault <= bounds.pixelsPerSecondMax);
  // Must not lock live recording zoom to viewport/0.01 (~39300).
  assert.equal(bounds.pixelsPerSecondMin, TIMELINE_MIN_PIXELS_PER_SECOND);
  assert.equal(bounds.pixelsPerSecondDefault, TIMELINE_DEFAULT_PIXELS_PER_SECOND);
});

test('getTimelineZoomBounds keeps design default on wide iPad placeholder', () => {
  // Armed / empty memo on iPad landscape — must not freeze record at ~viewport/4.
  const bounds = getTimelineZoomBounds(1200, 0.01, 1);
  assert.equal(bounds.pixelsPerSecondMin, TIMELINE_MIN_PIXELS_PER_SECOND);
  assert.equal(bounds.pixelsPerSecondDefault, TIMELINE_DEFAULT_PIXELS_PER_SECOND);
  assert.ok(bounds.pixelsPerSecondMin <= bounds.pixelsPerSecondMax);
});

test('getTimelineZoomBounds does not force short clips to fill wide viewport', () => {
  // Intentional: short clips at 1× leave empty side space rather than raising
  // pps above capture density (which upsamples / stretches design-density peaks).
  const bounds = getTimelineZoomBounds(1200, 5, 1);
  assert.equal(bounds.pixelsPerSecondMin, TIMELINE_MIN_PIXELS_PER_SECOND);
  assert.equal(bounds.pixelsPerSecondDefault, TIMELINE_DEFAULT_PIXELS_PER_SECOND);
});

test('getTimelineZoomBounds keeps min <= default on normal viewports', () => {
  for (const [width, duration] of [
    [393, 0.01],
    [1200, 0.01],
    [1200, 5],
    [400, 20],
    [400, 3600],
    [1180, 60],
  ] as const) {
    const bounds = getTimelineZoomBounds(width, duration, 1);
    assert.ok(
      bounds.pixelsPerSecondMax >= TIMELINE_DEFAULT_PIXELS_PER_SECOND,
      `expected max >= default at ${width}x${duration}`
    );
    assert.ok(
      bounds.pixelsPerSecondMin <= TIMELINE_DEFAULT_PIXELS_PER_SECOND,
      `expected min <= default at ${width}x${duration}`
    );
    assert.equal(
      bounds.pixelsPerSecondDefault,
      TIMELINE_DEFAULT_PIXELS_PER_SECOND,
      `1× baseline must stay design density at ${width}x${duration}`
    );
  }
});

test('getTimelineZoomBounds clamps default to max on tiny viewports', () => {
  // max = min(384, 48/1.2) = 40 < DEFAULT — default must not exceed max.
  const bounds = getTimelineZoomBounds(48, 5, 1);
  const expectedMax = 48 / TIMELINE_VISIBLE_SECONDS_AT_MAX_ZOOM;
  assert.equal(bounds.pixelsPerSecondMax, expectedMax);
  assert.equal(bounds.pixelsPerSecondDefault, expectedMax);
  assert.ok(bounds.pixelsPerSecondDefault <= bounds.pixelsPerSecondMax);
});

test('getInitialTimelinePixelsPerSecond uses 0.5× on regular width', () => {
  const bounds = getTimelineZoomBounds(1200, 60, 1);
  assert.equal(bounds.pixelsPerSecondDefault, TIMELINE_DEFAULT_PIXELS_PER_SECOND);
  assert.equal(
    getInitialTimelinePixelsPerSecond(bounds, true),
    TIMELINE_DEFAULT_PIXELS_PER_SECOND * TIMELINE_REGULAR_INITIAL_ZOOM_MULTIPLIER
  );
});

test('getInitialTimelinePixelsPerSecond uses 1× on compact width', () => {
  const bounds = getTimelineZoomBounds(393, 60, 1);
  assert.equal(getInitialTimelinePixelsPerSecond(bounds, false), bounds.pixelsPerSecondDefault);
});

test('getInitialTimelinePixelsPerSecond clamps into bounds', () => {
  const bounds = getTimelineZoomBounds(400, 20, 1);
  // Force a case where 0.5× default would be below min if min were raised.
  const raisedMin = {
    ...bounds,
    pixelsPerSecondMin: bounds.pixelsPerSecondDefault * 0.75,
  };
  const initial = getInitialTimelinePixelsPerSecond(raisedMin, true);
  assert.equal(initial, raisedMin.pixelsPerSecondMin);
  assert.ok(initial >= raisedMin.pixelsPerSecondMin);
  assert.ok(initial <= raisedMin.pixelsPerSecondMax);
});

test('getTimelineZoomBounds lets a phone viewport reach 1/32 grid zoom', () => {
  const bounds = getTimelineZoomBounds(393, 20, 1);
  assert.ok(bounds.pixelsPerSecondMax >= 320);
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

test('getTimelineZoomMultiplierBounds converts pps limits to multipliers', () => {
  const bounds = getTimelineZoomBounds(400, 20, 3);
  const multipliers = getTimelineZoomMultiplierBounds(bounds);
  assert.equal(multipliers.xMin, bounds.pixelsPerSecondMin / bounds.pixelsPerSecondDefault);
  assert.equal(multipliers.xMax, bounds.pixelsPerSecondMax / bounds.pixelsPerSecondDefault);
  assert.equal(multipliers.yMin, 1);
  assert.equal(multipliers.yMax, 3);
});

test('pixelsPerSecondFromZoomMultiplier converts and clamps', () => {
  const bounds = getTimelineZoomBounds(400, 20, 2);
  assert.equal(
    pixelsPerSecondFromZoomMultiplier(2, bounds.pixelsPerSecondDefault, bounds),
    clampTimelinePixelsPerSecond(bounds.pixelsPerSecondDefault * 2, bounds)
  );
  assert.equal(
    pixelsPerSecondFromZoomMultiplier(0.01, bounds.pixelsPerSecondDefault, bounds),
    bounds.pixelsPerSecondMin
  );
});
