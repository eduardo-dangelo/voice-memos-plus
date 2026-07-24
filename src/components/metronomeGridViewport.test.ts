import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getMetronomeGridBufferRange,
  getVisibleTimeRange,
  isMetronomeGridBufferValid,
  METRONOME_GRID_BUFFER_VIEWPORTS,
  METRONOME_GRID_PLAYBACK_BUFFER_VIEWPORTS,
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
