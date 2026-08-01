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
export type DelaySync = 'off' | '1/8' | '3/16' | '1/4' | '1/2' | '1/1';

export type DelayPreset =
  | 'off'
  | 'slap'
  | 'echo'
  | 'eighth'
  | 'dotted'
  | 'quarter'
  | 'half'
  | 'full'
  | 'ambient'
  | 'custom';

export const DELAY_PRESETS: DelayPreset[] = [
  'off',
  'slap',
  'echo',
  'eighth',
  'dotted',
  'quarter',
  'half',
  'full',
  'ambient',
  'custom',
];

export type EqPreset =
  | 'off'
  | 'voice'
  | 'warm'
  | 'bright'
  | 'bass'
  | 'highPass'
  | 'custom';

export const EQ_PRESET_IDS: EqPreset[] = [
  'off',
  'voice',
  'warm',
  'bright',
  'bass',
  'highPass',
  'custom',
];

/** Removed from UI; stored IDs remap to `custom` on load (bands preserved). */
const DEPRECATED_EQ_PRESET_IDS = ['podcast', 'treble', 'air', 'muffled', 'lowPass'] as const;

export type LayerReverbEffects = {
  preset: ReverbPreset;
  mix: number;
  decay: number;
};

export type LayerDelayEffects = {
  preset: DelayPreset;
  sync: DelaySync;
  timeMs: number;
  mix: number;
  feedback: number;
};

export type EqBandGains = [number, number, number, number, number];
export type EqBandFrequencies = [number, number, number, number, number];
export type EqBandQFactors = [number, number, number, number, number];

export type LayerEqEffects = {
  preset: EqPreset;
  bands: EqBandGains;
  frequencies: EqBandFrequencies;
  qFactors: EqBandQFactors;
};

export type LayerEffects = {
  trimIn: number;
  trimOut: number;
  volumeDb: number;
  muted?: boolean;
  solo?: boolean;
  /** Fade-in length in seconds from the start of the keep region. */
  fadeInSec: number;
  /** Fade-out length in seconds before the end of the keep region. */
  fadeOutSec: number;
  /** Bipolar curve −1…1 (0 = linear). */
  fadeInCurve: number;
  fadeOutCurve: number;
  reverb: LayerReverbEffects;
  delay: LayerDelayEffects;
  eq: LayerEqEffects;
};

export type LayerEffectsChange = Omit<Partial<LayerEffects>, 'reverb' | 'delay' | 'eq'> & {
  reverb?: Partial<LayerReverbEffects>;
  delay?: Partial<LayerDelayEffects>;
  eq?: Partial<LayerEqEffects>;
};

export const EQ_FREQUENCIES = [100, 250, 1000, 4000, 10000] as const;
export const EQ_MIN_FREQ = 60;
export const EQ_MAX_FREQ = 16000;
export const EQ_MIN_Q = 0.3;
export const EQ_MAX_Q = 8;
export const EQ_DEFAULT_Q = 1;
/** Minimum frequency ratio between neighboring bands (~1/6 octave). */
export const EQ_BAND_MIN_RATIO = Math.pow(2, 1 / 6);
export const DEFAULT_BPM = 100;
export const MIN_TRIM_SELECTION = 0.5;
export const TRIM_SNAP_SECONDS = 0.1;

export function defaultEqFrequencies(): EqBandFrequencies {
  return [...EQ_FREQUENCIES] as EqBandFrequencies;
}

export function defaultEqQFactors(): EqBandQFactors {
  return [
    EQ_DEFAULT_Q,
    EQ_DEFAULT_Q,
    EQ_DEFAULT_Q,
    EQ_DEFAULT_Q,
    EQ_DEFAULT_Q,
  ];
}

export function clampEqQ(q: number): number {
  return Math.max(EQ_MIN_Q, Math.min(EQ_MAX_Q, q));
}

