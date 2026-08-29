import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PERFORMANCE_LAYER_WARN_COUNT } from '@/src/audio/performanceBudget';
import {
  maybeShowPerformanceWarning,
  resetPerformanceWarningState,
} from '@/src/audio/performanceWarning';
import type { Memo } from '@/src/storage/types';

function makeMemo(layerCount: number): Memo {
  return {
    id: 'memo-perf',
    title: 'Test',
    titleSource: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    duration: 10,
    trimStart: 0,
    trimEnd: 10,
    loopStart: 0,
    loopEnd: 10,
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
    layers: Array.from({ length: layerCount }, (_, index) => ({
      id: `layer-${index}`,
      order: index,
      fileName: `layer-${index}.wav`,
      label: `Track ${index + 1}`,
      startTime: 0,
      duration: 10,
      color: null,
      muted: false,
      solo: false,
      loopUntil: null,
      effects: {},
    })),
  };
}

test('maybeShowPerformanceWarning shows again after dropping below layer threshold', () => {
  resetPerformanceWarningState();

  const heavy = makeMemo(PERFORMANCE_LAYER_WARN_COUNT);
  const light = makeMemo(PERFORMANCE_LAYER_WARN_COUNT - 1);

  assert.ok(maybeShowPerformanceWarning(heavy).message);
  assert.equal(maybeShowPerformanceWarning(heavy).message, null);
  assert.equal(maybeShowPerformanceWarning(light).message, null);
  assert.ok(maybeShowPerformanceWarning(heavy).message);
});
