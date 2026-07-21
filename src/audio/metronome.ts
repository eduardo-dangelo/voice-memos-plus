import type { AudioBuffer, AudioBufferSourceNode, AudioContext, GainNode } from 'react-native-audio-api';

import type { MetronomeSettings, TimeSignaturePreset } from '@/src/storage/types';

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

export function getTimeSignatureConfig(timeSignature: TimeSignaturePreset): TimeSignatureConfig {
  return TIME_SIGNATURES[timeSignature];
}

export function getClickIntervalSec(settings: MetronomeSettings): number {
  const config = getTimeSignatureConfig(settings.timeSignature);
  const quarterInterval = 60 / settings.bpm;
  return config.beatUnit === 'eighth' ? quarterInterval / 2 : quarterInterval;
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

/**
 * Zoom-aware step between grid lines (seconds). Ignores `enabled` so the visual
 * grid follows tempo config even when metronome clicks are off; visibility is
 * controlled by `showGrid` in getMetronomeGridLinesInRange.
 */
export function getMetronomeGridStepSec(
  settings: MetronomeSettings,
  pixelsPerSecond: number
): number {
  const beatInterval = getClickIntervalSec(settings);
  const config = getTimeSignatureConfig(settings.timeSignature);
  const barInterval = beatInterval * config.clicksPerBar;
  const minSpacing = METRONOME_GRID_MIN_SPACING_PX;

  if (beatInterval * pixelsPerSecond >= minSpacing) {
    return beatInterval;
  }
  if (barInterval * pixelsPerSecond >= minSpacing) {
    return barInterval;
  }

  let n = 2;
  while (barInterval * n * pixelsPerSecond < minSpacing && n < 64) {
    n *= 2;
  }
  return barInterval * n;
}

function classifyGridLine(beatTime: number, settings: MetronomeSettings): MetronomeGridLine {
  return { time: beatTime, kind: getMetronomeGridLineKind(beatTime, settings) };
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

  const beatInterval = getClickIntervalSec(settings);
  const stepSec = getMetronomeGridStepSec(settings, pixelsPerSecond);
  const times = collectBeatTimesInRange(startAt, endAt, stepSec);

  let lines: MetronomeGridLine[];

  if (Math.abs(stepSec - beatInterval) < TIME_EPSILON) {
    lines = times.map((time) => classifyGridLine(time, settings));
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
  options: { accent?: boolean } = {}
): AudioBufferSourceNode {
  const accent = options.accent ?? false;
  const buffer = accent ? getAccentClickBuffer(context) : getNormalClickBuffer(context);
  const when = context.currentTime;

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
