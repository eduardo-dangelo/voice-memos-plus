import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizePeaksForBarCount,
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

test('normalizePeaksForBarCount downsamples the full take, not a prefix slice', () => {
  // Late peaks are loud; a prefix slice would miss them and look cropped on zoom-out.
  const peaks = Array.from({ length: 480 }, (_, i) => (i >= 400 ? 0.95 : 0.1));
  const normalized = normalizePeaksForBarCount(peaks, 80);

  assert.equal(normalized.length, 80);
  assert.notDeepEqual(normalized, peaks.slice(0, 80));
  assert.ok(normalized[normalized.length - 1]! >= 0.95);
  assert.ok(normalized.every((peak) => peak >= 0.1));
});

test('normalizePeaksForBarCount upsamples when zoomed in past stored density', () => {
  const peaks = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0.4 : 0.8));
  const normalized = normalizePeaksForBarCount(peaks, 96);

  assert.equal(normalized.length, 96);
  assert.equal(normalized[0], 0.4);
  assert.equal(normalized[3], 0.8);
});

test('normalizePeaksForBarCount returns empty for non-positive barCount', () => {
  assert.deepEqual(normalizePeaksForBarCount([0.5, 0.6], 0), []);
  assert.deepEqual(normalizePeaksForBarCount([0.5, 0.6], -1), []);
});
