import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PERFORMANCE_LAYER_WARN_COUNT } from '@/src/audio/performanceBudget';
import {
  COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE,
  MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE,
  hasCollapsedUnselectedTracks,
  maybeShowPerformanceWarning,
  resetPerformanceWarningState,
  resolvePerformanceRelatedTips,
  shouldShowCollapseTracksTip,
  shouldShowMergeLayersTip,
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

test('maybeShowPerformanceWarning is suppressed when memo hid the warning', () => {
  resetPerformanceWarningState();
  const heavy = makeMemo(PERFORMANCE_LAYER_WARN_COUNT, {
    hidePerformanceWarning: true,
  });
  assert.equal(maybeShowPerformanceWarning(heavy).message, null);
});

test('shouldShowMergeLayersTip requires mergeable layers', () => {
  assert.equal(shouldShowMergeLayersTip(null, false), false);
  assert.equal(shouldShowMergeLayersTip(makeMemo(1), false), false);
  assert.equal(shouldShowMergeLayersTip(makeMemo(2), false), true);
  assert.equal(shouldShowMergeLayersTip(makeMemo(2), true), false);
  assert.equal(
    shouldShowMergeLayersTip(makeMemo(2, { hideMergeLayersPerformanceTip: true }), false),
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

test('shouldShowCollapseTracksTip skips when unselected tracks already collapsed', () => {
  const memo = makeMemo(2);
  assert.equal(
    shouldShowCollapseTracksTip(memo, false, {
      activeLayerId: 'layer-0',
      collapsedLayerIds: new Set(),
    }),
    true
  );
  assert.equal(
    shouldShowCollapseTracksTip(memo, false, {
      activeLayerId: 'layer-0',
      collapsedLayerIds: new Set(['layer-1']),
    }),
    false
  );
  assert.equal(
    shouldShowCollapseTracksTip(
      makeMemo(2, { trackAccordionEnabled: true }),
      false,
      {
        activeLayerId: 'layer-0',
        collapsedLayerIds: new Set(),
      }
    ),
    false
  );
  assert.equal(
    shouldShowCollapseTracksTip(memo, true, {
      activeLayerId: 'layer-0',
      collapsedLayerIds: new Set(),
    }),
    false
  );
  assert.equal(
    shouldShowCollapseTracksTip(
      makeMemo(2, { hideCollapseTracksPerformanceTip: true }),
      false,
      {
        activeLayerId: 'layer-0',
        collapsedLayerIds: new Set(),
      }
    ),
    false
  );
});

test('resolvePerformanceRelatedTips hides merge and collapse before performance warning', () => {
  resetPerformanceWarningState();
  const light = makeMemo(2);
  const result = resolvePerformanceRelatedTips({
    memo: light,
    isRecording: false,
    activeLayerId: 'layer-0',
    collapsedLayerIds: new Set(),
  });
  assert.equal(result.kind, null);
});

test('resolvePerformanceRelatedTips prefers performance then merge then collapse', () => {
  resetPerformanceWarningState();
  const heavy = makeMemo(PERFORMANCE_LAYER_WARN_COUNT);
  const first = resolvePerformanceRelatedTips({
    memo: heavy,
    isRecording: false,
    activeLayerId: 'layer-0',
    collapsedLayerIds: new Set(),
  });
  assert.equal(first.kind, 'performance');

  const second = resolvePerformanceRelatedTips({
    memo: heavy,
    isRecording: false,
    activeLayerId: 'layer-0',
    collapsedLayerIds: new Set(),
  });
  assert.equal(second.kind, 'merge');

  const third = resolvePerformanceRelatedTips({
    memo: heavy,
    isRecording: false,
    activeLayerId: 'layer-0',
    collapsedLayerIds: new Set(),
  });
  assert.equal(third.kind, 'collapse');

  const fourth = resolvePerformanceRelatedTips({
    memo: heavy,
    isRecording: false,
    activeLayerId: 'layer-0',
    collapsedLayerIds: new Set(),
  });
  assert.equal(fourth.kind, null);
});

test('resolvePerformanceRelatedTips shows merge when performance is hidden', () => {
  resetPerformanceWarningState();
  const memo = makeMemo(PERFORMANCE_LAYER_WARN_COUNT, {
    hidePerformanceWarning: true,
  });
  const result = resolvePerformanceRelatedTips({
    memo,
    isRecording: false,
    activeLayerId: 'layer-0',
    collapsedLayerIds: new Set(),
  });
  assert.equal(result.kind, 'merge');
});

test('resolvePerformanceRelatedTips shows collapse when merge is hidden', () => {
  resetPerformanceWarningState();
  const memo = makeMemo(2, {
    hidePerformanceWarning: true,
    hideMergeLayersPerformanceTip: true,
  });
  const result = resolvePerformanceRelatedTips({
    memo,
    isRecording: false,
    activeLayerId: 'layer-0',
    collapsedLayerIds: new Set(),
  });
  assert.equal(result.kind, 'collapse');
});

test('MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE mentions merge and file size', () => {
  assert.match(MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE, /merge layers/i);
  assert.match(MERGE_LAYERS_PERFORMANCE_TIP_MESSAGE, /file size/i);
});

test('COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE mentions collapse and unselected tracks', () => {
  assert.match(COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE, /collapse/i);
  assert.match(COLLAPSE_TRACKS_PERFORMANCE_TIP_MESSAGE, /unselected tracks/i);
});
