import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPTURED_PEAKS_MIN_DENSITY,
  computeWaveformPeaksFromChannelData,
  loopPeakIndex,
  normalizePeakAt,
  normalizePeaksForBarCount,
  peakCountForDuration,
  peakToAbsoluteScale,
  resamplePeakAt,
  resamplePeaks,
  shouldUseCapturedPeaks,
  slicePeaksForTrim,
  WAVEFORM_BAR_GAP,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_PIXELS_PER_SECOND,
} from './waveform';

const BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;

/** Mirrors resolveWaveformPeaks when capturedPeaks pass the density guard. */
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

test('resamplePeakAt matches resamplePeaks for downsample and upsample', () => {
  const downPeaks = Array.from({ length: 480 }, (_, i) => (i >= 400 ? 0.95 : 0.1));
  const downFull = resamplePeaks(downPeaks, 80);
  for (let i = 0; i < downFull.length; i++) {
    assert.equal(resamplePeakAt(downPeaks, 80, i), downFull[i]);
  }
  assert.ok(resamplePeakAt(downPeaks, 80, 79)! >= 0.95);

  const upPeaks = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0.4 : 0.8));
  const upFull = resamplePeaks(upPeaks, 96);
  for (let i = 0; i < upFull.length; i++) {
    assert.equal(resamplePeakAt(upPeaks, 96, i), upFull[i]);
  }
  assert.equal(resamplePeakAt(upPeaks, 96, 0), 0.4);
  assert.equal(resamplePeakAt(upPeaks, 96, 3), 0.8);
});

test('normalizePeakAt matches normalizePeaksForBarCount without allocating the full array', () => {
  const peaks = Array.from({ length: 480 }, (_, i) => (i >= 400 ? 0.95 : 0.1));
  const full = normalizePeaksForBarCount(peaks, 80);
  for (let i = 0; i < full.length; i++) {
    assert.equal(normalizePeakAt(peaks, 80, i), full[i]);
  }
  assert.equal(normalizePeakAt(undefined, 80, 0), 0.05);
  assert.equal(normalizePeakAt(peaks, 0, 0), 0);
});

test('shouldUseCapturedPeaks rejects replace-segment density on a long layer', () => {
  // 2s live replace (~32 bars) into a 30s layer (~480 bars) must not be trusted.
  const segmentPeaks = Array.from({ length: 32 }, () => 0.5);
  assert.equal(shouldUseCapturedPeaks(segmentPeaks, 30), false);
  assert.ok(32 < peakCountForDuration(30) * CAPTURED_PEAKS_MIN_DENSITY);
});

test('shouldUseCapturedPeaks accepts full-file live peaks and mild duration skew', () => {
  const full = Array.from({ length: 480 }, () => 0.4);
  assert.equal(shouldUseCapturedPeaks(full, 30), true);

  // Recorder duration slightly shorter than decoded file duration.
  const slightlyShort = Array.from({ length: 460 }, () => 0.4);
  assert.equal(shouldUseCapturedPeaks(slightlyShort, 30), true);

  assert.equal(shouldUseCapturedPeaks(undefined, 30), false);
  assert.equal(shouldUseCapturedPeaks([], 30), false);
  assert.equal(shouldUseCapturedPeaks([0.5, 0.6]), true);
});

test('slicePeaksForTrim uses design-density bar time for latency trimIn', () => {
  const duration = 13;
  const peaks = Array.from({ length: peakCountForDuration(duration) }, (_, i) =>
    i < 3 ? 0.01 : i === 8 ? 0.95 : 0.2
  );
  const trimIn = 0.17; // wake+wired cue — getRecordingReplacementSkipSeconds(true, 'wired')
  const sliced = slicePeaksForTrim(peaks, duration, trimIn, duration);
  assert.ok(sliced);
  // 0.17s → round(0.17*48/3) = 3 bars, not proportional floor → 2.
  assert.equal(sliced!.length, peaks.length - 3);
  assert.equal(sliced![0], 0.2);
  assert.equal(sliced![5], 0.95);
});

test('slicePeaksForTrim returns the same array when trim spans the full take', () => {
  const duration = 30;
  const peaks = Array.from({ length: peakCountForDuration(duration) }, () => 0.4);
  const sliced = slicePeaksForTrim(peaks, duration, 0, duration);
  assert.equal(sliced, peaks);
});

test('computeWaveformPeaksFromChannelData matches peakCount and finds loud samples', () => {
  const peakCount = 4;
  const samplesPerPeak = 10;
  const channelData = new Float32Array(peakCount * samplesPerPeak);
  channelData[5] = 0.8;
  channelData[25] = -0.6;

  const peaks = computeWaveformPeaksFromChannelData(channelData, peakCount);
  assert.equal(peaks.length, peakCount);
  assert.ok(Math.abs(peaks[0]! - 0.8) < 1e-6);
  assert.equal(peaks[1], 0);
  assert.ok(Math.abs(peaks[2]! - 0.6) < 1e-6);
  assert.equal(peaks[3], 0);
});

test('loopPeakIndex avoids phase drift on non-integer barsPerCycle', () => {
  // List-row density example: ~14.625 bars/cycle → floor = 14.
  const barsPerCycle = 14.625;
  const cycleBarCount = Math.floor(barsPerCycle);

  let mismatches = 0;
  for (let i = 0; i < 45; i += 1) {
    const phasePos = ((i % barsPerCycle) + barsPerCycle) % barsPerCycle;
    const expected = Math.min(
      cycleBarCount - 1,
      Math.floor((phasePos / barsPerCycle) * cycleBarCount)
    );
    assert.equal(loopPeakIndex(i, barsPerCycle, cycleBarCount), expected);
    if (i % cycleBarCount !== expected) {
      mismatches += 1;
    }
  }
  // Integer modulo drifts once barsPerCycle is non-integer.
  assert.ok(mismatches > 0);

  // Each cycle restart maps near peak 0 (not a drifted mid-cycle index).
  assert.equal(loopPeakIndex(0, barsPerCycle, cycleBarCount), 0);
  assert.equal(loopPeakIndex(15, barsPerCycle, cycleBarCount), 0);
  assert.equal(loopPeakIndex(30, barsPerCycle, cycleBarCount), 0);
});

test('loopPeakIndex handles edge cases', () => {
  assert.equal(loopPeakIndex(5, 14.625, 0), 0);
  assert.equal(loopPeakIndex(5, 0, 14), 5);
  assert.equal(loopPeakIndex(20, 0, 14), 13);
});
