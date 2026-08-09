import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDefaultLayerEffects } from '@/src/audio/layerEffects';
import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';
import {
  buildLayerPlaybackPlans,
  filterPlaybackPlansBySilentLayer,
  partitionPlansByHorizon,
  PLAYBACK_SCHEDULE_CHUNK_SEC,
  resolvePlanAgainstBuffer,
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

test('buildLayerPlaybackPlans emits one plan without loopUntil', () => {
  const layer = makeLayer('solo', 1, 4);
  const plans = buildLayerPlaybackPlans([layer], 0, 20);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].delay, 1);
  assert.ok(Math.abs(plans[0].layerPlayLength - 4) < 0.001);
  assert.equal(plans[0].bufferOffset, 0);
});

test('buildLayerPlaybackPlans tiles full cycles and a partial last cycle', () => {
  // 2s cycle, looped until 5.5s → cycles at [0,2), [2,4), [4,5.5)
  const layer = makeLayer('looped', 0, 2);
  layer.loopUntil = 5.5;
  const plans = buildLayerPlaybackPlans([layer], 0, 20);
  assert.equal(plans.length, 3);
  assert.deepEqual(
    plans.map((plan) => [plan.delay, Number(plan.layerPlayLength.toFixed(3)), plan.bufferOffset]),
    [
      [0, 2, 0],
      [2, 2, 0],
      [4, 1.5, 0],
    ]
  );
});

test('buildLayerPlaybackPlans applies fades only on first and last segments', () => {
  const layer = makeLayer('faded', 0, 2);
  layer.loopUntil = 6;
  layer.effects = {
    ...createDefaultLayerEffects(2),
    fadeInSec: 0.2,
    fadeOutSec: 0.3,
  };
  const plans = buildLayerPlaybackPlans([layer], 0, 20);
  assert.equal(plans.length, 3);
  assert.equal(plans[0].playbackEffects.fadeInSec, 0.2);
  assert.equal(plans[0].playbackEffects.fadeOutSec, 0);
  assert.equal(plans[1].playbackEffects.fadeInSec, 0);
  assert.equal(plans[1].playbackEffects.fadeOutSec, 0);
  assert.equal(plans[2].playbackEffects.fadeInSec, 0);
  assert.equal(plans[2].playbackEffects.fadeOutSec, 0.3);
});

test('buildLayerPlaybackPlans clips mid-loop play windows', () => {
  const layer = makeLayer('mid', 0, 2);
  layer.loopUntil = 6;
  const plans = buildLayerPlaybackPlans([layer], 1.5, 4.5);
  assert.equal(plans.length, 3);
  assert.ok(Math.abs(plans[0].layerPlayLength - 0.5) < 0.001);
  assert.ok(Math.abs(plans[0].bufferOffset - 1.5) < 0.001);
  assert.ok(Math.abs(plans[1].layerPlayLength - 2) < 0.001);
  assert.ok(Math.abs(plans[2].layerPlayLength - 0.5) < 0.001);
});

test('resolvePlanAgainstBuffer trusts cycle offset past first content end', () => {
  // 10s track looped to 20s; play from 15s → planner offset 5, not rejected.
  const layer = makeLayer('ten', 0, 10);
  layer.loopUntil = 20;
  const plans = buildLayerPlaybackPlans([layer], 15, 20);
  assert.equal(plans.length, 1);
  assert.ok(Math.abs(plans[0].bufferOffset - 5) < 0.001);

  const resolved = resolvePlanAgainstBuffer(plans[0], 10);
  assert.ok(resolved);
  assert.ok(Math.abs(resolved!.bufferOffset - 5) < 0.001);
  assert.ok(Math.abs(resolved!.layerPlayLength - 5) < 0.001);
});

test('resolvePlanAgainstBuffer keeps later cycles at buffer start when starting mid-cycle', () => {
  // Start at 5s on a 10s looped track — first segment offset 5; later cycles offset 0.
  const layer = makeLayer('ten', 0, 10);
  layer.loopUntil = 20;
  const plans = buildLayerPlaybackPlans([layer], 5, 20);
  assert.equal(plans.length, 2);

  const resolved = plans.map((plan) => resolvePlanAgainstBuffer(plan, 10));
  assert.ok(resolved[0]);
  assert.ok(resolved[1]);
  assert.ok(Math.abs(resolved[0]!.bufferOffset - 5) < 0.001);
  assert.ok(Math.abs(resolved[0]!.layerPlayLength - 5) < 0.001);
  assert.equal(resolved[1]!.bufferOffset, 0);
  assert.ok(Math.abs(resolved[1]!.layerPlayLength - 10) < 0.001);
});

test('partitionPlansByHorizon only arms segments inside the schedule window', () => {
  const layer = makeLayer('looped', 0, 5);
  layer.loopUntil = 40;
  const plans = buildLayerPlaybackPlans([layer], 0, 40);
  assert.equal(plans.length, 8);

  const { ready, pending } = partitionPlansByHorizon(plans, PLAYBACK_SCHEDULE_CHUNK_SEC);
  assert.ok(ready.every((plan) => plan.delay < PLAYBACK_SCHEDULE_CHUNK_SEC));
  assert.ok(pending.every((plan) => plan.delay >= PLAYBACK_SCHEDULE_CHUNK_SEC));
  assert.equal(ready.length + pending.length, plans.length);
  // 5s cycles: delays 0,5,10 → three ready inside 12s horizon; rest pending.
  assert.equal(ready.length, 3);
  assert.equal(pending.length, 5);
});
