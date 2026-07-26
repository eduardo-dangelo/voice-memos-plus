import type { LayerEffects } from '@/src/audio/layerEffects';
import type { Layer } from '@/src/storage/types';

function playableLayers(layers: readonly Layer[]): Layer[] {
  return layers.filter((layer) => layer.duration > 0);
}

type MixableLayer = {
  id: string;
  effects?: Partial<LayerEffects> | LayerEffects | null;
};

/**
 * Filter layers by id (order preserved). When `forceAudible` is true, mute/solo
 * are cleared so the mix includes every selected layer.
 */
export function prepareLayersForMix<T extends MixableLayer>(
  layers: readonly T[],
  options?: { layerIds?: readonly string[]; forceAudible?: boolean }
): T[] {
  let selected = [...layers];

  if (options?.layerIds) {
    const idSet = new Set(options.layerIds);
    selected = layers.filter((layer) => idSet.has(layer.id));
    if (selected.length === 0) {
      throw new Error('Track not found.');
    }
  }

  if (!options?.forceAudible) {
    return selected;
  }

  return selected.map((layer) => ({
    ...layer,
    effects: { ...layer.effects, muted: false, solo: false },
  }));
}

/**
 * Resolves which layer survives a merge. Prefer `survivorId` when it is among
 * the selected playable layers; otherwise pick the lowest-order selected layer.
 */
export function resolveMergeSurvivor(
  layers: readonly Layer[],
  layerIds: readonly string[],
  survivorId?: string
): Layer {
  const idSet = new Set(layerIds);
  const selected = playableLayers(layers).filter((layer) => idSet.has(layer.id));

  if (selected.length < 2) {
    throw new Error('Select at least two tracks to merge.');
  }

  if (survivorId) {
    const preferred = selected.find((layer) => layer.id === survivorId);
    if (preferred) {
      return preferred;
    }
  }

  return [...selected].sort((a, b) => a.order - b.order)[0]!;
}

/** Playable layers in timeline order (higher `order` first). */
export function getPlayableLayersInTimelineOrder(
  layers: readonly Layer[]
): Layer[] {
  return playableLayers(layers).sort((a, b) => b.order - a.order);
}

/**
 * Other playable tracks available to merge with an anchor (excludes the anchor).
 * Ordered like the timeline (higher `order` first).
 */
export function getMergePartnerLayers(
  layers: readonly Layer[],
  anchorLayerId: string
): Layer[] {
  return getPlayableLayersInTimelineOrder(layers).filter(
    (layer) => layer.id !== anchorLayerId
  );
}

export function canMergeLayers(layers: readonly Layer[]): boolean {
  return playableLayers(layers).length > 1;
}

/**
 * Combines selected track labels for the merged survivor.
 * Survivor/anchor comes first, then remaining tracks by order.
 */
export function buildMergedLayerLabel(
  layers: readonly Layer[],
  layerIds: readonly string[],
  survivorId?: string
): string {
  const idSet = new Set(layerIds);
  const selected = playableLayers(layers).filter((layer) => idSet.has(layer.id));
  const ordered = [...selected].sort((a, b) => {
    if (survivorId) {
      if (a.id === survivorId) {
        return -1;
      }
      if (b.id === survivorId) {
        return 1;
      }
    }
    return a.order - b.order;
  });
  return ordered.map((layer) => layer.label).join(' & ');
}
