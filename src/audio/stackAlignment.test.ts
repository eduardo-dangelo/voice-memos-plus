import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyStackAlignmentTrimDelta,
  bestSampleCorrelationLag,
  emphasizeTransients,
  estimatePcmAlignmentDeltaSec,
  findStackAlignmentReference,
  MAX_SHIFT_SEC,
} from './stackAlignment';
import type { Layer, Memo } from '@/src/storage/types';

const SAMPLE_RATE = 44100;

/** Synthetic click train: impulses every `period` samples, starting at `offset`. */
function makeClickTrain(
  length: number,
  offset: number,
  period = Math.floor(SAMPLE_RATE * 0.5)
): Float32Array {
  const samples = new Float32Array(length);
  for (let i = offset; i < length; i += period) {
    samples[i] = 1;
    if (i + 1 < length) {
      samples[i + 1] = 0.35;
    }
    if (i + 2 < length) {
      samples[i + 2] = 0.12;
    }
  }
  return samples;
}

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'ref',
    order: 0,
    fileName: 'a.wav',
    label: 'Track 1',
    startTime: 0,
    duration: 5,
    effects: { trimIn: 0.02, trimOut: 5 },
    ...overrides,
  };
}

describe('findStackAlignmentReference', () => {
  it('picks a layer with matching active start', () => {
    const memo = {
      layers: [
        makeLayer({ id: 'a', startTime: -0.02 }),
        makeLayer({
          id: 'b',
          startTime: 3,
          effects: { trimIn: 0.02, trimOut: 5 },
        }),
      ],
    } as Memo;
    const ref = findStackAlignmentReference(memo, 0);
    assert.equal(ref?.id, 'a');
  });

  it('prefers the lowest-order layer among matching starts', () => {
    const memo = {
      layers: [
        makeLayer({
          id: 'newer',
          order: 2,
          startTime: -0.02,
          effects: { trimIn: 0.02, trimOut: 5 },
        }),
        makeLayer({
          id: 'oldest',
          order: 0,
          startTime: -0.01,
          effects: { trimIn: 0.01, trimOut: 5 },
        }),
        makeLayer({
          id: 'middle',
          order: 1,
          startTime: -0.015,
          effects: { trimIn: 0.015, trimOut: 5 },
        }),
      ],
    } as Memo;
    const ref = findStackAlignmentReference(memo, 0);
    assert.equal(ref?.id, 'oldest');
  });

  it('returns null when nothing matches', () => {
    const memo = {
      layers: [makeLayer({ startTime: 2 })],
    } as Memo;
    assert.equal(findStackAlignmentReference(memo, 0), null);
  });
});

describe('bestSampleCorrelationLag', () => {
  it('finds a positive lag when candidate is late', () => {
    const length = Math.floor(SAMPLE_RATE * 1.2);
    const lag = Math.floor(SAMPLE_RATE * 0.03); // 30ms
    const reference = emphasizeTransients(makeClickTrain(length, 1000));
    const candidate = emphasizeTransients(makeClickTrain(length, 1000 + lag));
    const result = bestSampleCorrelationLag(
      reference,
      candidate,
      Math.floor(MAX_SHIFT_SEC * SAMPLE_RATE),
      8
    );
    assert.ok(result.correlation >= 0.5);
    assert.ok(Math.abs(result.lagSamples - lag) <= 2);
  });
});

describe('estimatePcmAlignmentDeltaSec', () => {
  it('suggests positive trim when candidate clicks are late', () => {
    const length = Math.floor(SAMPLE_RATE * 1.2);
    const lagSec = 0.025;
    const lag = Math.floor(SAMPLE_RATE * lagSec);
    const reference = makeClickTrain(length, 800);
    const candidate = makeClickTrain(length, 800 + lag);
    const estimate = estimatePcmAlignmentDeltaSec(
      reference,
      candidate,
      SAMPLE_RATE
    );
    assert.ok(estimate, 'expected a confident PCM alignment estimate');
    assert.ok(estimate!.deltaTrimSec > 0);
    assert.ok(Math.abs(estimate!.deltaTrimSec - lagSec) < 0.003);
    assert.ok(estimate!.correlation >= 0.5);
  });

  it('returns null for uncorrelated noise', () => {
    const length = Math.floor(SAMPLE_RATE * 1.2);
    const reference = makeClickTrain(length, 800);
    const noise = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      noise[i] = Math.random() * 0.1;
    }
    assert.equal(
      estimatePcmAlignmentDeltaSec(reference, noise, SAMPLE_RATE),
      null
    );
  });

  it('aligns click trains that start after different trimIn offsets', () => {
    const length = Math.floor(SAMPLE_RATE * 2.5);
    const lagSec = 0.03;
    const lag = Math.floor(SAMPLE_RATE * lagSec);
    const refTrimSec = 0.17;
    const candTrimSec = 0.05;
    const clickAt = Math.floor(SAMPLE_RATE * 0.4);
    // Full buffers: wake/noise then clicks. Clicks line up after each trimIn
    // except candidate is lagSec late.
    const reference = new Float32Array(length);
    const candidate = new Float32Array(length);
    const refClickStart = Math.floor(refTrimSec * SAMPLE_RATE) + clickAt;
    const candClickStart =
      Math.floor(candTrimSec * SAMPLE_RATE) + clickAt + lag;
    const period = Math.floor(SAMPLE_RATE * 0.5);
    for (let i = refClickStart; i < length; i += period) {
      reference[i] = 1;
      if (i + 1 < length) reference[i + 1] = 0.35;
    }
    for (let i = candClickStart; i < length; i += period) {
      candidate[i] = 1;
      if (i + 1 < length) candidate[i + 1] = 0.35;
    }
    const estimate = estimatePcmAlignmentDeltaSec(
      reference,
      candidate,
      SAMPLE_RATE,
      { referenceTrimInSec: refTrimSec, candidateTrimInSec: candTrimSec }
    );
    assert.ok(estimate, 'expected trim-aware PCM alignment');
    assert.ok(Math.abs(estimate!.deltaTrimSec - lagSec) < 0.004);
  });
});

describe('applyStackAlignmentTrimDelta', () => {
  it('preserves activeStart while adjusting trimIn', () => {
    const layer = makeLayer({
      startTime: -0.02,
      effects: { trimIn: 0.02, trimOut: 5 },
    });
    const before = layer.startTime + (layer.effects?.trimIn ?? 0);
    applyStackAlignmentTrimDelta(layer, 0.02);
    const after = layer.startTime + (layer.effects?.trimIn ?? 0);
    assert.ok(Math.abs(before - after) < 1e-9);
    assert.ok((layer.effects?.trimIn ?? 0) > 0.02);
  });
});
