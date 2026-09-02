import type { AudioBuffer, AudioBufferSourceNode, AudioContext, GainNode } from 'react-native-audio-api';

import {
  METRONOME_GRID_SUBDIVISIONS,
  TIME_GRID_SUBDIVISIONS,
  type MetronomeGridSubdivision,
  type MetronomeSettings,
  type TimeGridSubdivision,
  type TimeSignaturePreset,
} from '@/src/storage/types';

/** Short enough to stay clicky; long enough for a clean attack/release. */
export const CLICK_DURATION_SEC = 0.022;
const CLICK_ATTACK_SEC = 0.0015;
const CLICK_RELEASE_SEC = 0.006;
const NORMAL_CLICK_FREQ = 1000;
const ACCENT_CLICK_FREQ = 1500;
/** Peaks leave headphone headroom; volume is applied once on the metronome bus. */
export const NORMAL_AMPLITUDE = 0.38;
export const ACCENT_AMPLITUDE = 0.58;
export const SECONDARY_ACCENT_GAIN = 0.75;
const TIME_EPSILON = 0.0001;

type BeatUnit = 'quarter' | 'eighth';

type TimeSignatureConfig = {
  clicksPerBar: number;
  beatUnit: BeatUnit;
  secondaryAccentAt?: number;
};

export const TIME_SIGNATURES: Record<TimeSignaturePreset, TimeSignatureConfig> = {
  '4/4': { clicksPerBar: 4, beatUnit: 'quarter' },
  '3/4': { clicksPerBar: 3, beatUnit: 'quarter' },
  '2/4': { clicksPerBar: 2, beatUnit: 'quarter' },
  '6/8': { clicksPerBar: 6, beatUnit: 'eighth', secondaryAccentAt: 3 },
  '5/4': { clicksPerBar: 5, beatUnit: 'quarter' },
};

const normalClickCache = new WeakMap<AudioContext, AudioBuffer>();
const accentClickCache = new WeakMap<AudioContext, AudioBuffer>();
const secondaryAccentClickCache = new WeakMap<AudioContext, AudioBuffer>();
const silentPrimeCache = new WeakMap<AudioContext, AudioBuffer>();

/** Match metronome preview lead so one-shot precount clicks are not dropped. */
export const PRECOUNT_CLICK_LEAD_SEC = 0.05;
/** Short silent buffer to wake Bluetooth A2DP before the first audible click. */
const SILENT_PRIME_DURATION_SEC = 0.04;

/**
 * Synthesize a soft-edged sine click. Attack/release avoid the harsh crack
 * that headphones exaggerate on near-instant envelopes.
 */
export function synthesizeClickSamples(
  sampleRate: number,
  frequency: number,
  amplitude: number
): Float32Array {
  const length = Math.max(1, Math.ceil(sampleRate * CLICK_DURATION_SEC));
  const data = new Float32Array(length);
  const attackEnd = Math.min(CLICK_DURATION_SEC, CLICK_ATTACK_SEC);
  const releaseStart = Math.max(0, CLICK_DURATION_SEC - CLICK_RELEASE_SEC);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let envelope = Math.exp(-t * 160);
    if (t < attackEnd && attackEnd > 0) {
      envelope *= t / attackEnd;
    }
    if (t >= releaseStart && CLICK_DURATION_SEC > releaseStart) {
      const releaseT = (t - releaseStart) / (CLICK_DURATION_SEC - releaseStart);
      envelope *= 1 - releaseT;
    }
    data[i] = Math.sin(2 * Math.PI * frequency * t) * amplitude * envelope;
  }

  return data;
}

function createClickBuffer(
  context: AudioContext,
  frequency: number,
  amplitude: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const samples = synthesizeClickSamples(sampleRate, frequency, amplitude);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  const data = buffer.getChannelData(0);
  data.set(samples);
  return buffer;
}

function getNormalClickBuffer(context: AudioContext): AudioBuffer {
  let buffer = normalClickCache.get(context);
  if (!buffer) {
    buffer = createClickBuffer(context, NORMAL_CLICK_FREQ, NORMAL_AMPLITUDE);
    normalClickCache.set(context, buffer);
  }
  return buffer;
}

