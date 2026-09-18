import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAYER_PCM_PAGE_MIN_DURATION_SEC,
  LAYER_PCM_PAGE_SEC,
  monitorMixFileOffset,
  pageStartForOffset,
  shouldPageLayerPcm,
} from '@/src/audio/layerPcmPageCache';
import { resampleMonoSamplesFromRate } from '@/src/audio/resampleMonoSamples';

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

test('monitorMixFileOffset is file-relative and clamped to trim', () => {
  assert.equal(monitorMixFileOffset(120, 0, 0, 300), 120);
  assert.equal(monitorMixFileOffset(120, 30, 0, 300), 90);
  assert.equal(monitorMixFileOffset(10, 30, 0, 300), 0);
  assert.equal(monitorMixFileOffset(10, 30, 5, 300), 5);
  assert.equal(monitorMixFileOffset(400, 0, 0, 300, 0.05), 299.95);
});

test('resampleMonoSamplesFromRate keeps ~same wall duration', () => {
  const fromRate = 44100;
  const toRate = 48000;
  const seconds = 1;
  const input = new Float32Array(fromRate * seconds);
  for (let i = 0; i < input.length; i += 1) {
    input[i] = Math.sin((2 * Math.PI * 440 * i) / fromRate);
  }
  const out = resampleMonoSamplesFromRate(input, fromRate, toRate);
  assert.equal(out.length, toRate * seconds);
  const duration = out.length / toRate;
  assert.ok(Math.abs(duration - seconds) < 1e-6);
});
