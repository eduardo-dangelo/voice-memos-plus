import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDefaultLayerEffects } from '@/src/audio/layerEffects';
import {
  buildMergedLayerLabel,
  canMergeLayers,
  getMergePartnerLayers,
  getPlayableLayersInTimelineOrder,
  pickActiveLayerAfterDelete,
  prepareLayersForMix,
  resolveMergeSurvivor,
} from '@/src/audio/mergeLayersLogic';
import type { Layer } from '@/src/storage/types';

function makeLayer(
  id: string,
  order: number,
  duration = 5,
  label = id
): Layer {
  return {
    id,
    order,
    fileName: `${id}.wav`,
    label,
    startTime: 0,
    duration,
  };
}

test('canMergeLayers is true only with more than one playable layer', () => {
  assert.equal(canMergeLayers([makeLayer('a', 0)]), false);
  assert.equal(canMergeLayers([makeLayer('a', 0), makeLayer('b', 1, 0)]), false);
  assert.equal(canMergeLayers([makeLayer('a', 0), makeLayer('b', 1)]), true);
});

test('getPlayableLayersInTimelineOrder sorts higher order first', () => {
  const layers = [
    makeLayer('a', 0, 5, 'Track 1'),
    makeLayer('b', 1, 5, 'Track 2'),
    makeLayer('c', 2, 5, 'Track 3'),
  ];
  assert.deepEqual(
    getPlayableLayersInTimelineOrder(layers).map((layer) => layer.id),
    ['c', 'b', 'a']
  );
});

test('getMergePartnerLayers excludes the anchor and matches timeline order', () => {
  const layers = [
    makeLayer('a', 0, 5, 'Track 1'),
    makeLayer('b', 1, 5, 'Track 2'),
    makeLayer('c', 2, 5, 'Track 3'),
  ];
  assert.deepEqual(
    getMergePartnerLayers(layers, 'a').map((layer) => layer.id),
    ['c', 'b']
  );
  assert.deepEqual(
    getMergePartnerLayers(layers, 'c').map((layer) => layer.id),
    ['b', 'a']
  );
});

test('resolveMergeSurvivor prefers explicit survivorId', () => {
  const layers = [makeLayer('a', 0), makeLayer('b', 1), makeLayer('c', 2)];
  const survivor = resolveMergeSurvivor(layers, ['a', 'b', 'c'], 'b');
  assert.equal(survivor.id, 'b');
});

test('resolveMergeSurvivor falls back to lowest order', () => {
  const layers = [makeLayer('a', 0), makeLayer('b', 1), makeLayer('c', 2)];
  const survivor = resolveMergeSurvivor(layers, ['c', 'b']);
  assert.equal(survivor.id, 'b');
});

test('resolveMergeSurvivor rejects fewer than two playable selections', () => {
  const layers = [makeLayer('a', 0), makeLayer('b', 1, 0)];
  assert.throws(
    () => resolveMergeSurvivor(layers, ['a', 'b']),
    /at least two tracks/i
  );
});

function makeMixLayer(
  id: string,
  options?: { muted?: boolean; solo?: boolean }
) {
  const effects = createDefaultLayerEffects(10);
  return {
    id,
    effects: {
      ...effects,
      muted: options?.muted ?? false,
      solo: options?.solo ?? false,
    },
  };
}

test('prepareLayersForMix filters by layerIds and preserves order', () => {
  const layers = [makeMixLayer('a'), makeMixLayer('b'), makeMixLayer('c')];
  const selected = prepareLayersForMix(layers, { layerIds: ['c', 'a'] });
  assert.deepEqual(
    selected.map((layer) => layer.id),
    ['a', 'c']
  );
});

test('prepareLayersForMix forceAudible clears mute and solo', () => {
  const layers = [
    makeMixLayer('a', { muted: true, solo: true }),
    makeMixLayer('b'),
  ];
  const selected = prepareLayersForMix(layers, {
    layerIds: ['a', 'b'],
    forceAudible: true,
  });
  assert.equal(selected[0]?.effects?.muted, false);
  assert.equal(selected[0]?.effects?.solo, false);
});

test('prepareLayersForMix keeps mute/solo when forceAudible is false', () => {
  const layers = [makeMixLayer('a', { muted: true }), makeMixLayer('b')];
  const selected = prepareLayersForMix(layers);
  assert.equal(selected[0]?.effects?.muted, true);
});

test('prepareLayersForMix throws when no ids match', () => {
  assert.throws(
    () => prepareLayersForMix([makeMixLayer('a')], { layerIds: ['missing'] }),
    /Track not found/i
  );
});

test('buildMergedLayerLabel joins labels with & and puts survivor first', () => {
  const layers = [
    makeLayer('a', 0, 5, 'Track 1'),
    makeLayer('b', 1, 5, 'Track 2'),
    makeLayer('c', 2, 5, 'Track 3'),
  ];
  assert.equal(
    buildMergedLayerLabel(layers, ['a', 'b', 'c'], 'b'),
    'Track 2 & Track 1 & Track 3'
  );
  assert.equal(
    buildMergedLayerLabel(layers, ['c', 'a']),
    'Track 1 & Track 3'
  );
});

test('pickActiveLayerAfterDelete selects track below when deleting active middle track', () => {
  const layersBefore = [
    makeLayer('a', 0),
    makeLayer('b', 1),
    makeLayer('c', 2),
  ];
  const layersAfter = [makeLayer('a', 0), makeLayer('c', 2)];
  assert.equal(
    pickActiveLayerAfterDelete(layersBefore, layersAfter, 'b', 'b'),
    'a'
  );
});

test('pickActiveLayerAfterDelete selects track above when deleting active bottom track', () => {
  const layersBefore = [
    makeLayer('a', 0),
    makeLayer('b', 1),
    makeLayer('c', 2),
  ];
  const layersAfter = [makeLayer('a', 0), makeLayer('b', 1)];
  assert.equal(
    pickActiveLayerAfterDelete(layersBefore, layersAfter, 'a', 'a'),
    'b'
  );
});

test('pickActiveLayerAfterDelete preserves selection when deleting non-active track', () => {
  const layersBefore = [
    makeLayer('a', 0),
    makeLayer('b', 1),
    makeLayer('c', 2),
  ];
  const layersAfter = [makeLayer('a', 0), makeLayer('c', 2)];
  assert.equal(
    pickActiveLayerAfterDelete(layersBefore, layersAfter, 'b', 'c'),
    'c'
  );
});

test('pickActiveLayerAfterDelete falls back to first playable when active was deleted', () => {
  const layersBefore = [makeLayer('a', 0), makeLayer('b', 1)];
  const layersAfter = [makeLayer('b', 1)];
  assert.equal(
    pickActiveLayerAfterDelete(layersBefore, layersAfter, 'a', 'a'),
    'b'
  );
});

test('pickActiveLayerAfterDelete returns null when no playable layers remain', () => {
  const layersBefore = [makeLayer('a', 0)];
  const layersAfter: Layer[] = [];
  assert.equal(
    pickActiveLayerAfterDelete(layersBefore, layersAfter, 'a', 'a'),
    null
  );
});

test('pickActiveLayerAfterDelete picks first playable when current active no longer exists', () => {
  const layersBefore = [
    makeLayer('a', 0),
    makeLayer('b', 1),
    makeLayer('c', 2),
  ];
  const layersAfter = [makeLayer('a', 0), makeLayer('c', 2)];
  assert.equal(
    pickActiveLayerAfterDelete(layersBefore, layersAfter, 'b', 'missing'),
    'c'
  );
});