function getAccentClickBuffer(context: AudioContext): AudioBuffer {
  let buffer = accentClickCache.get(context);
  if (!buffer) {
    buffer = createClickBuffer(context, ACCENT_CLICK_FREQ, ACCENT_AMPLITUDE);
    accentClickCache.set(context, buffer);
  }
  return buffer;
}

/** Accent click with secondary gain baked in — avoids per-click GainNodes. */
function getSecondaryAccentClickBuffer(context: AudioContext): AudioBuffer {
  let buffer = secondaryAccentClickCache.get(context);
  if (!buffer) {
    buffer = createClickBuffer(
      context,
      ACCENT_CLICK_FREQ,
      ACCENT_AMPLITUDE * SECONDARY_ACCENT_GAIN
    );
    secondaryAccentClickCache.set(context, buffer);
  }
  return buffer;
}

function getSilentPrimeBuffer(context: AudioContext): AudioBuffer {
  let buffer = silentPrimeCache.get(context);
  if (!buffer) {
    const length = Math.max(1, Math.ceil(context.sampleRate * SILENT_PRIME_DURATION_SEC));
    buffer = context.createBuffer(1, length, context.sampleRate);
    // Channel data stays zero — true silence for A2DP wake without a pop.
    silentPrimeCache.set(context, buffer);
  }
  return buffer;
}

/** Pre-build click buffers so the first precount accent does not pay synthesis cost. */
export function prewarmMetronomeClickBuffers(context: AudioContext): void {
  getNormalClickBuffer(context);
  getAccentClickBuffer(context);
}

/** Schedule a short silent buffer on the metronome bus to warm the output route. */
export function playSilentMetronomePrime(
  context: AudioContext,
  outputGain: GainNode
): AudioBufferSourceNode {
  const buffer = getSilentPrimeBuffer(context);
  const when = context.currentTime + 0.01;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(outputGain);
  source.start(when);
  source.stop(when + SILENT_PRIME_DURATION_SEC);
  return source;
}

export function getTimeSignatureConfig(timeSignature: TimeSignaturePreset): TimeSignatureConfig {
  return TIME_SIGNATURES[timeSignature];
}

export function getClickIntervalSec(settings: MetronomeSettings): number {
  const config = getTimeSignatureConfig(settings.timeSignature);
  const quarterInterval = 60 / settings.bpm;
  return config.beatUnit === 'eighth' ? quarterInterval / 2 : quarterInterval;
}

/** One bar of click grid, in seconds (integer-sample buffers round this). */
export function getMetronomeBarDurationSec(settings: MetronomeSettings): number {
  const config = getTimeSignatureConfig(settings.timeSignature);
  return getClickIntervalSec(settings) * config.clicksPerBar;
}

/** Phase into the repeating bar at `timelineTime` (seconds). */
export function getMetronomeBarOffsetSec(
  timelineTime: number,
  barDurationSec: number
): number {
  if (!(barDurationSec > 0) || !Number.isFinite(timelineTime)) {
    return 0;
  }
  const wrapped = timelineTime % barDurationSec;
  if (!Number.isFinite(wrapped)) {
    return 0;
  }
  return wrapped < 0 ? wrapped + barDurationSec : wrapped;
}

/** Mix accent/normal clicks into one bar of samples (no AudioContext). */
export function mixMetronomeBarSamples(
  sampleRate: number,
  settings: MetronomeSettings
): Float32Array {
  const barSec = getMetronomeBarDurationSec(settings);
  const length = Math.max(1, Math.round(barSec * sampleRate));
  const data = new Float32Array(length);
  if (!(barSec > 0) || !(sampleRate > 0)) {
    return data;
  }

  const config = getTimeSignatureConfig(settings.timeSignature);
  const interval = getClickIntervalSec(settings);
  const normal = synthesizeClickSamples(sampleRate, NORMAL_CLICK_FREQ, NORMAL_AMPLITUDE);
  const accent = synthesizeClickSamples(sampleRate, ACCENT_CLICK_FREQ, ACCENT_AMPLITUDE);
  const secondary = synthesizeClickSamples(
    sampleRate,
    ACCENT_CLICK_FREQ,
    ACCENT_AMPLITUDE * SECONDARY_ACCENT_GAIN
  );

  for (let clickIndex = 0; clickIndex < config.clicksPerBar; clickIndex += 1) {
    const beatTime = clickIndex * interval;
    const startSample = Math.round(beatTime * sampleRate);
    const isPrimary = settings.accentEnabled && clickIndex === 0;
    const isSecondary =
      settings.accentEnabled &&
      config.secondaryAccentAt !== undefined &&
      clickIndex === config.secondaryAccentAt;
    const samples = isPrimary ? accent : isSecondary ? secondary : normal;
    const copyCount = Math.min(samples.length, length - startSample);
    for (let i = 0; i < copyCount; i += 1) {
      data[startSample + i] += samples[i]!;
    }
  }
  return data;
}

