import { isDelayPathActive, isReverbPathActive } from '@/src/audio/layerEffectChain';
import type { LayerEffects } from '@/src/audio/layerEffects';
import { getLayerEffects, getPlayableLayers, type Memo } from '@/src/storage/types';

export const PERFORMANCE_LAYER_WARN_COUNT = 8;
export const PERFORMANCE_NODE_WARN_COUNT = 100;

export type MemoPerformanceAssessment = {
  playableLayerCount: number;
  estimatedNodes: number;
  shouldWarnLayers: boolean;
  shouldWarnNodes: boolean;
  shouldWarn: boolean;
};

/** Per-layer serial insert graph: input + dry + optional delay/reverb wet paths. */
export function estimateLayerNodeCount(effects: LayerEffects): number {
  let count = 7;
  if (isDelayPathActive(effects)) {
    count += 3;
  }
  if (isReverbPathActive(effects)) {
    count += 2;
  }
  return count;
}

export function estimateMemoNodeCount(memo: Memo): number {
  const layers = getPlayableLayers(memo);
  return layers.reduce(
    (sum, layer) => sum + estimateLayerNodeCount(getLayerEffects(layer)),
    0
  );
}

export function assessMemoPerformance(memo: Memo): MemoPerformanceAssessment {
  const playableLayerCount = getPlayableLayers(memo).length;
  const estimatedNodes = estimateMemoNodeCount(memo);
  const shouldWarnLayers = playableLayerCount >= PERFORMANCE_LAYER_WARN_COUNT;
  const shouldWarnNodes = estimatedNodes >= PERFORMANCE_NODE_WARN_COUNT;

  return {
    playableLayerCount,
    estimatedNodes,
    shouldWarnLayers,
    shouldWarnNodes,
    shouldWarn: shouldWarnLayers || shouldWarnNodes,
  };
}

export function getPerformanceWarningMessage(
  warnLayers: boolean,
  warnNodes: boolean
): string {
  if (warnLayers && warnNodes) {
    return 'This memo has many layers and heavy effects. Playback may feel slower on some devices.';
  }
  if (warnLayers) {
    return 'This memo has 8 or more layers. Playback and editing may feel slower on some devices.';
  }
  return 'This memo uses a lot of audio effects. Playback may feel slower on some devices.';
}
