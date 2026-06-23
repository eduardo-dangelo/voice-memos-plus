import {
  normalizeLayerEffects,
  type LayerEffects,
} from '@/src/audio/layerEffects';

export type { LayerEffects } from '@/src/audio/layerEffects';

export type Layer = {
  id: string;
  order: number;
  fileName: string;
  label: string;
  startTime: number;
  duration: number;
  waveformPeaks?: number[];
  effects?: LayerEffects;
};

export type Memo = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  layers: Layer[];
};

export function getLayerSourceDuration(layer: Layer): number {
  return layer.duration;
}

export function getLayerActiveStartTime(layer: Layer): number {
  const effects = getLayerEffects(layer);
  return layer.startTime + effects.trimIn;
}

export function getLayerActiveEndTime(layer: Layer): number {
  const effects = getLayerEffects(layer);
  return layer.startTime + effects.trimOut;
}

export function getLayerActiveDuration(layer: Layer): number {
  const effects = getLayerEffects(layer);
  return Math.max(0, effects.trimOut - effects.trimIn);
}

export function getLayerEndTime(layer: Layer): number {
  return getLayerActiveEndTime(layer);
}

export function getMemoTimelineDuration(memo: Memo): number {
  if (memo.layers.length === 0) {
    return memo.duration;
  }
  return Math.max(memo.duration, ...memo.layers.map(getLayerEndTime));
}

export function normalizeLayers(memo: Memo): Memo {
  for (const layer of memo.layers) {
    if (layer.startTime === undefined) {
      layer.startTime = 0;
    }
    if (layer.duration === undefined) {
      layer.duration = 0;
    }
    layer.effects = normalizeLayerEffects(layer);
    if (layer.duration > 0 && layer.effects.trimOut <= 0) {
      layer.effects.trimOut = layer.duration;
    }
  }
  return memo;
}

export function getLayerEffects(layer: Layer): LayerEffects {
  return normalizeLayerEffects({ duration: layer.duration, effects: layer.effects });
}

export function getEffectiveDuration(memo: Memo): number {
  const end = memo.trimEnd > 0 ? memo.trimEnd : memo.duration;
  const start = memo.trimStart;
  return Math.max(0, end - start);
}

export function hasRecording(memo: Memo): boolean {
  return getMemoTimelineDuration(memo) > 0 || memo.layers.some((layer) => layer.duration > 0);
}

export function getPlayableLayers(memo: Memo): Layer[] {
  return memo.layers.filter((layer) => layer.duration > 0);
}

export function clampLayerStartTime(startTime: number, trimIn = 0): number {
  return Math.max(-trimIn, startTime);
}

const TIMELINE_EPSILON = 0.001;

function getGlobalEarliestActiveStart(layers: Layer[]): number {
  const playable = layers.filter((entry) => entry.duration > 0);
  if (playable.length === 0) {
    return 0;
  }
  return Math.min(...playable.map(getLayerActiveStartTime));
}

export function isEarliestActiveLayer(layer: Layer, layers: Layer[]): boolean {
  const playable = layers.filter((entry) => entry.duration > 0);
  if (playable.length === 0) {
    return false;
  }
  const activeStart = getLayerActiveStartTime(layer);
  const earliestStart = getGlobalEarliestActiveStart(layers);
  return activeStart <= earliestStart + TIMELINE_EPSILON;
}

function isSoleEarliestActiveLayer(layer: Layer, layers: Layer[]): boolean {
  if (!isEarliestActiveLayer(layer, layers)) {
    return false;
  }
  const activeStart = getLayerActiveStartTime(layer);
  const playable = layers.filter((entry) => entry.duration > 0);
  return playable.every(
    (entry) =>
      entry.id === layer.id ||
      getLayerActiveStartTime(entry) > activeStart + TIMELINE_EPSILON
  );
}

/** Whole-timeline shift when the earliest layer's beginning trim changes (keeps anchor at 0). */
function shouldShiftWholeTimelineForEarliestTrim(layer: Layer, layers: Layer[]): boolean {
  if (!isEarliestActiveLayer(layer, layers)) {
    return false;
  }
  if (isSoleEarliestActiveLayer(layer, layers)) {
    return true;
  }
  // Tied at earliest: only the layer with hidden beginning trim owns the anchor.
  return getLayerEffects(layer).trimIn > TIMELINE_EPSILON;
}

/** Whole-timeline shift when restoring trim reveals audio before the anchored position. */
function shouldShiftWholeTimelineForRestoreTrim(
  layer: Layer,
  layers: Layer[],
  nextTrimIn: number
): boolean {
  const currentTrimIn = getLayerEffects(layer).trimIn;
  if (nextTrimIn >= currentTrimIn - TIMELINE_EPSILON) {
    return false;
  }
  if (currentTrimIn <= TIMELINE_EPSILON) {
    return false;
  }
  const activeStart = getLayerActiveStartTime(layer);
  const globalEarliest = getGlobalEarliestActiveStart(layers);
  if (activeStart > globalEarliest + TIMELINE_EPSILON) {
    return false;
  }
  const projectedActiveStart = layer.startTime + nextTrimIn;
  return projectedActiveStart < activeStart - TIMELINE_EPSILON;
}

export function getEarliestTrimInTimelineDelta(
  layer: Layer,
  layers: Layer[],
  nextTrimIn: number
): number {
  const currentTrimIn = getLayerEffects(layer).trimIn;
  const deltaTrimIn = nextTrimIn - currentTrimIn;
  if (Math.abs(deltaTrimIn) <= TIMELINE_EPSILON) {
    return 0;
  }

  const shouldShift =
    shouldShiftWholeTimelineForEarliestTrim(layer, layers) ||
    shouldShiftWholeTimelineForRestoreTrim(layer, layers, nextTrimIn);

  if (!shouldShift) {
    return 0;
  }
  return -deltaTrimIn;
}

export function applyTimelineDeltaToLayers(layers: Layer[], delta: number): Layer[] {
  if (Math.abs(delta) <= TIMELINE_EPSILON) {
    return layers;
  }
  return layers.map((entry) => ({
    ...entry,
    startTime: entry.startTime + delta,
  }));
}