function normalizeEqQFactors(
  stored: Partial<EqBandQFactors> | undefined
): EqBandQFactors {
  const defaults = defaultEqQFactors();
  return [
    clampEqQ(typeof stored?.[0] === 'number' ? stored[0] : defaults[0]),
    clampEqQ(typeof stored?.[1] === 'number' ? stored[1] : defaults[1]),
    clampEqQ(typeof stored?.[2] === 'number' ? stored[2] : defaults[2]),
    clampEqQ(typeof stored?.[3] === 'number' ? stored[3] : defaults[3]),
    clampEqQ(typeof stored?.[4] === 'number' ? stored[4] : defaults[4]),
  ];
}

export function clampEqBandFrequency(
  index: number,
  frequency: number,
  frequencies: EqBandFrequencies
): number {
  const lower =
    index <= 0 ? EQ_MIN_FREQ : frequencies[index - 1] * EQ_BAND_MIN_RATIO;
  const upper =
    index >= frequencies.length - 1
      ? EQ_MAX_FREQ
      : frequencies[index + 1] / EQ_BAND_MIN_RATIO;
  return Math.max(lower, Math.min(upper, frequency));
}

function normalizeEqFrequencies(
  stored: Partial<EqBandFrequencies> | undefined
): EqBandFrequencies {
  const defaults = defaultEqFrequencies();
  const next: EqBandFrequencies = [
    typeof stored?.[0] === 'number' ? stored[0] : defaults[0],
    typeof stored?.[1] === 'number' ? stored[1] : defaults[1],
    typeof stored?.[2] === 'number' ? stored[2] : defaults[2],
    typeof stored?.[3] === 'number' ? stored[3] : defaults[3],
    typeof stored?.[4] === 'number' ? stored[4] : defaults[4],
  ];
  for (let index = 0; index < next.length; index += 1) {
    next[index] = clampEqBandFrequency(index, next[index], next);
  }
  return next;
}

function frequenciesMatchDefaults(frequencies: EqBandFrequencies): boolean {
  return EQ_FREQUENCIES.every(
    (frequency, index) => Math.abs(frequency - frequencies[index]) < 0.5
  );
}

export const REVERB_PRESET_DEFAULTS: Record<
  Exclude<ReverbPreset, 'off' | 'custom'>,
  { mix: number; decay: number }
> = {
  room: { mix: 12, decay: 0.9 },
  hall: { mix: 16, decay: 1.8 },
  plate: { mix: 14, decay: 1.2 },
  chamber: { mix: 10, decay: 0.8 },
  cathedral: { mix: 18, decay: 2.5 },
  spring: { mix: 12, decay: 1.0 },
};

function isReverbPreset(value: unknown): value is ReverbPreset {
  return typeof value === 'string' && REVERB_PRESETS.includes(value as ReverbPreset);
}

function isDelayPreset(value: unknown): value is DelayPreset {
  return typeof value === 'string' && DELAY_PRESETS.includes(value as DelayPreset);
}

function isEqPreset(value: unknown): value is EqPreset {
  return typeof value === 'string' && EQ_PRESET_IDS.includes(value as EqPreset);
}

type NamedEqPreset = Exclude<EqPreset, 'off' | 'custom'>;

export const EQ_PRESETS: Record<NamedEqPreset, [number, number, number, number, number]> = {
  voice: [-2, -1, 2, 3, 1],
  warm: [3, 2, 0, -2, -3],
  bright: [-2, 0, 2, 4, 5],
  bass: [4, 3, 0, -2, -2],
  highPass: [-8, -4, -1, 0, 0],
};

type NamedDelayPreset = Exclude<DelayPreset, 'off' | 'custom'>;

const DELAY_PRESET_SPECS: Record<
  NamedDelayPreset,
  { sync: DelaySync; timeMs: number; mix: number; feedback: number }
