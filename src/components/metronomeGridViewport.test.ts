import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getMetronomeGridBufferRange,
  getVisibleTimeRange,
  isMetronomeGridBufferValid,
  METRONOME_GRID_BUFFER_VIEWPORTS,
  METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS,
  resolvePlaybackBarPaintRange,
  shouldReseedPlaybackViewport,
} from './metronomeGridViewport';
import { getVisibleMarkerSeconds } from './waveformViewport';

const PPS = 48;
const VIEWPORT = 390;

test('getVisibleTimeRange centers the playhead in the viewport', () => {
  const playheadTime = 10;
  const scrollX = playheadTime * PPS;
  const visible = getVisibleTimeRange(scrollX, VIEWPORT, PPS);
  const half = VIEWPORT / PPS / 2;
  assert.ok(Math.abs(visible.start - (playheadTime - half)) < 1e-9);
  assert.ok(Math.abs(visible.end - (playheadTime + half)) < 1e-9);
});

test('getVisibleTimeRange clamps start at timeline origin', () => {
  const visible = getVisibleTimeRange(0, VIEWPORT, PPS);
  assert.equal(visible.start, 0);
  assert.ok(visible.end > 0);
});

test('isMetronomeGridBufferValid stays true near timeline end', () => {
  const duration = 82;
  const playheadTime = duration;
  const scrollX = playheadTime * PPS;
  const buffer = getMetronomeGridBufferRange(
    scrollX,
    VIEWPORT,
    PPS,
    duration,
    METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS
  );
  assert.equal(buffer.end, duration);
  assert.equal(
    isMetronomeGridBufferValid(
      buffer,
      scrollX,
      VIEWPORT,
      PPS,
      1.5,
      duration
    ),
    true
  );
});

test('isMetronomeGridBufferValid is false when scrolled outside overscan', () => {
  const duration = 120;
  const buffer = getMetronomeGridBufferRange(
    10 * PPS,
    VIEWPORT,
    PPS,
    duration,
    METRONOME_GRID_BUFFER_VIEWPORTS
  );
  const farScrollX = 80 * PPS;
  assert.equal(
    isMetronomeGridBufferValid(buffer, farScrollX, VIEWPORT, PPS, 0.5, duration),
    false
  );
});

test('getVisibleMarkerSeconds respects interval', () => {
  assert.deepEqual(getVisibleMarkerSeconds(0, 10, 60, 5), [0, 5, 10]);
});

test('getMetronomeGridBufferRange never inverts when scroll implies playhead past duration', () => {
  const duration = 150;
  // Mimic mid-zoom stale pairing: scroll sized for a higher pps, read with a lower pps
  // so playheadTime is overestimated past the timeline end.
  const scrollForNewZoom = 100 * 96; // time 100s at 96 pps
  const stalePps = 48;
  const buffer = getMetronomeGridBufferRange(
    scrollForNewZoom,
    VIEWPORT,
    stalePps,
    duration,
    METRONOME_GRID_BUFFER_VIEWPORTS
  );
  assert.ok(buffer.end >= buffer.start);
  assert.ok(buffer.start <= duration);
  assert.ok(buffer.end <= duration);
});

test('getMetronomeGridBufferRange keeps end >= start at timeline end', () => {
  const duration = 82;
  const scrollX = duration * PPS;
  const buffer = getMetronomeGridBufferRange(
    scrollX,
    VIEWPORT,
    PPS,
    duration,
    METRONOME_GRID_BUFFER_VIEWPORTS
  );
  assert.ok(buffer.end >= buffer.start);
  assert.equal(buffer.end, duration);
});

test('resolvePlaybackBarPaintRange seeds a bounded window from {0,0} when layout is valid', () => {
  const range = resolvePlaybackBarPaintRange({ start: 0, end: 0 }, 0, VIEWPORT, PPS, 60);
  assert.ok(range.end > range.start);
  assert.deepEqual(range, getMetronomeGridBufferRange(0, VIEWPORT, PPS, 60));
  assert.ok(range.end - range.start < 60);
});

test('resolvePlaybackBarPaintRange keeps {0,0} when width or duration is invalid', () => {
  assert.deepEqual(resolvePlaybackBarPaintRange({ start: 0, end: 0 }, 0, 0, PPS, 60), {
    start: 0,
    end: 0,
  });
  assert.deepEqual(resolvePlaybackBarPaintRange({ start: 0, end: 0 }, 0, VIEWPORT, PPS, 0), {
    start: 0,
    end: 0,
  });
});

test('resolvePlaybackBarPaintRange keeps an already-valid buffer', () => {
  const existing = { start: 1, end: 8 };
  assert.equal(resolvePlaybackBarPaintRange(existing, 0, VIEWPORT, PPS, 60), existing);
});

test('shouldReseedPlaybackViewport is true for an uninitialized buffer once layout is valid', () => {
  assert.equal(shouldReseedPlaybackViewport({ start: 0, end: 0 }, VIEWPORT, PPS, 45, 0), true);
  assert.equal(shouldReseedPlaybackViewport(null, VIEWPORT, PPS, 45, 0), true);
});

test('shouldReseedPlaybackViewport is true when duration catches up from a placeholder', () => {
  assert.equal(
    shouldReseedPlaybackViewport({ start: 0, end: 0.01 }, VIEWPORT, PPS, 45, 0.01),
    true
  );
});

test('shouldReseedPlaybackViewport is false when width is 0 or duration is 0', () => {
  assert.equal(shouldReseedPlaybackViewport({ start: 0, end: 0 }, 0, PPS, 45, 0), false);
  assert.equal(shouldReseedPlaybackViewport({ start: 0, end: 0 }, VIEWPORT, PPS, 0, 0), false);
});

test('shouldReseedPlaybackViewport is false for a valid buffer and stable duration', () => {
  const buffer = getMetronomeGridBufferRange(0, VIEWPORT, PPS, 45);
  assert.equal(shouldReseedPlaybackViewport(buffer, VIEWPORT, PPS, 45, 45), false);
});
