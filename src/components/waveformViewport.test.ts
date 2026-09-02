import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendWaveformBarRect,
  getVisibleBarIndexRange,
  getVisibleMarkerSeconds,
  waveformBarHeightPx,
} from './waveformViewport';

const PPS = 48;
const BAR_STEP = 3;

test('getVisibleBarIndexRange returns empty range for zero bar count', () => {
  assert.deepEqual(getVisibleBarIndexRange(0, 5, 0, 0, PPS, BAR_STEP), {
    startIndex: 0,
    endIndex: 0,
  });
});

test('getVisibleBarIndexRange windows bars to the visible time range', () => {
  const barCount = 160;
  const range = getVisibleBarIndexRange(2, 4, 0, barCount, PPS, BAR_STEP);
  assert.equal(range.startIndex, Math.floor((2 * PPS) / BAR_STEP));
  assert.equal(range.endIndex, Math.ceil((4 * PPS) / BAR_STEP));
  assert.ok(range.endIndex - range.startIndex < barCount);
});

test('getVisibleBarIndexRange accounts for track start offset', () => {
  const range = getVisibleBarIndexRange(5, 7, 5, 100, PPS, BAR_STEP);
  assert.equal(range.startIndex, 0);
  assert.equal(range.endIndex, Math.ceil((2 * PPS) / BAR_STEP));
});

test('getVisibleBarIndexRange clamps to bar count', () => {
  const range = getVisibleBarIndexRange(0, 100, 0, 10, PPS, BAR_STEP);
  assert.equal(range.startIndex, 0);
  assert.equal(range.endIndex, 10);
});

test('getVisibleMarkerSeconds returns markers only inside the buffer', () => {
  assert.deepEqual(getVisibleMarkerSeconds(3.2, 6.8, 60), [3, 4, 5, 6, 7]);
});

test('getVisibleMarkerSeconds clamps to layout duration', () => {
  assert.deepEqual(getVisibleMarkerSeconds(0, 100, 5), [0, 1, 2, 3, 4, 5]);
});

test('getVisibleMarkerSeconds returns empty for invalid ranges', () => {
  assert.deepEqual(getVisibleMarkerSeconds(5, 4, 10), []);
  assert.deepEqual(getVisibleMarkerSeconds(0, 5, 0), []);
});

test('getVisibleMarkerSeconds steps by interval', () => {
  assert.deepEqual(getVisibleMarkerSeconds(0, 12, 60, 5), [0, 5, 10]);
});

test('appendWaveformBarRect writes a closed rect subpath', () => {
  assert.equal(appendWaveformBarRect('', 3, 4, 2, 10), 'M3 4h2v10h-2z');
  assert.equal(
    appendWaveformBarRect('M0 0h1v1h-1z', 3, 4, 2, 10),
    'M0 0h1v1h-1zM3 4h2v10h-2z'
  );
});

test('waveformBarHeightPx maps silence to a 2px stub and peaks into the body', () => {
  assert.equal(waveformBarHeightPx(0, 40), 2);
  assert.equal(waveformBarHeightPx(1, 40), 32);
});
