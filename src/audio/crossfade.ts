import { clampFadeValues } from '@/src/audio/fadeCurve';
import type { LayerEffects } from '@/src/audio/layerEffects';
import {
  getLayerActiveDuration,
  getLayerActiveEndTime,
  getLayerActiveStartTime,
  type Layer,
} from '@/src/storage/types';

export type CrossfadePair = {
  outgoingLayerId: string;
  incomingLayerId: string;
  /** Timeline start of the overlap. */
  overlapStart: number;
  /** Timeline end of the overlap. */
  overlapEnd: number;
  overlapDuration: number;
};

/**
 * Find a partial temporal overlap for crossfade with the active layer.
 * Outgoing = earlier activeStart; incoming = later activeStart.
 * Skips nested (complete containment) overlaps.
 */
export function findCrossfadePeer(
  activeLayer: Layer,
  layers: Layer[]
): CrossfadePair | null {
  const activeStart = getLayerActiveStartTime(activeLayer);
  const activeEnd = getLayerActiveEndTime(activeLayer);
  if (activeEnd <= activeStart) {
    return null;
  }

  let best: CrossfadePair | null = null;

  for (const other of layers) {
    if (other.id === activeLayer.id || other.duration <= 0) {
      continue;
    }
    const otherStart = getLayerActiveStartTime(other);
    const otherEnd = getLayerActiveEndTime(other);
    if (otherEnd <= otherStart) {
      continue;
    }

    const overlapStart = Math.max(activeStart, otherStart);
    const overlapEnd = Math.min(activeEnd, otherEnd);
    const overlapDuration = overlapEnd - overlapStart;
    if (overlapDuration <= 0.05) {
      continue;
    }

    // Nested: one fully contains the other — skip auto-crossfade.
    const activeContainsOther = activeStart <= otherStart && activeEnd >= otherEnd;
    const otherContainsActive = otherStart <= activeStart && otherEnd >= activeEnd;
    if (activeContainsOther || otherContainsActive) {
      continue;
    }

    const outgoingIsActive = activeStart <= otherStart;
    const pair: CrossfadePair = {
      outgoingLayerId: outgoingIsActive ? activeLayer.id : other.id,
      incomingLayerId: outgoingIsActive ? other.id : activeLayer.id,
      overlapStart,
      overlapEnd,
      overlapDuration,
    };

    if (!best || pair.overlapDuration > best.overlapDuration) {
      best = pair;
    }
  }

  return best;
}

export function areFadesLinkedForCrossfade(
  outgoing: LayerEffects,
  incoming: LayerEffects,
  overlapDuration: number
): boolean {
  if (outgoing.fadeOutSec <= 0 || incoming.fadeInSec <= 0) {
    return false;
  }
  const durationMatch = Math.abs(outgoing.fadeOutSec - incoming.fadeInSec) < 0.04;
  const withinOverlap =
    outgoing.fadeOutSec <= overlapDuration + 0.04 &&
    incoming.fadeInSec <= overlapDuration + 0.04;
  const curveMatch = Math.abs(outgoing.fadeOutCurve + incoming.fadeInCurve) < 0.08;
  return durationMatch && withinOverlap && curveMatch;
}

export function applyLinkedCrossfade(
  outgoingEffects: LayerEffects,
  incomingEffects: LayerEffects,
  outgoingActiveDuration: number,
  incomingActiveDuration: number,
  durationSec: number,
  curve: number
): { outgoing: LayerEffects; incoming: LayerEffects } {
  const d = Math.max(0, durationSec);
  const outgoingClamped = clampFadeValues(
    outgoingEffects.fadeInSec,
    d,
    outgoingEffects.fadeInCurve,
    -curve,
    outgoingActiveDuration
  );
  const incomingClamped = clampFadeValues(
    d,
    incomingEffects.fadeOutSec,
    curve,
    incomingEffects.fadeOutCurve,
    incomingActiveDuration
  );
  return {
    outgoing: {
      ...outgoingEffects,
      fadeOutSec: outgoingClamped.fadeOutSec,
      fadeOutCurve: outgoingClamped.fadeOutCurve,
    },
    incoming: {
      ...incomingEffects,
      fadeInSec: incomingClamped.fadeInSec,
      fadeInCurve: incomingClamped.fadeInCurve,
    },
  };
}

export function getLayerActiveDurationSafe(layer: Layer): number {
  return Math.max(0, getLayerActiveDuration(layer));
}
