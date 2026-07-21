import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDefaultLayerEffects } from '@/src/audio/layerEffects';
import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';
import {
  buildLayerPlaybackPlans,
  filterPlaybackPlansBySilentLayer,
} from '@/src/audio/playbackPlans';

function makeLayer(id: string, startTime = 0, duration = 10): LoadedLayer {
  return {
    id,
    path: `/tmp/${id}.wav`,
    startTime,
    duration,
    effects: createDefaultLayerEffects(duration),
  };
}

test('filterPlaybackPlansBySilentLayer drops the replace target and keeps siblings', () => {
  const layers = [makeLayer('keep-a'), makeLayer('replace-me'), makeLayer('keep-b')];
  const plans = buildLayerPlaybackPlans(layers, 0, 10);
  assert.equal(plans.length, 3);

  const filtered = filterPlaybackPlansBySilentLayer(plans, 'replace-me');
  assert.deepEqual(
    filtered.map((plan) => plan.layer.id),
    ['keep-a', 'keep-b']
  );
});

test('filterPlaybackPlansBySilentLayer is a no-op without silentLayerId', () => {
  const layers = [makeLayer('a'), makeLayer('b')];
  const plans = buildLayerPlaybackPlans(layers, 0, 10);

  assert.equal(filterPlaybackPlansBySilentLayer(plans).length, 2);
  assert.equal(filterPlaybackPlansBySilentLayer(plans, null).length, 2);
  assert.equal(filterPlaybackPlansBySilentLayer(plans, undefined).length, 2);
});