const metronomeBarBufferCache = new WeakMap<AudioContext, Map<string, AudioBuffer>>();

function metronomeBarCacheKey(settings: MetronomeSettings): string {
  return `${settings.bpm}|${settings.timeSignature}|${settings.accentEnabled ? 1 : 0}`;
}

function getMetronomeBarBuffer(
  context: AudioContext,
  settings: MetronomeSettings
): AudioBuffer {
  let byKey = metronomeBarBufferCache.get(context);
  if (!byKey) {
    byKey = new Map();
    metronomeBarBufferCache.set(context, byKey);
  }
  const key = metronomeBarCacheKey(settings);
  const cached = byKey.get(key);
  if (cached) {
    return cached;
  }

  const samples = mixMetronomeBarSamples(context.sampleRate, settings);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  byKey.set(key, buffer);
  return buffer;
}

/**
 * One looping bar of clicks (Logic click-track analog). `stopWhen` omitted
 * while recording so the bar runs until sources are stopped.
 */
export function scheduleLoopingMetronomeBar(
  context: AudioContext,
  outputGain: GainNode,
  settings: MetronomeSettings,
  startAt: number,
  startWhen: number,
  stopWhen?: number
): AudioBufferSourceNode | null {
  if (!settings.enabled) {
    return null;
  }

  const buffer = getMetronomeBarBuffer(context, settings);
  if (buffer.duration <= 0) {
    return null;
  }

  const barSec = getMetronomeBarDurationSec(settings);
  const phase = getMetronomeBarOffsetSec(startAt, barSec);
  const offset = Math.min(
    barSec > 0 ? (phase / barSec) * buffer.duration : 0,
    Math.max(0, buffer.duration - 1 / Math.max(1, context.sampleRate))
  );

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = buffer.duration;
  source.connect(outputGain);
  source.start(startWhen, offset);
  if (stopWhen != null && stopWhen > startWhen) {
    source.stop(stopWhen);
  }
  return source;
}

const METRONOME_GRID_SUBDIVISION_DIVISOR: Record<MetronomeGridSubdivision, number> = {
  '1/4': 1,
  '1/8': 2,
  '1/16': 4,
  '1/32': 8,
};

const TIME_GRID_INTERVAL_SEC: Record<TimeGridSubdivision, number> = {
  '1s': 1,
  '0.5s': 0.5,
  '0.25s': 0.25,
  '0.125s': 0.125,
};

const TIME_GRID_LOD_LADDER_SEC = [0.125, 0.25, 0.5, 1] as const;

/** Finest visual/snap interval for the current grid basis and subdivision. */
export function getGridFinestIntervalSec(settings: MetronomeSettings): number {
  if (settings.gridBasis === 'time') {
    return TIME_GRID_INTERVAL_SEC[settings.timeGridSubdivision];
  }
  return (
    getClickIntervalSec(settings) /
    METRONOME_GRID_SUBDIVISION_DIVISOR[settings.metronomeGridSubdivision]
  );
}

/** Snap step when the grid is visible; null when the overlay is off. */
export function getGridSnapIntervalSec(settings: MetronomeSettings): number | null {
  if (!settings.showGrid) {
    return null;
  }
  return getGridFinestIntervalSec(settings);
}

