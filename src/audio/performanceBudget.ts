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

/**
 * Estimated float32 PCM MB for fully decoded mono stems (playback / monitor mix).
 * ~48 kHz × 4 bytes × duration × layers. Warn well before 8×5 min (~400 MB).
 */
export const PERFORMANCE_PCM_SAMPLE_RATE = 48000;
export const PERFORMANCE_PCM_BYTES_PER_SAMPLE = 4;
/** Warn when estimated resident PCM exceeds this (3× ~3 min mono ≈ ~100 MB). */
export const PERFORMANCE_PCM_WARN_MB = 100;
/** Layers at least this long count toward the duration × layers product warn. */
export const PERFORMANCE_LONG_LAYER_SEC = 180;
/** Warn when this many long layers are playable (3×3 min song stacks). */
export const PERFORMANCE_LONG_LAYER_WARN_COUNT = 3;

export type MemoPerformanceAssessment = {
  playableLayerCount: number;
  estimatedNodes: number;
  estimatedPcmMb: number;
  longLayerCount: number;
  shouldWarnLayers: boolean;
  shouldWarnNodes: boolean;
  shouldWarnPcm: boolean;
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

/** Approximate MB if every playable layer were fully decoded as mono float32. */
export function estimateMemoPcmMb(memo: Memo): number {
  const layers = getPlayableLayers(memo);
  let sampleSeconds = 0;
  for (const layer of layers) {
    sampleSeconds += Math.max(0, layer.duration);
  }
  const bytes =
    sampleSeconds * PERFORMANCE_PCM_SAMPLE_RATE * PERFORMANCE_PCM_BYTES_PER_SAMPLE;
  return bytes / (1024 * 1024);
}

export function countLongPlayableLayers(memo: Memo): number {
  return getPlayableLayers(memo).filter(
    (layer) => layer.duration >= PERFORMANCE_LONG_LAYER_SEC
  ).length;
}

export function assessMemoPerformance(memo: Memo): MemoPerformanceAssessment {
  const playableLayerCount = getPlayableLayers(memo).length;
  const estimatedNodes = estimateMemoNodeCount(memo);
  const estimatedPcmMb = estimateMemoPcmMb(memo);
  const longLayerCount = countLongPlayableLayers(memo);
  const shouldWarnLayers = playableLayerCount >= PERFORMANCE_LAYER_WARN_COUNT;
  const shouldWarnNodes = estimatedNodes >= PERFORMANCE_NODE_WARN_COUNT;
  const shouldWarnPcm =
    estimatedPcmMb >= PERFORMANCE_PCM_WARN_MB ||
    longLayerCount >= PERFORMANCE_LONG_LAYER_WARN_COUNT;

  return {
    playableLayerCount,
    estimatedNodes,
    estimatedPcmMb,
    longLayerCount,
    shouldWarnLayers,
    shouldWarnNodes,
    shouldWarnPcm,
    shouldWarn: shouldWarnLayers || shouldWarnNodes || shouldWarnPcm,
  };
}

export function getPerformanceWarningMessage(
  warnLayers: boolean,
  warnNodes: boolean,
  warnPcm = false
): string {
  if (warnPcm && (warnLayers || warnNodes)) {
    return 'This memo has long multi-track audio plus heavy processing. Playback may use a lot of memory on some devices.';
  }
  if (warnPcm) {
    return 'This memo has several long tracks. Playback and stacking may use a lot of memory on some devices.';
  }
  if (warnLayers && warnNodes) {
    return 'This memo has many layers and heavy effects. Playback may feel slower on some devices.';
  }
  if (warnLayers) {
    return 'This memo has 8 or more layers. Playback and editing may feel slower on some devices.';
  }
  return 'This memo uses a lot of audio effects. Playback may feel slower on some devices.';
}
