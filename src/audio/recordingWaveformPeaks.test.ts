import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  accumulatePeaksFromSamples,
  getBarIndexForTime,
} from './recordingWaveformPeaks';

const BAR_STEP = 3;
const WAVEFORM_PIXELS_PER_SECOND = 48;
const SAMPLE_RATE = 44100;

function barTimeSec(barIndex: number): number {
  return (barIndex * BAR_STEP) / WAVEFORM_PIXELS_PER_SECOND;
}

test('getBarIndexForTime maps timeline seconds to bar indices', () => {
  assert.equal(getBarIndexForTime(0), 0);
  assert.equal(getBarIndexForTime(barTimeSec(1)), 1);
  assert.equal(getBarIndexForTime(barTimeSec(2) - 0.001), 1);
});

test('accumulatePeaksFromSamples fills every bar covered by a buffer', () => {
  const startSec = barTimeSec(0);
  const endSec = barTimeSec(3);
  const sampleCount = Math.ceil((endSec - startSec) * SAMPLE_RATE);
  const channelData = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const t = startSec + i / SAMPLE_RATE;
    const barIndex = getBarIndexForTime(t);
    channelData[i] = barIndex === 0 ? 0.4 : barIndex === 1 ? 0.8 : 0.2;
  }

  const peaks = accumulatePeaksFromSamples(channelData, startSec, SAMPLE_RATE, []);

  assert.equal(peaks.length, 3);
  assert.ok(Math.abs(peaks[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(peaks[1] - 0.8) < 1e-6);
  assert.ok(peaks[2] >= 0.2);
});

test('accumulatePeaksFromSamples keeps max peak when callbacks overlap', () => {
  const startSec = barTimeSec(0);
  const sampleCount = Math.ceil(barTimeSec(1) * SAMPLE_RATE);
  const firstBuffer = new Float32Array(sampleCount).fill(0.3);
  const secondBuffer = new Float32Array(sampleCount).fill(0.9);

  const afterFirst = accumulatePeaksFromSamples(
    firstBuffer,
    startSec,
    SAMPLE_RATE,
    []
  );
  const afterSecond = accumulatePeaksFromSamples(
    secondBuffer,
    startSec,
    SAMPLE_RATE,
    afterFirst
  );

  assert.ok(Math.abs(afterSecond[0] - 0.9) < 1e-6);
});

test('accumulatePeaksFromSamples appends to an existing buffer', () => {
  const existing = [0.5];
  const startSec = barTimeSec(1);
  const sampleCount = Math.ceil(barTimeSec(1) * SAMPLE_RATE);
  const channelData = new Float32Array(sampleCount).fill(0.7);

  const peaks = accumulatePeaksFromSamples(
    channelData,
    startSec,
    SAMPLE_RATE,
    existing
  );

  assert.equal(peaks[0], 0.5);
  assert.ok(Math.abs(peaks[1] - 0.7) < 1e-6);
});

test('accumulatePeaksFromSamples fills both bars in a 100ms callback window', () => {
  const bufferDurationSec = 0.1;
  const sampleCount = Math.round(SAMPLE_RATE * bufferDurationSec);
  const channelData = new Float32Array(sampleCount).fill(0.6);
  const bufferEndSec = bufferDurationSec;
  const bufferStartSec = 0;

  const peaks = accumulatePeaksFromSamples(
    channelData,
    bufferStartSec,
    SAMPLE_RATE,
    []
  );

  assert.ok(peaks.length >= 2);
  assert.ok(peaks[0] > 0);
  assert.ok(peaks[1] > 0);
});

test('accumulatePeaksFromSamples returns existing peaks for empty input', () => {
  const existing = [0.2, 0.4];
  const peaks = accumulatePeaksFromSamples(new Float32Array(0), 0, SAMPLE_RATE, existing);

  assert.deepEqual(peaks, existing);
});
