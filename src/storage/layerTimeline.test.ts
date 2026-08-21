import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Layer } from '@/src/storage/types';
import {
  clampLayerStartTime,
  getLayerActiveStartTime,
  getLayerEffects,
} from '@/src/storage/types';

function soleLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-1',
    order: 0,
    fileName: 'layer-1.m4a',
    label: 'Track 1',
    startTime: 0,
    duration: 10,
    effects: {
      trimIn: 0,
      trimOut: 10,
    },
    ...overrides,
  };
}

describe('sole-layer trim keeps startTime', () => {
  test('increasing trimIn leaves startTime unchanged and moves activeStart later', () => {
    const layer = soleLayer();
    const startTimeBefore = layer.startTime;

    const next: Layer = {
      ...layer,
      effects: {
        ...getLayerEffects(layer),
        trimIn: 2,
      },
    };

    assert.equal(next.startTime, startTimeBefore);
    assert.equal(getLayerActiveStartTime(next), 2);
  });

  test('decreasing trimIn leaves startTime unchanged and moves activeStart earlier', () => {
    const layer = soleLayer({
      startTime: 0,
      effects: {
        trimIn: 2,
        trimOut: 10,
      },
    });
    const startTimeBefore = layer.startTime;

    const next: Layer = {
      ...layer,
      effects: {
        ...getLayerEffects(layer),
        trimIn: 0.5,
      },
    };

    assert.equal(next.startTime, startTimeBefore);
    assert.equal(getLayerActiveStartTime(next), 0.5);
  });

  test('clampLayerStartTime allows placing content after timeline 0', () => {
    assert.equal(clampLayerStartTime(1.5, 0), 1.5);
    assert.equal(getLayerActiveStartTime(soleLayer({ startTime: 1.5 })), 1.5);
  });
});
