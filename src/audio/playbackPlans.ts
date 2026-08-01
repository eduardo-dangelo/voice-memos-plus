import { normalizeLayerEffects, type LayerEffects } from '@/src/audio/layerEffects';
import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';

export const PLAYBACK_END_TOLERANCE = 0.05;

export type LayerPlaybackPlanSpec = {
  layer: LoadedLayer;
  playbackEffects: LayerEffects;
  bufferOffset: number;
  delay: number;
  layerPlayLength: number;
};

export function getLayerEffectsForPlayback(layer: LoadedLayer): LayerEffects {
  return normalizeLayerEffects({ duration: layer.duration, effects: layer.effects });
}

export function getMemoExportBounds(
  trimStart: number,
  trimEnd: number,
  timelineDuration: number
): { start: number; end: number } {
  const end = trimEnd > 0 ? Math.min(trimEnd, timelineDuration) : timelineDuration;
  return { start: trimStart, end };
}

function getLayerFootprintEnd(layer: LoadedLayer, contentEnd: number): number {
  if (layer.loopUntil == null || !Number.isFinite(layer.loopUntil)) {
    return contentEnd;
  }
  return Math.max(contentEnd, layer.loopUntil);
}

function effectsForLoopSegment(
  effects: LayerEffects,
  applyFadeIn: boolean,
  applyFadeOut: boolean
): LayerEffects {
  if (applyFadeIn && applyFadeOut) {
    return effects;
  }
  return {
    ...effects,
    fadeInSec: applyFadeIn ? effects.fadeInSec : 0,
    fadeOutSec: applyFadeOut ? effects.fadeOutSec : 0,
  };
}

export function buildLayerPlaybackPlans(
  layers: LoadedLayer[],
  startAt: number,
  endAt: number,
  getEffects: (layer: LoadedLayer) => LayerEffects = getLayerEffectsForPlayback
): LayerPlaybackPlanSpec[] {
  const plans: LayerPlaybackPlanSpec[] = [];

  for (const layer of layers) {
    if (layer.duration <= 0) {
      continue;
    }

    const effects = getEffects(layer);
    const trimOut = Math.min(effects.trimOut, layer.duration);
    const trimIn = Math.min(effects.trimIn, Math.max(0, trimOut - PLAYBACK_END_TOLERANCE));
    const playbackEffects: LayerEffects = { ...effects, trimIn, trimOut };
    const cycleDuration = Math.max(0, trimOut - trimIn);
    if (cycleDuration <= PLAYBACK_END_TOLERANCE) {
      continue;
    }

    const activeStart = layer.startTime + trimIn;
    const contentEnd = layer.startTime + trimOut;
    const footprintEnd = getLayerFootprintEnd(layer, contentEnd);

    if (startAt >= footprintEnd - PLAYBACK_END_TOLERANCE) {
      continue;
    }
    if (endAt <= activeStart) {
      continue;
    }

    const audibleStart = Math.max(startAt, activeStart);
    const audibleEnd = Math.min(endAt, footprintEnd);
    if (audibleEnd - audibleStart <= PLAYBACK_END_TOLERANCE) {
      continue;
    }

    const firstCycleIndex = Math.floor((audibleStart - activeStart) / cycleDuration);
    const lastCycleIndex = Math.floor(
      Math.max(0, audibleEnd - activeStart - PLAYBACK_END_TOLERANCE) / cycleDuration
    );

    for (let cycleIndex = firstCycleIndex; cycleIndex <= lastCycleIndex; cycleIndex += 1) {
      const cycleStart = activeStart + cycleIndex * cycleDuration;
      const cycleEnd = Math.min(cycleStart + cycleDuration, footprintEnd);
      const segmentStart = Math.max(audibleStart, cycleStart);
      const segmentEnd = Math.min(audibleEnd, cycleEnd);
      const layerPlayLength = segmentEnd - segmentStart;

      if (layerPlayLength <= PLAYBACK_END_TOLERANCE) {
        continue;
      }

      const relativeStart = segmentStart - cycleStart;
      const bufferOffset = trimIn + relativeStart;
      const maxBufferOffset = trimOut - PLAYBACK_END_TOLERANCE;
      if (bufferOffset >= maxBufferOffset) {
        continue;
      }

      const clampedLength = Math.min(layerPlayLength, trimOut - bufferOffset);
      if (clampedLength <= PLAYBACK_END_TOLERANCE) {
        continue;
      }

      // Fade-in only on the true content start; fade-out only on the footprint end.
      const applyFadeIn =
        cycleIndex === 0 && relativeStart <= PLAYBACK_END_TOLERANCE;
      const applyFadeOut = segmentEnd >= footprintEnd - PLAYBACK_END_TOLERANCE;

      plans.push({
        layer,
        playbackEffects: effectsForLoopSegment(playbackEffects, applyFadeIn, applyFadeOut),
        bufferOffset,
        delay: Math.max(0, segmentStart - startAt),
        layerPlayLength: clampedLength,
      });
    }
  }

  return plans;
}

/** Drop a layer from monitor-mix plans (e.g. the track being replaced). */
export function filterPlaybackPlansBySilentLayer<T extends { layer: { id: string } }>(
  plans: T[],
  silentLayerId?: string | null
): T[] {
  if (!silentLayerId) {
    return plans;
  }
  return plans.filter((plan) => plan.layer.id !== silentLayerId);
}