/** Minimum pixels/second so the finest grid step meets METRONOME_GRID_AUTO_ZOOM_SPACING_PX. */
export function getMinPixelsPerSecondForGrid(settings: MetronomeSettings): number {
  const interval = getGridFinestIntervalSec(settings);
  if (interval <= 0) {
    return 0;
  }
  return METRONOME_GRID_AUTO_ZOOM_SPACING_PX / interval;
}

const PPS_MAX_EPSILON = 0.5;

function pickFinestSubdivisionForPixelsPerSecond<T extends string>(
  options: readonly T[],
  pixelsPerSecond: number,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number,
  minPixelsPerSecondFor: (subdivision: T) => number
): T {
  const coarsest = options[0]!;
  const finest = options[options.length - 1]!;

  if (pixelsPerSecond <= pixelsPerSecondDefault + TIME_EPSILON) {
    return coarsest;
  }
  if (pixelsPerSecond >= pixelsPerSecondMax - PPS_MAX_EPSILON) {
    return finest;
  }

  let chosen = coarsest;
  for (const subdivision of options) {
    const needed = minPixelsPerSecondFor(subdivision);
    if (needed > 0 && pixelsPerSecond >= needed - TIME_EPSILON) {
      chosen = subdivision;
    }
  }
  return chosen;
}

export function pickMetronomeGridSubdivisionForPixelsPerSecond(
  settings: MetronomeSettings,
  pixelsPerSecond: number,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number
): MetronomeGridSubdivision {
  return pickFinestSubdivisionForPixelsPerSecond(
    METRONOME_GRID_SUBDIVISIONS,
    pixelsPerSecond,
    pixelsPerSecondDefault,
    pixelsPerSecondMax,
    (metronomeGridSubdivision) =>
      getMinPixelsPerSecondForGrid({
        ...settings,
        gridBasis: 'metronome',
        metronomeGridSubdivision,
      })
  );
}

export function pickTimeGridSubdivisionForPixelsPerSecond(
  settings: MetronomeSettings,
  pixelsPerSecond: number,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number
): TimeGridSubdivision {
  return pickFinestSubdivisionForPixelsPerSecond(
    TIME_GRID_SUBDIVISIONS,
    pixelsPerSecond,
    pixelsPerSecondDefault,
    pixelsPerSecondMax,
    (timeGridSubdivision) =>
      getMinPixelsPerSecondForGrid({
        ...settings,
        gridBasis: 'time',
        timeGridSubdivision,
      })
  );
}

/** Stable pixels/second inside the zoom bucket for a subdivision option. */
function getCanonicalPixelsPerSecondForSubdivisionOption<T extends string>(
  options: readonly T[],
  subdivision: T,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number,
  minPixelsPerSecondFor: (subdivision: T) => number
): number {
  const index = options.indexOf(subdivision);
  if (index < 0) {
    return pixelsPerSecondDefault;
  }

  if (index === 0) {
    return pixelsPerSecondDefault;
  }

  if (index === options.length - 1) {
    return pixelsPerSecondMax;
  }

  const minCurrent = minPixelsPerSecondFor(subdivision);
  const minNext = minPixelsPerSecondFor(options[index + 1]!);
  return (minCurrent + minNext) / 2;
}

export function getMetronomeGridPixelsPerSecondForSubdivision(
  settings: MetronomeSettings,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number
): number {
  return getCanonicalPixelsPerSecondForSubdivisionOption(
    METRONOME_GRID_SUBDIVISIONS,
    settings.metronomeGridSubdivision,
    pixelsPerSecondDefault,
    pixelsPerSecondMax,
    (metronomeGridSubdivision) =>
      getMinPixelsPerSecondForGrid({
        ...settings,
        gridBasis: 'metronome',
        metronomeGridSubdivision,
      })
  );
}

export function getTimeGridPixelsPerSecondForSubdivision(
  settings: MetronomeSettings,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number
): number {
  return getCanonicalPixelsPerSecondForSubdivisionOption(
    TIME_GRID_SUBDIVISIONS,
    settings.timeGridSubdivision,
    pixelsPerSecondDefault,
    pixelsPerSecondMax,
    (timeGridSubdivision) =>
      getMinPixelsPerSecondForGrid({
        ...settings,
        gridBasis: 'time',
        timeGridSubdivision,
      })
  );
}

