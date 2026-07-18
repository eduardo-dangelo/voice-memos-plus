import {
  DEFAULT_BPM,
  normalizeLayerEffects,
  type LayerEffects,
} from '@/src/audio/layerEffects';

export type { LayerEffects } from '@/src/audio/layerEffects';

export type Layer = {
  id: string;
  order: number;
  fileName: string;
  label: string;
  color?: string;
  startTime: number;
  duration: number;
  waveformPeaks?: number[];
  effects?: LayerEffects;
};

export function getDefaultLayerLabel(order: number): string {
  return `Track ${order + 1}`;
}

export type Folder = {
  id: string;
  name: string;
  createdAt: string;
  order: number;
};

export type TimeSignaturePreset = '4/4' | '3/4' | '2/4' | '6/8' | '5/4';

export const TIME_SIGNATURE_PRESETS: TimeSignaturePreset[] = [
  '4/4',
  '3/4',
  '2/4',
  '6/8',
  '5/4',
];

export type MetronomeSettings = {
  enabled: boolean;
  bpm: number;
  timeSignature: TimeSignaturePreset;
  accentEnabled: boolean;
  showGrid: boolean;
  volume: number;
};

/** @deprecated Legacy field migrated to timeSignature in normalizeMetronomeSettings */
type LegacyMetronomeSubdivision = '1/4' | '1/8';

type MetronomeSettingsInput = Partial<MetronomeSettings> & {
  subdivision?: LegacyMetronomeSubdivision;
};

export const DEFAULT_METRONOME_SETTINGS: MetronomeSettings = {
  enabled: false,
  bpm: DEFAULT_BPM,
  timeSignature: '4/4',
  accentEnabled: true,
  showGrid: true,
  volume: 70,
};

function isTimeSignaturePreset(value: string): value is TimeSignaturePreset {
  return (TIME_SIGNATURE_PRESETS as string[]).includes(value);
}

export function normalizeMetronomeSettings(
  metronome?: MetronomeSettingsInput
): MetronomeSettings {
  const defaults = DEFAULT_METRONOME_SETTINGS;
  const timeSignature =
    metronome?.timeSignature && isTimeSignaturePreset(metronome.timeSignature)
      ? metronome.timeSignature
      : defaults.timeSignature;

  return {
    enabled: metronome?.enabled ?? defaults.enabled,
    bpm: Math.max(40, Math.min(240, metronome?.bpm ?? defaults.bpm)),
    timeSignature,
    accentEnabled: metronome?.accentEnabled ?? defaults.accentEnabled,
    showGrid: metronome?.showGrid ?? defaults.showGrid,
    volume: Math.max(0, Math.min(100, metronome?.volume ?? defaults.volume)),
  };
}

export function getMemoMetronomeSettings(memo: Pick<Memo, 'metronome'>): MetronomeSettings {
  return normalizeMetronomeSettings(memo.metronome);
}

export type PrecountMode = 'off' | 'sound' | 'silent';

export const PRECOUNT_MODES: PrecountMode[] = ['off', 'silent', 'sound'];

export const DEFAULT_PRECOUNT_MODE: PrecountMode = 'sound';

export function normalizePrecountMode(value?: string | null): PrecountMode {
  if (value === 'sound' || value === 'silent' || value === 'off') {
    return value;
  }
  // Older memos without a stored value stay off.
  return 'off';
}

export function getMemoPrecountMode(memo: Pick<Memo, 'precount'>): PrecountMode {
  return normalizePrecountMode(memo.precount);
}

export function nextPrecountMode(current: PrecountMode): PrecountMode {
  const index = PRECOUNT_MODES.indexOf(current);
  return PRECOUNT_MODES[(index + 1) % PRECOUNT_MODES.length]!;
}

export type MemoTitleSource = 'default' | 'location' | 'user';

export type Memo = {
  id: string;
  title: string;
  titleSource?: MemoTitleSource;
  createdAt: string;
  updatedAt: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  loopStart?: number;
  loopEnd?: number;
  loopEnabled?: boolean;
  metronome?: MetronomeSettings;
  /** Count-in before recording: off → silent → sound */
  precount?: PrecountMode;
  folderId?: string;
  deletedAt?: string;
  layers: Layer[];
};

export const MIN_LOOP_DURATION = 0.25;

export function hasLoopRegion(memo: Pick<Memo, 'loopStart' | 'loopEnd'>): boolean {
  const start = memo.loopStart ?? 0;
  const end = memo.loopEnd ?? 0;
  return end > start + MIN_LOOP_DURATION;
}

export function normalizeLoopRegion(memo: Memo, timelineDuration: number): void {
  if (timelineDuration <= 0) {
    memo.loopStart = 0;
    memo.loopEnd = 0;
    memo.loopEnabled = false;
    return;
  }

  const start = Math.max(0, Math.min(memo.loopStart ?? 0, timelineDuration));
  const end = Math.max(0, Math.min(memo.loopEnd ?? 0, timelineDuration));

  if (end <= start + MIN_LOOP_DURATION) {
    memo.loopStart = 0;
    memo.loopEnd = 0;
    memo.loopEnabled = false;
    return;
  }

  memo.loopStart = start;
  memo.loopEnd = end;
  if (!hasLoopRegion(memo)) {
    memo.loopEnabled = false;
  }
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

export function getLayerFileOffsetAtTimeline(layer: Layer, timelineTime: number): number {
  const effects = getLayerEffects(layer);
  const activeDuration = Math.max(0, effects.trimOut - effects.trimIn);
  const offsetInActiveRegion = timelineTime - layer.startTime;
  const clampedActiveOffset = Math.max(0, Math.min(offsetInActiveRegion, activeDuration));
  return effects.trimIn + clampedActiveOffset;
}

export function getReplaceSpliceParams(
  layer: Layer,
  timelineStart: number,
  recordingDuration: number
): { trimStart: number; trimEnd: number; leadingPadSeconds: number } {
  const effects = getLayerEffects(layer);
  const activeEnd = getLayerActiveEndTime(layer);
  const timelineGap = Math.max(0, timelineStart - activeEnd);

  if (timelineGap > 0) {
    return {
      trimStart: effects.trimOut,
      trimEnd: effects.trimOut,
      leadingPadSeconds: timelineGap,
    };
  }

  const trimStart = getLayerFileOffsetAtTimeline(layer, timelineStart);
  const trimEnd = Math.min(
    trimStart + recordingDuration,
    effects.trimOut,
    layer.duration
  );
  return { trimStart, trimEnd, leadingPadSeconds: 0 };
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
