import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applySpliceEdgeFades,
  SPLICE_EDGE_FADE_SECONDS,
} from '@/src/audio/spliceEdgeFades';
import {
  computeWaveformPeaksFromChannelData,
  peakCountForDuration,
} from '@/src/audio/waveform';
import type { Layer } from './types';
import {
  getReplaceSpliceParams,
  MIN_REPLACE_EFFECTIVE_DURATION_SEC,
} from './types';

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-1',
    order: 0,
    fileName: 'track.wav',
    label: 'Track 1',
    startTime: 0,
    duration: 12,
    effects: { trimIn: 0, trimOut: 10 },
    ...overrides,
  };
}

describe('getReplaceSpliceParams', () => {
  it('maps in-track timeline start to file offsets', () => {
    const layer = makeLayer();
    const result = getReplaceSpliceParams(layer, 5, 2);
    assert.deepEqual(result, {
      trimStart: 5,
      trimEnd: 7,
      leadingPadSeconds: 0,
      startTimeDelta: 0,
    });
  });

  it('shortens the hole by replacementSkipSeconds', () => {
    const layer = makeLayer();
    const skip = 0.12;
    const recordingDuration = 2;
    const result = getReplaceSpliceParams(layer, 5, recordingDuration, skip);
    assert.equal(result.trimStart, 5);
    assert.equal(result.trimEnd, 5 + (recordingDuration - skip));
    assert.equal(result.leadingPadSeconds, 0);
    assert.equal(result.startTimeDelta, 0);
    assert.equal(result.trimEnd - result.trimStart, recordingDuration - skip);
  });

  it('clamps skip-shortened hole to trimOut', () => {
    const layer = makeLayer();
    // Start near end: 9 + (2 - 0.12) would be 10.88 → clamp to trimOut 10
    const result = getReplaceSpliceParams(layer, 9, 2, 0.12);
    assert.equal(result.trimStart, 9);
    assert.equal(result.trimEnd, 10);
    assert.equal(result.startTimeDelta, 0);
  });

  it('inserts at active end with leading silence when playhead is past track', () => {
    const layer = makeLayer();
    const result = getReplaceSpliceParams(layer, 12, 2, 0.12);
    assert.deepEqual(result, {
      trimStart: 10,
      trimEnd: 10,
      leadingPadSeconds: 2,
      startTimeDelta: 0,
    });
  });

  it('respects trimIn when layer starts later on the timeline', () => {
    const layer = makeLayer({
      startTime: 2,
      duration: 15,
      effects: { trimIn: 1, trimOut: 9 },
    });
    // activeStart = 3; at timeline 7 → file offset = trimIn + 4 = 5
    const result = getReplaceSpliceParams(layer, 7, 1.5);
    assert.deepEqual(result, {
      trimStart: 5,
      trimEnd: 6.5,
      leadingPadSeconds: 0,
      startTimeDelta: 0,
    });
  });

  it('maps timeline 0 to trimIn for latency-folded layers', () => {
    const layer = makeLayer({
      startTime: -0.12,
      duration: 8,
      effects: { trimIn: 0.12, trimOut: 8 },
    });
    const result = getReplaceSpliceParams(layer, 0, 2);
    assert.deepEqual(result, {
      trimStart: 0.12,
      trimEnd: 2.12,
      leadingPadSeconds: 0,
      startTimeDelta: 0,
    });
  });

  it('extends left when playhead is before late-start track', () => {
    const layer = makeLayer({
      startTime: 5,
      duration: 12,
      effects: { trimIn: 0, trimOut: 10 },
    });
    // preGap 5; record 8 → hole 3 at trimIn; shift start left by 5
    const result = getReplaceSpliceParams(layer, 0, 8);
    assert.deepEqual(result, {
      trimStart: 0,
      trimEnd: 3,
      leadingPadSeconds: 0,
      startTimeDelta: -5,
    });
  });

  it('punches at trimIn when playhead is before activeStart with trimIn', () => {
    const layer = makeLayer({
      startTime: 2,
      duration: 15,
      effects: { trimIn: 1, trimOut: 9 },
    });
    // activeStart = 3; playhead 1 → preGap 2; record 5 → hole 3 from trimIn
    const result = getReplaceSpliceParams(layer, 1, 5);
    assert.deepEqual(result, {
      trimStart: 1,
      trimEnd: 4,
      leadingPadSeconds: 0,
      startTimeDelta: -2,
    });
  });

  it('allows pre-gap-only takes with a zero-length hole', () => {
    const layer = makeLayer({
      startTime: 5,
      duration: 12,
      effects: { trimIn: 0, trimOut: 10 },
    });
    // Record only 3s before the track — no overlap into keep region
    const result = getReplaceSpliceParams(layer, 2, 3);
    assert.deepEqual(result, {
      trimStart: 0,
      trimEnd: 0,
      leadingPadSeconds: 0,
      startTimeDelta: -3,
    });
  });

  it('exposes a minimum effective duration floor constant', () => {
    assert.ok(MIN_REPLACE_EFFECTIVE_DURATION_SEC > 0);
  });
});

describe('applySpliceEdgeFades', () => {
  it('preserves total length and attenuates joint edges', () => {
    const sampleRate = 1000;
    const before = new Float32Array(100).fill(1);
    const mid = new Float32Array(100).fill(1);
    const after = new Float32Array(100).fill(1);
    const faded = applySpliceEdgeFades(
      [before, mid, after],
      sampleRate,
      SPLICE_EDGE_FADE_SECONDS
    );

    const totalIn = before.length + mid.length + after.length;
    const totalOut = faded.reduce((sum, part) => sum + part.length, 0);
    assert.equal(totalOut, totalIn);

    const fadeSamples = Math.round(SPLICE_EDGE_FADE_SECONDS * sampleRate);
    assert.ok((faded[0]![faded[0]!.length - 1] ?? 1) < 1);
    assert.ok((faded[1]![0] ?? 1) < 1);
    assert.ok((faded[1]![faded[1]!.length - 1] ?? 1) < 1);
    assert.ok((faded[2]![0] ?? 1) < 1);
    // Middle of each part stays full scale.
    assert.equal(faded[0]![50], 1);
    assert.equal(faded[1]![50], 1);
    assert.equal(faded[2]![50], 1);
    assert.ok(fadeSamples > 0);
  });

  it('is a no-op for a single part', () => {
    const part = new Float32Array([0.5, 0.6, 0.7]);
    const faded = applySpliceEdgeFades([part], 44100);
    assert.equal(faded.length, 1);
    assert.equal(faded[0], part);
  });
});

describe('splice PCM peaks', () => {
  it('produces design-density peaks for spliced duration', () => {
    const duration = 3;
    const sampleRate = 44100;
    const samples = new Float32Array(Math.round(duration * sampleRate));
    samples[1000] = 0.9;
    const peaks = computeWaveformPeaksFromChannelData(
      samples,
      peakCountForDuration(duration)
    );
    assert.equal(peaks.length, peakCountForDuration(duration));
    assert.ok(peaks.some((peak) => peak >= 0.89));
  });
});
