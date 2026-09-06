import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAYER_PCM_PAGE_MIN_DURATION_SEC,
  LAYER_PCM_PAGE_SEC,
  pageStartForOffset,
  shouldPageLayerPcm,
} from '@/src/audio/layerPcmPageCache';

test('shouldPageLayerPcm requires long WAV only', () => {
  assert.equal(shouldPageLayerPcm('/a.wav', LAYER_PCM_PAGE_MIN_DURATION_SEC), true);
  assert.equal(shouldPageLayerPcm('/a.wav', LAYER_PCM_PAGE_MIN_DURATION_SEC - 1), false);
  assert.equal(shouldPageLayerPcm('/a.m4a', 120), false);
  assert.equal(shouldPageLayerPcm('/A.WAV', 120), true);
});

test('pageStartForOffset aligns to page boundaries', () => {
  assert.equal(pageStartForOffset(0), 0);
  assert.equal(pageStartForOffset(LAYER_PCM_PAGE_SEC - 0.01), 0);
  assert.equal(pageStartForOffset(LAYER_PCM_PAGE_SEC), LAYER_PCM_PAGE_SEC);
  assert.equal(pageStartForOffset(LAYER_PCM_PAGE_SEC * 2.5), LAYER_PCM_PAGE_SEC * 2);
  assert.equal(pageStartForOffset(-3), 0);
});