/** Canonical horizontal zoom for the active grid subdivision (round-trips with pickGridSubdivisionForPixelsPerSecond). */
export function getPixelsPerSecondForGridSubdivision(
  settings: MetronomeSettings,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number
): number {
  if (settings.gridBasis === 'time') {
    return getTimeGridPixelsPerSecondForSubdivision(
      settings,
      pixelsPerSecondDefault,
      pixelsPerSecondMax
    );
  }
  return getMetronomeGridPixelsPerSecondForSubdivision(
    settings,
    pixelsPerSecondDefault,
    pixelsPerSecondMax
  );
}

export function pickGridSubdivisionForPixelsPerSecond(
  settings: MetronomeSettings,
  pixelsPerSecond: number,
  pixelsPerSecondDefault: number,
  pixelsPerSecondMax: number
): Pick<MetronomeSettings, 'metronomeGridSubdivision' | 'timeGridSubdivision'> {
  if (settings.gridBasis === 'time') {
    return {
      metronomeGridSubdivision: settings.metronomeGridSubdivision,
      timeGridSubdivision: pickTimeGridSubdivisionForPixelsPerSecond(
        settings,
        pixelsPerSecond,
        pixelsPerSecondDefault,
        pixelsPerSecondMax
      ),
    };
  }
  return {
    metronomeGridSubdivision: pickMetronomeGridSubdivisionForPixelsPerSecond(
      settings,
      pixelsPerSecond,
      pixelsPerSecondDefault,
      pixelsPerSecondMax
    ),
    timeGridSubdivision: settings.timeGridSubdivision,
  };
}

export function getQuarterIntervalSec(bpm: number): number {
  return 60 / bpm;
}

export function getClickIndexAtTime(beatTime: number, interval: number): number {
  return Math.round(beatTime / interval);
}

export function isPrimaryAccentBeat(beatTime: number, settings: MetronomeSettings): boolean {
  if (!settings.accentEnabled) {
    return false;
  }
  const config = getTimeSignatureConfig(settings.timeSignature);
  const interval = getClickIntervalSec(settings);
  const clickIndex = getClickIndexAtTime(beatTime, interval);
  return clickIndex % config.clicksPerBar === 0;
}

export function isSecondaryAccentBeat(beatTime: number, settings: MetronomeSettings): boolean {
  if (!settings.accentEnabled) {
    return false;
  }
  const config = getTimeSignatureConfig(settings.timeSignature);
  if (config.secondaryAccentAt === undefined) {
    return false;
  }
  const interval = getClickIntervalSec(settings);
  const clickIndex = getClickIndexAtTime(beatTime, interval);
  return clickIndex % config.clicksPerBar === config.secondaryAccentAt;
}

export type MetronomeGridLineKind = 'bar' | 'secondary' | 'beat';

export type MetronomeGridLine = {
  time: number;
  kind: MetronomeGridLineKind;
};

/** Minimum pixel spacing between adjacent grid lines before LOD thins further. */
export const METRONOME_GRID_MIN_SPACING_PX = 10;

/** Target spacing for auto-zoom (~3.3× at 1/16, ~6.7× at 1/32 vs 1× = 48 pps). */
export const METRONOME_GRID_AUTO_ZOOM_SPACING_PX = METRONOME_GRID_MIN_SPACING_PX * 2;

/** Hard cap on lines returned for a single buffer window. */
export const METRONOME_GRID_MAX_LINES = 80;

function collectBeatTimesInRange(startAt: number, endAt: number, interval: number): number[] {
  if (endAt <= startAt + TIME_EPSILON || interval <= 0) {
    return [];
  }

  const beatTimes: number[] = [];
  let beatTime = Math.ceil((startAt - TIME_EPSILON) / interval) * interval;
  if (beatTime < startAt - TIME_EPSILON) {
    beatTime += interval;
  }

  while (beatTime < endAt - TIME_EPSILON) {
    beatTimes.push(Math.max(0, beatTime));
    beatTime += interval;
  }

  return beatTimes;
}

export function getMetronomeBeatTimes(
  settings: MetronomeSettings,
  startAt: number,
  endAt: number
): number[] {
  if (!settings.enabled) {
    return [];
  }
  return collectBeatTimesInRange(startAt, endAt, getClickIntervalSec(settings));
}