> = {
  slap: { sync: 'off', timeMs: 90, mix: 18, feedback: 15 },
  echo: { sync: 'off', timeMs: 400, mix: 30, feedback: 45 },
  eighth: { sync: '1/8', timeMs: 0, mix: 22, feedback: 35 },
  dotted: { sync: '3/16', timeMs: 0, mix: 25, feedback: 40 },
  quarter: { sync: '1/4', timeMs: 0, mix: 28, feedback: 40 },
  half: { sync: '1/2', timeMs: 0, mix: 32, feedback: 45 },
  full: { sync: '1/1', timeMs: 0, mix: 35, feedback: 50 },
  ambient: { sync: 'off', timeMs: 750, mix: 20, feedback: 55 },
};

export function getDelayPresetDefaults(
  preset: NamedDelayPreset,
  bpm = DEFAULT_BPM
): Omit<LayerDelayEffects, 'preset'> {
  const spec = DELAY_PRESET_SPECS[preset];
  const timeMs = spec.sync === 'off' ? spec.timeMs : syncDelayTimeMs(spec.sync, bpm);
  return {
    sync: spec.sync,
    timeMs,
    mix: spec.mix,
    feedback: spec.feedback,
  };
}

function inferEqPreset(
  bands: LayerEqEffects['bands'],
  frequencies: LayerEqEffects['frequencies']
): EqPreset {
  if (!frequenciesMatchDefaults(frequencies)) {
    return 'custom';
  }
  if (bands.every((bandDb) => Math.abs(bandDb) < 0.5)) {
    return 'off';
  }
  const matched = (Object.keys(EQ_PRESETS) as NamedEqPreset[]).find((presetId) =>
    EQ_PRESETS[presetId].every((value, index) => Math.abs(value - bands[index]) < 0.5)
  );
  return matched ?? 'custom';
}

function inferDelayPreset(delay: Partial<LayerDelayEffects>): DelayPreset {
  if (delay.preset != null && isDelayPreset(delay.preset)) {
    return delay.preset;
  }
  if ((delay.mix ?? 0) === 0) {
    return 'off';
  }
  return 'custom';
}

export function createDefaultLayerEffects(duration: number): LayerEffects {
  return {
    trimIn: 0,
    trimOut: duration > 0 ? duration : 0,
    volumeDb: 0,
    muted: false,
    solo: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    fadeInCurve: 0,
    fadeOutCurve: 0,
    reverb: { preset: 'off', mix: 0, decay: 0.8 },
    delay: { preset: 'off', sync: 'off', timeMs: 320, mix: 0, feedback: 40 },
    eq: {
      preset: 'off',
      bands: [0, 0, 0, 0, 0],
      frequencies: defaultEqFrequencies(),
      qFactors: defaultEqQFactors(),
    },
  };
}

export function hasActiveFade(effects: LayerEffects): boolean {
  return effects.fadeInSec > 0 || effects.fadeOutSec > 0;
}

export function hasFullEffectChain(effects: LayerEffects): boolean {
  if (hasActiveReverb(effects)) {
    return true;
  }
  if (hasActiveDelay(effects)) {
    return true;
  }
  return hasActiveEq(effects);
}

export function hasActiveReverb(effects: LayerEffects): boolean {
  return effects.reverb.preset !== 'off' || effects.reverb.mix > 0;
}

export function hasActiveDelay(effects: LayerEffects): boolean {
  return effects.delay.preset !== 'off' || effects.delay.mix > 0;
}

export function hasActiveEq(effects: LayerEffects): boolean {
  if (effects.eq.preset !== 'off') {
    return true;
  }
  return effects.eq.bands.some((bandDb) => bandDb !== 0);
}

export function hasAnySoloActive(effectsList: LayerEffects[]): boolean {
  return effectsList.some((effects) => Boolean(effects.solo));
}

export function isLayerAudible(effects: LayerEffects, anySoloActive: boolean): boolean {
  if (effects.muted) {
    return false;
  }
  if (!anySoloActive) {
    return true;
  }
  return Boolean(effects.solo);
}

