import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Layer } from './types';
import { getReplaceSpliceParams } from './types';

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
    });
  });

  it('inserts at active end with leading silence when playhead is past track', () => {
    const layer = makeLayer();
    const result = getReplaceSpliceParams(layer, 12, 2);
    assert.deepEqual(result, {
      trimStart: 10,
      trimEnd: 10,
      leadingPadSeconds: 2,
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
    });
  });
});
