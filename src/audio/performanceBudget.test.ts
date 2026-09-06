import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assessMemoPerformance,
  estimateMemoPcmMb,
  PERFORMANCE_LONG_LAYER_SEC,
  PERFORMANCE_LONG_LAYER_WARN_COUNT,
  PERFORMANCE_PCM_WARN_MB,
} from './performanceBudget';
import {
  pageStartForOffset,
  shouldPageLayerPcm,
  LAYER_PCM_PAGE_MIN_DURATION_SEC,
  LAYER_PCM_PAGE_SEC,
} from './layerPcmPageCache';
import type { Memo } from '@/src/storage/types';

function makeMemo(layers: { duration: number }[]): Memo {
  return {
    id: 'm',
    title: 't',
    titleSource: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    duration: layers.reduce((sum, layer) => Math.max(sum, layer.duration), 0),
    trimStart: 0,
    trimEnd: 0,
    loopStart: 0,
    loopEnd: 0,
    loopEnabled: false,
    loopSnapToGrid: false,
    metronome: {
      enabled: false,
      bpm: 120,
      timeSignature: '4/4',
      accentEnabled: true,
      showGrid: false,
      volume: 80,
      gridBasis: 'metronome',
      metronomeGridSubdivision: '1/4',
      timeGridSubdivision: '1s',
    },
    precount: 'off',
    folderId: null,
    layers: layers.map((layer, index) => ({
      id: `l${index}`,
      order: index,
      fileName: `l${index}.wav`,
      label: `Track ${index + 1}`,
      startTime: 0,
      duration: layer.duration,
      color: null,
      muted: false,
      solo: false,
      loopUntil: null,
      effects: {},
    })),
  };
}

test('estimateMemoPcmMb scales with layer duration', () => {
  const short = estimateMemoPcmMb(makeMemo([{ duration: 60 }]));
  const long = estimateMemoPcmMb(makeMemo([{ duration: 276 }, { duration: 276 }]));
  assert.ok(long > short * 4);
  assert.ok(long > 50);
});

test('assessMemoPerformance warns on long multi-layer PCM', () => {
  const memo = makeMemo(
    Array.from({ length: PERFORMANCE_LONG_LAYER_WARN_COUNT }, () => ({
      duration: PERFORMANCE_LONG_LAYER_SEC,
    }))
  );
  const assessment = assessMemoPerformance(memo);
  assert.equal(assessment.shouldWarnPcm, true);
  assert.ok(assessment.estimatedPcmMb >= PERFORMANCE_PCM_WARN_MB * 0.8);
});

test('shouldPageLayerPcm only for long wav paths', () => {
  assert.equal(shouldPageLayerPcm('/x.wav', LAYER_PCM_PAGE_MIN_DURATION_SEC), true);
  assert.equal(shouldPageLayerPcm('/x.wav', LAYER_PCM_PAGE_MIN_DURATION_SEC - 1), false);
  assert.equal(shouldPageLayerPcm('/x.m4a', 300), false);
});

test('pageStartForOffset aligns to page size', () => {
  assert.equal(pageStartForOffset(0), 0);
  assert.equal(pageStartForOffset(LAYER_PCM_PAGE_SEC - 0.1), 0);
  assert.equal(pageStartForOffset(LAYER_PCM_PAGE_SEC), LAYER_PCM_PAGE_SEC);
});