export function getMetronomeGridLineKind(
  beatTime: number,
  settings: MetronomeSettings
): MetronomeGridLineKind {
  if (isPrimaryAccentBeat(beatTime, settings)) {
    return 'bar';
  }
  if (isSecondaryAccentBeat(beatTime, settings)) {
    return 'secondary';
  }
  return 'beat';
}

function pickStepWithMinSpacing(candidates: number[], pixelsPerSecond: number): number {
  const minSpacing = METRONOME_GRID_MIN_SPACING_PX;
  for (const step of candidates) {
    if (step * pixelsPerSecond >= minSpacing) {
      return step;
    }
  }
  const coarsest = candidates[candidates.length - 1]!;
  let n = 2;
  while (coarsest * n * pixelsPerSecond < minSpacing && n < 64) {
    n *= 2;
  }
  return coarsest * n;
}

function getTimeGridStepSec(settings: MetronomeSettings, pixelsPerSecond: number): number {
  const finest = getGridFinestIntervalSec(settings);
  const ladder = TIME_GRID_LOD_LADDER_SEC.filter((step) => step + TIME_EPSILON >= finest);
  return pickStepWithMinSpacing([...ladder], pixelsPerSecond);
}

function getMetronomeBasisGridStepSec(
  settings: MetronomeSettings,
  pixelsPerSecond: number
): number {
  const beatInterval = getClickIntervalSec(settings);
  const config = getTimeSignatureConfig(settings.timeSignature);
  const barInterval = beatInterval * config.clicksPerBar;
  const finest = getGridFinestIntervalSec(settings);
  const candidates: number[] = [];
  if (finest + TIME_EPSILON < beatInterval) {
    candidates.push(finest);
  }
  candidates.push(beatInterval, barInterval);
  return pickStepWithMinSpacing(candidates, pixelsPerSecond);
}

/**
 * Zoom-aware step between grid lines (seconds). Ignores `enabled` so the visual
 * grid follows tempo config even when metronome clicks are off; visibility is
 * controlled by `showGrid` in getMetronomeGridLinesInRange.
 */
export function getMetronomeGridStepSec(
  settings: MetronomeSettings,
  pixelsPerSecond: number
): number {
  if (settings.gridBasis === 'time') {
    return getTimeGridStepSec(settings, pixelsPerSecond);
  }
  return getMetronomeBasisGridStepSec(settings, pixelsPerSecond);
}

function getWholeSecondGridMultiple(gridStep: number): number {
  if (gridStep <= 0) {
    return 1;
  }
  if (Math.abs(gridStep - Math.round(gridStep)) < TIME_EPSILON && gridStep >= 1) {
    return gridStep;
  }
  const factor = Math.ceil((1 - TIME_EPSILON) / gridStep);
  return factor * gridStep;
}

function isAlignedToStep(time: number, step: number): boolean {
  if (step <= 0) {
    return false;
  }
  const quotient = time / step;
  return Math.abs(quotient - Math.round(quotient)) < TIME_EPSILON;
}

function inferBarGridStepSec(barTimes: number[]): number {
  if (barTimes.length < 2) {
    return 1;
  }
  let minDiff = Number.POSITIVE_INFINITY;
  for (let i = 1; i < barTimes.length; i++) {
    const diff = barTimes[i]! - barTimes[i - 1]!;
    if (diff > TIME_EPSILON && diff < minDiff) {
      minDiff = diff;
    }
  }
  return Number.isFinite(minDiff) ? minDiff : 1;
}

function thinTimeGridLabelTimes(
  tickTimes: number[],
  pixelsPerSecond: number,
  minLabelSpacingPx: number,
  layoutDuration: number,
  baseLabelStep: number
): number[] {
  let labelStep = baseLabelStep;
  for (const multiplier of [1, 5, 10, 30]) {
    const candidate = baseLabelStep * multiplier;
    if (candidate * pixelsPerSecond >= minLabelSpacingPx) {
      labelStep = candidate;
      break;
    }
  }
  while (labelStep * pixelsPerSecond < minLabelSpacingPx && labelStep <= layoutDuration) {
    labelStep += baseLabelStep;
  }
  return tickTimes.filter((time) => isAlignedToStep(time, labelStep));
}