export function isLayerSelectable(effects: LayerEffects, anySoloActive: boolean): boolean {
  return isLayerAudible(effects, anySoloActive);
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

  const delayPreset = (() => {
    const stored = layer.effects.delay;
    if (stored?.preset != null && isDelayPreset(stored.preset)) {
      return stored.preset;
    }
    return inferDelayPreset(stored ?? {});
  })();

  const eqBands: LayerEqEffects['bands'] = [
    layer.effects.eq?.bands?.[0] ?? 0,
    layer.effects.eq?.bands?.[1] ?? 0,
    layer.effects.eq?.bands?.[2] ?? 0,
    layer.effects.eq?.bands?.[3] ?? 0,
    layer.effects.eq?.bands?.[4] ?? 0,
  ];
  const eqFrequencies = normalizeEqFrequencies(layer.effects.eq?.frequencies);
  const eqQFactors = normalizeEqQFactors(layer.effects.eq?.qFactors);

  const eqPreset = (() => {
    const storedPreset = layer.effects.eq?.preset;
    if (
      typeof storedPreset === 'string' &&
      (DEPRECATED_EQ_PRESET_IDS as readonly string[]).includes(storedPreset)
    ) {
      return 'custom';
    }
    if (storedPreset != null && isEqPreset(storedPreset)) {
      return storedPreset;
    }
    return inferEqPreset(eqBands, eqFrequencies);
  })();

  const activeDuration = Math.max(0, (layer.duration > 0 ? trimOut : defaults.trimOut) - trimIn);
  const fadeInSec = Math.max(0, layer.effects.fadeInSec ?? 0);
  const fadeOutSec = Math.max(0, layer.effects.fadeOutSec ?? 0);
  const fadeBudget = fadeInSec + fadeOutSec;
  const scaledFadeIn =
    fadeBudget > activeDuration && fadeBudget > 0
      ? (fadeInSec / fadeBudget) * activeDuration
      : Math.min(fadeInSec, activeDuration);
  const scaledFadeOut =
    fadeBudget > activeDuration && fadeBudget > 0
      ? (fadeOutSec / fadeBudget) * activeDuration
      : Math.min(fadeOutSec, activeDuration - scaledFadeIn);

  return {
    trimIn,
    trimOut: layer.duration > 0 ? trimOut : defaults.trimOut,
    volumeDb: layer.effects.volumeDb ?? 0,
    muted: layer.effects.muted ?? false,
    solo: layer.effects.solo ?? false,
    fadeInSec: scaledFadeIn,
    fadeOutSec: scaledFadeOut,
    fadeInCurve: clampFadeCurveValue(layer.effects.fadeInCurve ?? 0),
    fadeOutCurve: clampFadeCurveValue(layer.effects.fadeOutCurve ?? 0),
    reverb: {
      preset: reverbPreset,
      mix:
        reverbPreset === 'off'
          ? 0
          : (layer.effects.reverb?.mix ?? defaults.reverb.mix),
      decay: layer.effects.reverb?.decay ?? defaults.reverb.decay,
    },
    delay: {
      preset: delayPreset,
      sync: layer.effects.delay?.sync ?? defaults.delay.sync,
      timeMs: layer.effects.delay?.timeMs ?? defaults.delay.timeMs,
      mix:
        delayPreset === 'off'
          ? 0
          : (layer.effects.delay?.mix ?? defaults.delay.mix),
      feedback: layer.effects.delay?.feedback ?? defaults.delay.feedback,
    },
    eq: {
      preset: eqPreset,
      bands: eqBands,
      frequencies: eqFrequencies,
      qFactors: eqQFactors,
    },
  };
}

