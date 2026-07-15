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
    const activeStart = layer.startTime + trimIn;
    const activeEnd = layer.startTime + trimOut;

    if (startAt >= activeEnd - PLAYBACK_END_TOLERANCE) {
      continue;
    }
    if (endAt <= activeStart) {
      continue;
    }

    const relativeStart = Math.max(0, startAt - activeStart);
    const bufferOffset = trimIn + relativeStart;
    const delay = Math.max(0, activeStart - startAt);
    const layerPlayStart = Math.max(startAt, activeStart);
    const layerPlayDuration = Math.min(activeEnd - layerPlayStart, endAt - layerPlayStart);

    if (layerPlayDuration <= PLAYBACK_END_TOLERANCE) {
      continue;
    }

    const maxBufferOffset = trimOut - PLAYBACK_END_TOLERANCE;
    if (bufferOffset >= maxBufferOffset) {
      continue;
    }

    const layerPlayLength = Math.min(layerPlayDuration, trimOut - bufferOffset);

    plans.push({
      layer,
      playbackEffects,
      bufferOffset,
      delay,
      layerPlayLength,
    });
  }

  return plans;
}
