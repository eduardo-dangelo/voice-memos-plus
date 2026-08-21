import { normalizeLayerEffects, type LayerEffects } from '@/src/audio/layerEffects';
import type { LoadedLayer } from '@/src/audio/MemoAudioEngine';

export const PLAYBACK_END_TOLERANCE = 0.05;

/** Sliding schedule window for looped / long segments (play + monitor-mix). */
export const PLAYBACK_SCHEDULE_CHUNK_SEC = 12;
export const PLAYBACK_SCHEDULE_EXTEND_LEAD_SEC = 2;

/** Base AudioContext lead before the first source `start()` in runPlay. */
export const PLAYBACK_SCHEDULE_LEAD_SEC = 0.01;
/** Extra lead per ready plan when arming many loop-cycle sources. */
export const PLAYBACK_SCHEDULE_LEAD_PER_PLAN_SEC = 0.002;
/** Cap so warm multi-cycle schedules still stay responsive. */
export const PLAYBACK_SCHEDULE_LEAD_MAX_SEC = 0.08;

/**
 * Schedule lead before arming sources. Grows with ready-plan count so a burst of
 * loop-cycle BufferSources does not start after the UI clock origin.
 */
export function playbackScheduleLeadSec(readyPlanCount: number): number {
  const count = Math.max(0, Math.floor(readyPlanCount));
  const lead =
    PLAYBACK_SCHEDULE_LEAD_SEC + PLAYBACK_SCHEDULE_LEAD_PER_PLAN_SEC * count;
  return Math.min(
    PLAYBACK_SCHEDULE_LEAD_MAX_SEC,
    Math.max(PLAYBACK_SCHEDULE_LEAD_SEC, lead)
  );
}

export type LayerPlaybackPlanSpec = {
  layer: LoadedLayer;
  playbackEffects: LayerEffects;
  bufferOffset: number;
  delay: number;
  layerPlayLength: number;
};

export type ResolvedLayerPlaybackPlan = {
  playbackEffects: LayerEffects;
  bufferOffset: number;
  delay: number;
  layerPlayLength: number;
};

/**
 * Clamp a planner segment against the decoded buffer duration.
 * Trusts cycle-aware `plan.bufferOffset` — do not recompute from playhead.
 */
export function resolvePlanAgainstBuffer(
  plan: LayerPlaybackPlanSpec,
  bufferDuration: number
): ResolvedLayerPlaybackPlan | null {
  const trimOut = Math.min(plan.playbackEffects.trimOut, bufferDuration);
  const trimIn = Math.min(
    plan.playbackEffects.trimIn,
    Math.max(0, trimOut - PLAYBACK_END_TOLERANCE)
  );
  const playbackEffects: LayerEffects = { ...plan.playbackEffects, trimIn, trimOut };
  const maxBufferOffset = trimOut - PLAYBACK_END_TOLERANCE;

  if (plan.bufferOffset >= maxBufferOffset) {
    return null;
  }

  const layerPlayLength = Math.min(plan.layerPlayLength, trimOut - plan.bufferOffset);
  if (layerPlayLength <= PLAYBACK_END_TOLERANCE) {
    return null;
  }

  return {
    playbackEffects,
    bufferOffset: plan.bufferOffset,
    delay: plan.delay,
    layerPlayLength,
  };
}

/** Split plans into those that start within the schedule horizon vs later. */
export function partitionPlansByHorizon<T extends { delay: number }>(
  plans: T[],
  horizonSec: number
): { ready: T[]; pending: T[] } {
  const ready: T[] = [];
  const pending: T[] = [];
  for (const plan of plans) {
    if (plan.delay < horizonSec) {
      ready.push(plan);
    } else {
      pending.push(plan);
    }
  }
  return { ready, pending };
}

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