function clampFadeCurveValue(curve: number): number {
  if (!Number.isFinite(curve)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, curve));
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
      preset: partial.eq?.preset ?? current.eq.preset,
      bands: partial.eq?.bands
        ? ([
            partial.eq.bands[0] ?? current.eq.bands[0],
            partial.eq.bands[1] ?? current.eq.bands[1],
            partial.eq.bands[2] ?? current.eq.bands[2],
            partial.eq.bands[3] ?? current.eq.bands[3],
            partial.eq.bands[4] ?? current.eq.bands[4],
          ] as LayerEqEffects['bands'])
        : current.eq.bands,
      frequencies: partial.eq?.frequencies
        ? normalizeEqFrequencies([
            partial.eq.frequencies[0] ?? current.eq.frequencies[0],
            partial.eq.frequencies[1] ?? current.eq.frequencies[1],
            partial.eq.frequencies[2] ?? current.eq.frequencies[2],
            partial.eq.frequencies[3] ?? current.eq.frequencies[3],
            partial.eq.frequencies[4] ?? current.eq.frequencies[4],
          ])
        : current.eq.frequencies,
      qFactors: partial.eq?.qFactors
        ? normalizeEqQFactors([
            partial.eq.qFactors[0] ?? current.eq.qFactors[0],
            partial.eq.qFactors[1] ?? current.eq.qFactors[1],
            partial.eq.qFactors[2] ?? current.eq.qFactors[2],
            partial.eq.qFactors[3] ?? current.eq.qFactors[3],
            partial.eq.qFactors[4] ?? current.eq.qFactors[4],
          ])
        : current.eq.qFactors,
    },
  };

  if (layerDuration > 0) {
    merged.trimIn = Math.max(0, Math.min(merged.trimIn, layerDuration - MIN_TRIM_SELECTION));
    merged.trimOut = Math.min(
      layerDuration,
      Math.max(merged.trimIn + MIN_TRIM_SELECTION, merged.trimOut)
    );
  }

  const activeDuration = Math.max(0, merged.trimOut - merged.trimIn);
  let fadeInSec = Math.max(0, merged.fadeInSec ?? 0);
  let fadeOutSec = Math.max(0, merged.fadeOutSec ?? 0);
  if (fadeInSec + fadeOutSec > activeDuration && fadeInSec + fadeOutSec > 0) {
    const total = fadeInSec + fadeOutSec;
    fadeInSec = (fadeInSec / total) * activeDuration;
    fadeOutSec = (fadeOutSec / total) * activeDuration;
  } else {
    fadeInSec = Math.min(fadeInSec, activeDuration);
    fadeOutSec = Math.min(fadeOutSec, activeDuration - fadeInSec);
  }
  merged.fadeInSec = fadeInSec;
  merged.fadeOutSec = fadeOutSec;
  merged.fadeInCurve = clampFadeCurveValue(merged.fadeInCurve ?? 0);
  merged.fadeOutCurve = clampFadeCurveValue(merged.fadeOutCurve ?? 0);

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
    '3/16': 0.75,
    '1/4': 1,
    '1/2': 2,
    '1/1': 4,
  };
  return Math.round(beatMs * multipliers[sync]);
}

export function clampTrimValues(
  trimIn: number,
  trimOut: number,
  layerDuration: number,
  quantizeSec: number | null = TRIM_SNAP_SECONDS
): { trimIn: number; trimOut: number } {
  const quantizedIn =
    quantizeSec != null && quantizeSec > 0
      ? Math.round(trimIn / quantizeSec) * quantizeSec
      : trimIn;
  const quantizedOut =
    quantizeSec != null && quantizeSec > 0
      ? Math.round(trimOut / quantizeSec) * quantizeSec
      : trimOut;
  const clampedIn = Math.max(0, Math.min(quantizedIn, layerDuration - MIN_TRIM_SELECTION));
  const clampedOut = Math.min(
    layerDuration,
    Math.max(quantizedOut, clampedIn + MIN_TRIM_SELECTION)
  );
  return { trimIn: clampedIn, trimOut: clampedOut };
}

export function formatEqBand(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

export function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    const kilo = hz / 1000;
    const rounded = kilo >= 10 ? Math.round(kilo) : Math.round(kilo * 10) / 10;
    return `${rounded}k`;
  }
  return `${Math.round(hz)}`;
}