/** Marker ticks/labels derived from rendered time-grid bar lines (single source of truth). */
export function getTimeGridMarkerTimesFromLines(
  lines: MetronomeGridLine[],
  pixelsPerSecond: number,
  minLabelSpacingPx: number,
  layoutDuration: number
): { tickTimes: number[]; labelTimes: number[] } {
  if (lines.length === 0 || pixelsPerSecond <= 0 || layoutDuration <= 0) {
    return { tickTimes: [], labelTimes: [] };
  }

  const tickTimes = [...new Set(
    lines.filter((line) => line.kind === 'bar').map((line) => line.time)
  )].sort((a, b) => a - b);

  if (tickTimes.length === 0) {
    return { tickTimes: [], labelTimes: [] };
  }

  const baseLabelStep = getWholeSecondGridMultiple(inferBarGridStepSec(tickTimes));
  const labelTimes = thinTimeGridLabelTimes(
    tickTimes,
    pixelsPerSecond,
    minLabelSpacingPx,
    layoutDuration,
    baseLabelStep
  );

  return { tickTimes, labelTimes };
}

/**
 * Timeline marker ticks/labels aligned to the time-based metronome grid.
 * Uses the same step math as getMetronomeGridLinesInRange so labels sit on grid lines.
 */
export function getTimeGridAlignedMarkerTimes(
  settings: MetronomeSettings,
  bufferStartSec: number,
  bufferEndSec: number,
  layoutDuration: number,
  pixelsPerSecond: number,
  minLabelSpacingPx: number
): { tickTimes: number[]; labelTimes: number[] } {
  if (layoutDuration <= 0 || bufferEndSec < bufferStartSec || pixelsPerSecond <= 0) {
    return { tickTimes: [], labelTimes: [] };
  }

  const gridStep = getMetronomeGridStepSec(settings, pixelsPerSecond);
  const inclusiveEnd = Math.min(layoutDuration, Math.ceil(bufferEndSec));
  const lines = getMetronomeGridLinesInRange(
    settings,
    bufferStartSec,
    inclusiveEnd + gridStep,
    pixelsPerSecond
  );
  return getTimeGridMarkerTimesFromLines(
    lines,
    pixelsPerSecond,
    minLabelSpacingPx,
    layoutDuration
  );
}

function classifyGridLine(beatTime: number, settings: MetronomeSettings): MetronomeGridLine {
  return { time: beatTime, kind: getMetronomeGridLineKind(beatTime, settings) };
}

function classifyMetronomeLineAtTime(
  beatTime: number,
  settings: MetronomeSettings
): MetronomeGridLine {
  const beatInterval = getClickIntervalSec(settings);
  const nearestClick = Math.round(beatTime / beatInterval) * beatInterval;
  if (Math.abs(beatTime - nearestClick) < TIME_EPSILON) {
    return classifyGridLine(nearestClick, settings);
  }
  return { time: beatTime, kind: 'beat' };
}

export function getTimeGridLineKind(time: number): MetronomeGridLineKind {
  const nearestSecond = Math.round(time);
  if (Math.abs(time - nearestSecond) < TIME_EPSILON) {
    return 'bar';
  }
  const nearestHalf = Math.round(time / 0.5) * 0.5;
  if (Math.abs(time - nearestHalf) < TIME_EPSILON) {
    return 'secondary';
  }
  return 'beat';
}

/**
 * Visual grid lines for [startAt, endAt). Respects `showGrid`; ignores `enabled`
 * so the grid can stay visible when metronome clicks are off.
 * Applies LOD thinning from zoom, then a hard max line count.
 */
