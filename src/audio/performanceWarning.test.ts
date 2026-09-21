import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PERFORMANCE_LAYER_WARN_COUNT } from '@/src/audio/performanceBudget';
import {
  COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE,
  MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE,
  hasCollapsedUnselectedTracks,
  maybeShowPerformanceWarning,
  resetPerformanceWarningState,
  shouldShowCollapseTracksTipAfterMergeAck,
  shouldShowMergeLayersTipAfterPerformanceAck,
} from '@/src/audio/performanceWarning';
import type { Memo } from '@/src/storage/types';

function makeMemo(layerCount: number, overrides: Partial<Memo> = {}): Memo {
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
    ...overrides,
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

test('shouldShowMergeLayersTipAfterPerformanceAck requires mergeable layers', () => {
  assert.equal(shouldShowMergeLayersTipAfterPerformanceAck(null, false), false);
  assert.equal(shouldShowMergeLayersTipAfterPerformanceAck(makeMemo(1), false), false);
  assert.equal(
    shouldShowMergeLayersTipAfterPerformanceAck(makeMemo(2), false, { hideTip: false }),
    true
  );
  assert.equal(shouldShowMergeLayersTipAfterPerformanceAck(makeMemo(2), true), false);
  assert.equal(
    shouldShowMergeLayersTipAfterPerformanceAck(makeMemo(2), false, { hideTip: true }),
    false
  );
});

test('hasCollapsedUnselectedTracks is true when accordion is enabled', () => {
  const memo = makeMemo(2, { trackAccordionEnabled: true });
  assert.equal(hasCollapsedUnselectedTracks(memo, 'layer-0', new Set()), true);
});

test('hasCollapsedUnselectedTracks is true when a non-active playable layer is collapsed', () => {
  const memo = makeMemo(2);
  assert.equal(
    hasCollapsedUnselectedTracks(memo, 'layer-0', new Set(['layer-1'])),
    true
  );
  assert.equal(
    hasCollapsedUnselectedTracks(memo, 'layer-0', new Set(['layer-0'])),
    false
  );
});

test('shouldShowCollapseTracksTipAfterMergeAck skips when unselected tracks already collapsed', () => {
  const memo = makeMemo(2);
  assert.equal(
    shouldShowCollapseTracksTipAfterMergeAck(memo, false, {
      activeLayerId: 'layer-0',
      collapsedLayerIds: new Set(),
      hideTip: false,
    }),
    true
  );
  assert.equal(
    shouldShowCollapseTracksTipAfterMergeAck(memo, false, {
      activeLayerId: 'layer-0',
      collapsedLayerIds: new Set(['layer-1']),
      hideTip: false,
    }),
    false
  );
  assert.equal(
    shouldShowCollapseTracksTipAfterMergeAck(
      makeMemo(2, { trackAccordionEnabled: true }),
      false,
      {
        activeLayerId: 'layer-0',
        collapsedLayerIds: new Set(),
        hideTip: false,
      }
    ),
    false
  );
  assert.equal(
    shouldShowCollapseTracksTipAfterMergeAck(memo, true, {
      activeLayerId: 'layer-0',
      collapsedLayerIds: new Set(),
      hideTip: false,
    }),
    false
  );
  assert.equal(
    shouldShowCollapseTracksTipAfterMergeAck(memo, false, {
      activeLayerId: 'layer-0',
      collapsedLayerIds: new Set(),
      hideTip: true,
    }),
    false
  );
});

test('MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE mentions merge and file size', () => {
  assert.match(MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE, /merge layers/i);
  assert.match(MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE, /file size/i);
});

test('COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE mentions collapse and unselected tracks', () => {
  assert.match(COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE, /collapse/i);
  assert.match(COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE, /unselected tracks/i);
});
