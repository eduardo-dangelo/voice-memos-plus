import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  peakCountForDuration,
  peakToAbsoluteScale,
  resamplePeaks,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_PIXELS_PER_SECOND,
} from './waveform';

const BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;

/** Mirrors resolveWaveformPeaks when capturedPeaks are present. */
function resolveCapturedPeaks(duration: number, capturedPeaks: number[]): number[] {
  return resamplePeaks(
    capturedPeaks.map(peakToAbsoluteScale),
    peakCountForDuration(duration)
  );
}

test('peakCountForDuration matches design density without a 150 floor', () => {
  assert.equal(peakCountForDuration(2), Math.floor((2 * WAVEFORM_PIXELS_PER_SECOND) / BAR_STEP));
  assert.equal(peakCountForDuration(2), 32);
  assert.equal(peakCountForDuration(30), 480);
  assert.equal(peakCountForDuration(0), 1);
});

test('short captured peaks stay at design density instead of upsampling to 150', () => {
  const duration = 2;
  const captured = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0.4 : 0.8));
  const peaks = resolveCapturedPeaks(duration, captured);

  assert.equal(peaks.length, 32);
  assert.notEqual(peaks.length, 150);
});

test('long captured peaks stay at design density instead of collapsing to 150', () => {
  const duration = 30;
  const captured = Array.from({ length: 480 }, (_, i) => (i % 3 === 0 ? 0.9 : 0.2));
  const peaks = resolveCapturedPeaks(duration, captured);

  assert.equal(peaks.length, 480);
  assert.notEqual(peaks.length, 150);
});
