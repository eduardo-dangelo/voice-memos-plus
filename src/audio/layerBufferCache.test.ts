import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';
import {
  getResampledCacheKeysForPath,
  layersNeedingBufferInvalidation,
} from '@/src/audio/layerBufferCache';

function layer(id: string, path: string, duration: number): LoadedLayer {
  return {
    id,
    path,
    startTime: 0,
    duration,
    effects: {
      trimIn: 0,
      trimOut: duration,
      volumeDb: 0,
      pan: 0,
      muted: false,
      solo: false,
      locked: false,
      fadeInSec: 0,
      fadeOutSec: 0,
      fadeInCurve: 'linear',
      fadeOutCurve: 'linear',
      reverb: { preset: 'off', mix: 0, decay: 1, preDelay: 0 },
      delay: { preset: 'off', mix: 0, time: 0.25, feedback: 0.3 },
      eq: { low: 0, mid: 0, high: 0 },
    },
  };
}

describe('getResampledCacheKeysForPath', () => {
  test('returns keys matching path prefix before @', () => {
    const keys = [
      'file:///a/layer-0.m4a@44100',
      'file:///a/layer-0.m4a@48000',
      'file:///a/layer-1.m4a@44100',
    ];
    assert.deepEqual(getResampledCacheKeysForPath('file:///a/layer-0.m4a', keys), [
      'file:///a/layer-0.m4a@44100',
      'file:///a/layer-0.m4a@48000',
    ]);
  });
});

describe('layersNeedingBufferInvalidation', () => {
  test('invalidates when same id and path but duration changed', () => {
    const prev = [layer('a', 'file:///layer-0.m4a', 5)];
    const next = [layer('a', 'file:///layer-0.m4a', 8)];
    assert.deepEqual(layersNeedingBufferInvalidation(prev, next), [
      'file:///layer-0.m4a',
    ]);
  });

  test('does not invalidate when duration unchanged (same-duration replace)', () => {
    const prev = [layer('a', 'file:///layer-0.m4a', 5)];
    const next = [layer('a', 'file:///layer-0.m4a', 5)];
    assert.deepEqual(layersNeedingBufferInvalidation(prev, next), []);
  });

  test('does not invalidate on startTime-only change', () => {
    const prev = [layer('a', 'file:///layer-0.m4a', 5)];
    const next = [{ ...layer('a', 'file:///layer-0.m4a', 5), startTime: 2 }];
    assert.deepEqual(layersNeedingBufferInvalidation(prev, next), []);
  });

  test('does not invalidate new layer paths', () => {
    const prev = [layer('a', 'file:///layer-0.m4a', 5)];
    const next = [
      layer('a', 'file:///layer-0.m4a', 5),
      layer('b', 'file:///layer-1.m4a', 3),
    ];
    assert.deepEqual(layersNeedingBufferInvalidation(prev, next), []);
  });
});
