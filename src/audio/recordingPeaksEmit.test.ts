import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendAbsoluteRecordingPeaks } from './recordingPeaksEmit';
import { peakToAbsoluteScale } from './waveform';

test('appendAbsoluteRecordingPeaks returns same reference when count is unchanged', () => {
  const previous = [0.1, 0.2, 0.3];
  const raw = [0.1, 0.2, 0.3, 0.9];
  const next = appendAbsoluteRecordingPeaks(raw, 3, previous, 3);
  assert.equal(next.peaks, previous);
  assert.equal(next.count, 3);
});

test('appendAbsoluteRecordingPeaks appends newly scaled bars', () => {
  const previous = [0.1, 0.2];
  const raw = [0.1, 0.2, 0.5, 0.8];
  const next = appendAbsoluteRecordingPeaks(raw, 4, previous, 2, 0);
  assert.notEqual(next.peaks, previous);
  assert.deepEqual(next.peaks, [
    0.1,
    0.2,
    peakToAbsoluteScale(0.5),
    peakToAbsoluteScale(0.8),
  ]);
  assert.equal(next.count, 4);
});

test('appendAbsoluteRecordingPeaks refreshes trailing window for overlap max', () => {
  const previous = [0.1, 0.2, 0.3];
  const raw = [0.1, 0.9, 0.95, 0.4];
  const next = appendAbsoluteRecordingPeaks(raw, 4, previous, 3, 2);
  assert.equal(next.peaks[0], 0.1);
  assert.equal(next.peaks[1], peakToAbsoluteScale(0.9));
  assert.equal(next.peaks[2], peakToAbsoluteScale(0.95));
  assert.equal(next.peaks[3], peakToAbsoluteScale(0.4));
});

test('appendAbsoluteRecordingPeaks remaps when shrinking', () => {
  const previous = [0.1, 0.2, 0.3, 0.4];
  const raw = [0.5, 0.6];
  const next = appendAbsoluteRecordingPeaks(raw, 2, previous, 4);
  assert.deepEqual(next.peaks, [peakToAbsoluteScale(0.5), peakToAbsoluteScale(0.6)]);
  assert.equal(next.count, 2);
});
