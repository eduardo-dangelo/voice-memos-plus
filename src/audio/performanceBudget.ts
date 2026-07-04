import {
  delayBusKey,
  isDelayPathActive,
  isReverbPathActive,
  reverbBusKey,
} from '@/src/audio/layerEffectChain';
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

/** Dry path: input gain + 5 EQ + dryGain. */
const DRY_PATH_NODES = 7;
/** Wet send path: input gain + 5 EQ + send gain. */
const WET_PATH_NODES = 7;
/** Shared delay bus: input + delay + feedback + wet. */
const DELAY_BUS_NODES = 4;
/** Shared reverb bus: input + convolver + wet. */
const REVERB_BUS_NODES = 3;
/** Master gain. */
const MASTER_NODES = 1;

/**
 * Per-layer insert nodes only (dry + optional wet EQ/sends).
 * Shared buses are counted once at memo level in estimateMemoNodeCount.
 */
export function estimateLayerNodeCount(effects: LayerEffects): number {
  let count = DRY_PATH_NODES;
  if (isDelayPathActive(effects)) {
    count += WET_PATH_NODES;
  }
  if (isReverbPathActive(effects)) {
    count += WET_PATH_NODES;
  }
  return count;
}

export function estimateMemoNodeCount(memo: Memo): number {
  const layers = getPlayableLayers(memo);
  const delayKeys = new Set<string>();
  const reverbKeys = new Set<string>();

  let nodes = MASTER_NODES;
  for (const layer of layers) {
    const effects = getLayerEffects(layer);
    nodes += estimateLayerNodeCount(effects);
    if (isDelayPathActive(effects)) {
      delayKeys.add(delayBusKey(effects));
    }
    if (isReverbPathActive(effects)) {
      reverbKeys.add(reverbBusKey(effects));
    }
  }

  nodes += delayKeys.size * DELAY_BUS_NODES;
  nodes += reverbKeys.size * REVERB_BUS_NODES;
  return nodes;
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
