export type ReverbPreset =
  | 'off'
  | 'room'
  | 'hall'
  | 'plate'
  | 'chamber'
  | 'cathedral'
  | 'spring'
  | 'custom';

export const REVERB_PRESETS: ReverbPreset[] = [
  'off',
  'room',
  'hall',
  'plate',
  'chamber',
  'cathedral',
  'spring',
  'custom',
];
export type DelaySync = 'off' | '1/8' | '1/4' | '1/2' | '1/1';

export type LayerReverbEffects = {
  preset: ReverbPreset;
  mix: number;
  decay: number;
};

export type LayerDelayEffects = {
  sync: DelaySync;
  timeMs: number;
  mix: number;
  feedback: number;
};

export type LayerEqEffects = {
  bands: [number, number, number, number, number];
};

export type LayerEffects = {
  trimIn: number;
  trimOut: number;
  volumeDb: number;
  reverb: LayerReverbEffects;
  delay: LayerDelayEffects;
  eq: LayerEqEffects;
};

export const EQ_FREQUENCIES = [100, 250, 1000, 4000, 10000] as const;
export const DEFAULT_BPM = 120;
export const MIN_TRIM_SELECTION = 0.5;
export const TRIM_SNAP_SECONDS = 0.1;

export const REVERB_PRESET_DEFAULTS: Record<
  Exclude<ReverbPreset, 'off' | 'custom'>,
  { mix: number; decay: number }
> = {
  room: { mix: 25, decay: 0.6 },
  hall: { mix: 35, decay: 1.8 },
  plate: { mix: 30, decay: 1.2 },
  chamber: { mix: 20, decay: 0.4 },
  cathedral: { mix: 40, decay: 2.5 },
  spring: { mix: 28, decay: 1.0 },
};

function isReverbPreset(value: unknown): value is ReverbPreset {
  return typeof value === 'string' && REVERB_PRESETS.includes(value as ReverbPreset);
}

export const EQ_PRESETS: Record<string, [number, number, number, number, number]> = {
  flat: [0, 0, 0, 0, 0],
  voice: [2, 1, 3, 2, -2],
  warm: [4, 2, 0, -2, -3],
  bright: [-2, 0, 2, 4, 5],
};

export function createDefaultLayerEffects(duration: number): LayerEffects {
  return {
    trimIn: 0,
    trimOut: duration > 0 ? duration : 0,
    volumeDb: 0,
    reverb: { preset: 'off', mix: 0, decay: 0.8 },
    delay: { sync: 'off', timeMs: 320, mix: 0, feedback: 40 },
    eq: { bands: [0, 0, 0, 0, 0] },
  };
}

export function getEffectiveLayerDuration(effects: LayerEffects): number {
  return Math.max(0, effects.trimOut - effects.trimIn);
}

export function isDefaultTrim(effects: LayerEffects, layerDuration: number): boolean {
  return effects.trimIn <= 0.01 && effects.trimOut >= layerDuration - 0.01;
}

export function hasFullEffectChain(effects: LayerEffects): boolean {
  if (effects.reverb.preset !== 'off' || effects.reverb.mix > 0) {
    return true;
  }
  if (effects.delay.mix > 0) {
    return true;
  }
  return effects.eq.bands.some((bandDb) => bandDb !== 0);
}

