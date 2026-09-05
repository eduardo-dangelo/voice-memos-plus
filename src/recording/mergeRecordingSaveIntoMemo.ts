import type { Memo } from '@/src/storage/types';

/**
 * Preserve in-editor layer edits when a save notify arrives mid-persist.
 * When the file duration changed (replace / first-take growth), trust disk
 * effects so stale trimOut cannot crop the new waveform.
 */
export function mergeRecordingSaveIntoMemo(incoming: Memo, current: Memo): Memo {
  const currentById = new Map(current.layers.map((layer) => [layer.id, layer]));
  const layers = incoming.layers.map((incomingLayer) => {
    const edited = currentById.get(incomingLayer.id);
    if (!edited) {
      return incomingLayer;
    }
    // Empty pre-record shell shares the first-take layer id — do not clobber
    // saved effects/startTime with trimOut:0 defaults (hollow ~0.5s track UI).
    if (edited.duration <= 0) {
      return {
        ...incomingLayer,
        color: edited.color ?? incomingLayer.color,
        label: edited.label || incomingLayer.label,
      };
    }
    // File rewritten under the editor (replace / longer take) — keep disk
    // footprint; only carry cosmetic fields from the in-memory row.
    if (edited.duration !== incomingLayer.duration) {
      return {
        ...incomingLayer,
        color: edited.color ?? incomingLayer.color,
        label: edited.label || incomingLayer.label,
      };
    }
    return {
      ...incomingLayer,
      startTime: edited.startTime,
      effects: edited.effects ?? incomingLayer.effects,
      color: edited.color ?? incomingLayer.color,
      label: edited.label,
      loopUntil: edited.loopUntil ?? incomingLayer.loopUntil,
    };
  });
  return {
    ...incoming,
    layers,
    loopStart: current.loopStart ?? incoming.loopStart,
    loopEnd: current.loopEnd ?? incoming.loopEnd,
    loopEnabled: current.loopEnabled ?? incoming.loopEnabled,
    loopSnapToGrid: current.loopSnapToGrid ?? incoming.loopSnapToGrid,
  };
}
