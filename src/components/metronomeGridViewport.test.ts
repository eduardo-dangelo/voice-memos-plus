import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOLLOW_BAR_PAINT_OVERSCAN_VIEWPORTS,
  getFollowBarPaintTimeRange,
  getMetronomeGridBufferRange,
  getVisibleTimeRange,
  isMetronomeGridBufferValid,
  METRONOME_GRID_BUFFER_VIEWPORTS,
  METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS,
  resolvePlaybackBarPaintRange,
  resolveRecordingBarPaintRange,
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

test('getFollowBarPaintTimeRange pads past each visible edge', () => {
  const playheadTime = 10;
  const scrollX = playheadTime * PPS;
  const visible = getVisibleTimeRange(scrollX, VIEWPORT, PPS);
  const padded = getFollowBarPaintTimeRange(scrollX, VIEWPORT, PPS);
  const padSec = (VIEWPORT / PPS) * FOLLOW_BAR_PAINT_OVERSCAN_VIEWPORTS;
  assert.ok(padded.start < visible.start);
  assert.ok(padded.end > visible.end);
  assert.ok(Math.abs(padded.start - (visible.start - padSec)) < 1e-9);
  assert.ok(Math.abs(padded.end - (visible.end + padSec)) < 1e-9);
});

test('getFollowBarPaintTimeRange clamps start at timeline origin', () => {
  const padded = getFollowBarPaintTimeRange(0, VIEWPORT, PPS);
  assert.equal(padded.start, 0);
  assert.ok(padded.end > getVisibleTimeRange(0, VIEWPORT, PPS).end);
});

test('getFollowBarPaintTimeRange overscan scales with viewport width', () => {
  const playheadTime = 20;
  const scrollX = playheadTime * PPS;
  const phone = getFollowBarPaintTimeRange(scrollX, 390, PPS);
  const ipad = getFollowBarPaintTimeRange(scrollX, 1024, PPS);
  const phonePad = phone.end - getVisibleTimeRange(scrollX, 390, PPS).end;
  const ipadPad = ipad.end - getVisibleTimeRange(scrollX, 1024, PPS).end;
  assert.ok(ipadPad > phonePad);
  assert.ok(Math.abs(ipadPad / phonePad - 1024 / 390) < 1e-9);
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

test('isMetronomeGridBufferValid is false when buffer.end exceeds duration', () => {
  const buffer = { start: 0, end: 60 };
  assert.equal(isMetronomeGridBufferValid(buffer, 0, VIEWPORT, PPS, 0.5, 40), false);
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
  const existing = getMetronomeGridBufferRange(0, VIEWPORT, PPS, 60);
  assert.equal(resolvePlaybackBarPaintRange(existing, 0, VIEWPORT, PPS, 60), existing);
});

test('resolvePlaybackBarPaintRange reseeds when duration-capped buffer no longer covers viewport', () => {
  // Seed near the old timeline end so the buffer is clamped to duration.
  const nearEndScrollX = 28 * PPS;
  const old = getMetronomeGridBufferRange(nearEndScrollX, VIEWPORT, PPS, 30);
  assert.ok(Math.abs(old.end - 30) < 1e-6);
  const next = resolvePlaybackBarPaintRange(old, nearEndScrollX, VIEWPORT, PPS, 90);
  assert.notEqual(next, old);
  assert.ok(next.end > old.end);
});

test('resolvePlaybackBarPaintRange reseeds when scroll leaves the buffer', () => {
  const old = getMetronomeGridBufferRange(0, VIEWPORT, PPS, 120);
  const farScrollX = VIEWPORT * 6;
  const next = resolvePlaybackBarPaintRange(old, farScrollX, VIEWPORT, PPS, 120);
  assert.notEqual(next, old);
  assert.ok(next.end > old.end);
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

test('shouldReseedPlaybackViewport is true when duration grows', () => {
  const buffer = getMetronomeGridBufferRange(0, VIEWPORT, PPS, 45);
  assert.equal(shouldReseedPlaybackViewport(buffer, VIEWPORT, PPS, 60, 45), true);
});

test('shouldReseedPlaybackViewport is true when duration shrinks', () => {
  const buffer = getMetronomeGridBufferRange(0, VIEWPORT, PPS, 60);
  assert.equal(shouldReseedPlaybackViewport(buffer, VIEWPORT, PPS, 40, 60), true);
});

test('shouldReseedPlaybackViewport is false when width is 0 or duration is 0', () => {
  assert.equal(shouldReseedPlaybackViewport({ start: 0, end: 0 }, 0, PPS, 45, 0), false);
  assert.equal(shouldReseedPlaybackViewport({ start: 0, end: 0 }, VIEWPORT, PPS, 0, 0), false);
});

test('shouldReseedPlaybackViewport is false for a valid buffer and stable duration', () => {
  const buffer = getMetronomeGridBufferRange(0, VIEWPORT, PPS, 45);
  assert.equal(shouldReseedPlaybackViewport(buffer, VIEWPORT, PPS, 45, 45), false);
});

test('resolveRecordingBarPaintRange seeds a wide buffer from null', () => {
  const scrollX = 10 * PPS;
  const seeded = resolveRecordingBarPaintRange(null, scrollX, VIEWPORT, PPS);
  const tight = getFollowBarPaintTimeRange(scrollX, VIEWPORT, PPS);
  assert.ok(seeded.start <= tight.start);
  assert.ok(seeded.end >= tight.end);
});

test('resolveRecordingBarPaintRange reuses buffer while playhead stays inside margin', () => {
  const startScrollX = 10 * PPS;
  const buffer = resolveRecordingBarPaintRange(null, startScrollX, VIEWPORT, PPS);
  // Small advance — still well inside a 3-viewport playback buffer.
  const near = resolveRecordingBarPaintRange(buffer, startScrollX + 20, VIEWPORT, PPS);
  assert.equal(near, buffer);
});

test('resolveRecordingBarPaintRange reseeds when playhead nears the buffer edge', () => {
  const startScrollX = 10 * PPS;
  const buffer = resolveRecordingBarPaintRange(null, startScrollX, VIEWPORT, PPS);
  // Jump far ahead so the visible window exits the validity margin.
  const farScrollX = startScrollX + VIEWPORT * 4;
  const next = resolveRecordingBarPaintRange(buffer, farScrollX, VIEWPORT, PPS);
  assert.notEqual(next, buffer);
  assert.ok(next.end > buffer.end);
});