export function normalizeLayerEffects(
  layer: { duration: number; effects?: LayerEffects }
): LayerEffects {
  const defaults = createDefaultLayerEffects(layer.duration);
  if (!layer.effects) {
    return defaults;
  }

  const trimIn = Math.max(0, layer.effects.trimIn ?? 0);
  const trimOut = Math.min(
    layer.duration > 0 ? layer.duration : defaults.trimOut,
    Math.max(trimIn + MIN_TRIM_SELECTION, layer.effects.trimOut ?? layer.duration)
  );

  const reverbPreset = (() => {
    const storedPreset = layer.effects.reverb?.preset;
    if (storedPreset == null) {
      return defaults.reverb.preset;
    }
    return isReverbPreset(storedPreset) ? storedPreset : 'room';
  })();

  return {
    trimIn,
    trimOut: layer.duration > 0 ? trimOut : defaults.trimOut,
    volumeDb: layer.effects.volumeDb ?? 0,
    reverb: {
      preset: reverbPreset,
      mix:
        reverbPreset === 'off'
          ? 0
          : (layer.effects.reverb?.mix ?? defaults.reverb.mix),
      decay: layer.effects.reverb?.decay ?? defaults.reverb.decay,
    },
    delay: {
      sync: layer.effects.delay?.sync ?? defaults.delay.sync,
      timeMs: layer.effects.delay?.timeMs ?? defaults.delay.timeMs,
      mix: layer.effects.delay?.mix ?? defaults.delay.mix,
      feedback: layer.effects.delay?.feedback ?? defaults.delay.feedback,
    },
    eq: {
      bands: [
        layer.effects.eq?.bands?.[0] ?? 0,
        layer.effects.eq?.bands?.[1] ?? 0,
        layer.effects.eq?.bands?.[2] ?? 0,
        layer.effects.eq?.bands?.[3] ?? 0,
        layer.effects.eq?.bands?.[4] ?? 0,
      ],
    },
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function mergeLayerEffects(
  current: LayerEffects,
  partial: DeepPartial<LayerEffects>,
  layerDuration: number
): LayerEffects {
  const merged: LayerEffects = {
    ...current,
    ...partial,
    reverb: { ...current.reverb, ...partial.reverb },
    delay: { ...current.delay, ...partial.delay },
    eq: {
      bands: partial.eq?.bands
        ? ([
            partial.eq.bands[0] ?? current.eq.bands[0],
            partial.eq.bands[1] ?? current.eq.bands[1],
            partial.eq.bands[2] ?? current.eq.bands[2],
            partial.eq.bands[3] ?? current.eq.bands[3],
            partial.eq.bands[4] ?? current.eq.bands[4],
          ] as LayerEqEffects['bands'])
        : current.eq.bands,
    },
  };

  if (layerDuration > 0) {
    merged.trimIn = Math.max(0, Math.min(merged.trimIn, layerDuration - MIN_TRIM_SELECTION));
    merged.trimOut = Math.min(
      layerDuration,
      Math.max(merged.trimIn + MIN_TRIM_SELECTION, merged.trimOut)
    );
  }

  return merged;
}

export function dbToLinear(db: number): number {
  if (db <= -24) {
    return 0;
  }
  return Math.pow(10, db / 20);
}

export function syncDelayTimeMs(sync: DelaySync, bpm = DEFAULT_BPM): number {
  if (sync === 'off') {
    return 320;
  }
  const beatMs = 60000 / bpm;
  const multipliers: Record<Exclude<DelaySync, 'off'>, number> = {
    '1/8': 0.5,
    '1/4': 1,
    '1/2': 2,
    '1/1': 4,
  };
  return Math.round(beatMs * multipliers[sync]);
}

export function clampTrimValues(
  trimIn: number,
  trimOut: number,
  layerDuration: number
): { trimIn: number; trimOut: number } {
  const snappedIn = Math.round(trimIn / TRIM_SNAP_SECONDS) * TRIM_SNAP_SECONDS;
  const snappedOut = Math.round(trimOut / TRIM_SNAP_SECONDS) * TRIM_SNAP_SECONDS;
  const clampedIn = Math.max(0, Math.min(snappedIn, layerDuration - MIN_TRIM_SELECTION));
  const clampedOut = Math.min(
    layerDuration,
    Math.max(snappedOut, clampedIn + MIN_TRIM_SELECTION)
  );
  return { trimIn: clampedIn, trimOut: clampedOut };
}

export function shiftTrimWindow(
  trimIn: number,
  trimOut: number,
  deltaSec: number,
  layerDuration: number
): { trimIn: number; trimOut: number } {
  const width = Math.max(MIN_TRIM_SELECTION, trimOut - trimIn);
  let nextIn = trimIn + deltaSec;
  nextIn = Math.max(0, Math.min(nextIn, layerDuration - width));
  return clampTrimValues(nextIn, nextIn + width, layerDuration);
}

export function formatDb(value: number): string {
  if (value <= -24) {
    return 'Mute';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} dB`;
}

export function formatEqBand(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value)}`;
}

export function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    return `${hz / 1000}k`;
  }
  return `${hz}`;
}