export function getMetronomeGridLinesInRange(
  settings: MetronomeSettings,
  startAt: number,
  endAt: number,
  pixelsPerSecond: number
): MetronomeGridLine[] {
  if (!settings.showGrid || endAt <= startAt + TIME_EPSILON || pixelsPerSecond <= 0) {
    return [];
  }

  const stepSec = getMetronomeGridStepSec(settings, pixelsPerSecond);
  const times = collectBeatTimesInRange(startAt, endAt, stepSec);

  let lines: MetronomeGridLine[];

  if (settings.gridBasis === 'time') {
    lines = times.map((time) => ({ time, kind: getTimeGridLineKind(time) }));
  } else {
    const beatInterval = getClickIntervalSec(settings);
    if (stepSec <= beatInterval + TIME_EPSILON) {
      lines = times.map((time) => classifyMetronomeLineAtTime(time, settings));
    } else {
      // Stepped by bar (or N bars): keep accent hierarchy when accent is on.
      lines = times.map((time) => {
        if (!settings.accentEnabled) {
          return { time, kind: 'beat' as const };
        }
        return { time, kind: 'bar' as const };
      });

      // When LOD is exactly one bar and accent is on, include 6/8 secondary if spacing allows.
      const config = getTimeSignatureConfig(settings.timeSignature);
      const barInterval = beatInterval * config.clicksPerBar;
      if (
        settings.accentEnabled &&
        config.secondaryAccentAt !== undefined &&
        Math.abs(stepSec - barInterval) < TIME_EPSILON &&
        beatInterval * pixelsPerSecond >= METRONOME_GRID_MIN_SPACING_PX / 2
      ) {
        const withSecondary: MetronomeGridLine[] = [];
        for (const line of lines) {
          withSecondary.push(line);
          const secondaryTime = line.time + beatInterval * config.secondaryAccentAt;
          if (secondaryTime < endAt - TIME_EPSILON && secondaryTime >= startAt - TIME_EPSILON) {
            withSecondary.push({ time: secondaryTime, kind: 'secondary' });
          }
        }
        lines = withSecondary;
      }
    }
  }

  if (lines.length <= METRONOME_GRID_MAX_LINES) {
    return lines;
  }

  // Prefer keeping bar lines when capping.
  const bars = lines.filter((line) => line.kind === 'bar');
  if (bars.length > 0 && bars.length <= METRONOME_GRID_MAX_LINES) {
    return bars;
  }

  const stride = Math.ceil(lines.length / METRONOME_GRID_MAX_LINES);
  const capped: MetronomeGridLine[] = [];
  for (let i = 0; i < lines.length; i += stride) {
    capped.push(lines[i]!);
  }
  return capped;
}

export function playMetronomeClick(
  context: AudioContext,
  outputGain: GainNode,
  options: { accent?: boolean; scheduleLeadSec?: number } = {}
): AudioBufferSourceNode {
  const accent = options.accent ?? false;
  const buffer = accent ? getAccentClickBuffer(context) : getNormalClickBuffer(context);
  const lead = Math.max(0, options.scheduleLeadSec ?? 0);
  const when = context.currentTime + lead;

  const source = context.createBufferSource();
  source.buffer = buffer;
  // Volume is applied once on the metronome bus (outputGain), not per click.
  source.connect(outputGain);

  source.start(when);
  source.stop(when + CLICK_DURATION_SEC);
  return source;
}

export function scheduleMetronomeClicks(
  context: AudioContext,
  outputGain: GainNode,
  settings: MetronomeSettings,
  startAt: number,
  endAt: number,
  startWhen: number
): AudioBufferSourceNode[] {
  if (!settings.enabled || endAt <= startAt + TIME_EPSILON) {
    return [];
  }

  const normalBuffer = getNormalClickBuffer(context);
  const accentBuffer = getAccentClickBuffer(context);
  const secondaryBuffer = getSecondaryAccentClickBuffer(context);
  const sources: AudioBufferSourceNode[] = [];

  for (const beatTime of getMetronomeBeatTimes(settings, startAt, endAt)) {
    const isPrimary = isPrimaryAccentBeat(beatTime, settings);
    const isSecondary = !isPrimary && isSecondaryAccentBeat(beatTime, settings);
    const buffer = isPrimary
      ? accentBuffer
      : isSecondary
        ? secondaryBuffer
        : normalBuffer;
    const when = startWhen + (beatTime - startAt);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGain);

    source.start(when);
    source.stop(when + CLICK_DURATION_SEC);
    sources.push(source);
  }

  return sources;
}
