import type { AudioBuffer, AudioBufferSourceNode, AudioContext, GainNode } from 'react-native-audio-api';

import type { MetronomeSettings, TimeSignaturePreset } from '@/src/storage/types';

const CLICK_DURATION_SEC = 0.015;
const NORMAL_CLICK_FREQ = 1000;
const ACCENT_CLICK_FREQ = 1500;
const NORMAL_AMPLITUDE = 0.5;
const ACCENT_AMPLITUDE = 0.85;
const SECONDARY_ACCENT_GAIN = 0.75;
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

function createClickBuffer(
  context: AudioContext,
  frequency: number,
  amplitude: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.ceil(sampleRate * CLICK_DURATION_SEC));
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const decay = Math.exp(-t * 200);
    data[i] = Math.sin(2 * Math.PI * frequency * t) * amplitude * decay;
  }

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

export function getMetronomeBeatTimes(
  settings: MetronomeSettings,
  startAt: number,
  endAt: number
): number[] {
  if (!settings.enabled || endAt <= startAt + TIME_EPSILON) {
    return [];
  }

  const interval = getClickIntervalSec(settings);
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

export function playMetronomeClick(
  context: AudioContext,
  outputGain: GainNode,
  options: { accent?: boolean; volume?: number } = {}
): AudioBufferSourceNode {
  const accent = options.accent ?? false;
  const volumeGain = Math.max(0, Math.min(1, (options.volume ?? 70) / 100));
  const buffer = accent ? getAccentClickBuffer(context) : getNormalClickBuffer(context);
  const when = context.currentTime;

  const source = context.createBufferSource();
  source.buffer = buffer;

  const clickGain = context.createGain();
  clickGain.gain.value = volumeGain;
  source.connect(clickGain);
  clickGain.connect(outputGain);

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
  const sources: AudioBufferSourceNode[] = [];
  const volumeGain = settings.volume / 100;

  for (const beatTime of getMetronomeBeatTimes(settings, startAt, endAt)) {
    const isPrimary = isPrimaryAccentBeat(beatTime, settings);
    const isSecondary = !isPrimary && isSecondaryAccentBeat(beatTime, settings);
    const usesAccent = isPrimary || isSecondary;
    const buffer = usesAccent ? accentBuffer : normalBuffer;
    const when = startWhen + (beatTime - startAt);

    const source = context.createBufferSource();
    source.buffer = buffer;

    const clickGain = context.createGain();
    clickGain.gain.value = volumeGain * (isSecondary ? SECONDARY_ACCENT_GAIN : 1);
    source.connect(clickGain);
    clickGain.connect(outputGain);

    source.start(when);
    source.stop(when + CLICK_DURATION_SEC);
    sources.push(source);
  }

  return sources;
}
