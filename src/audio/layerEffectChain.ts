import type {
  AudioBuffer,
  AudioContext,
  BiquadFilterNode,
  ConvolverNode,
  GainNode,
} from 'react-native-audio-api';

import {
  dbToLinear,
  EQ_FREQUENCIES,
  syncDelayTimeMs,
  type LayerEffects,
  type ReverbPreset,
} from '@/src/audio/layerEffects';

export type LayerEffectPathNodes = {
  gain: GainNode;
  eqFilters: BiquadFilterNode[];
};

export type LayerReverbNodes = {
  reverbConvolver: ConvolverNode;
  reverbWet: GainNode;
};

const DELAY_MAX_CAP_SEC = 2;
const DELAY_HEADROOM_SEC = 0.05;
const DELAY_MIN_MAX_SEC = 0.05;

const REVERB_DURATION: Record<Exclude<ReverbPreset, 'off' | 'custom'>, number> = {
  room: 0.6,
  hall: 1.8,
  plate: 1.2,
  chamber: 0.9,
  cathedral: 2.5,
  spring: 1.2,
};

const REVERB_IR_THROTTLE_MS = 80;

const reverbIrCache = new Map<string, AudioBuffer>();
const lastReverbIrKey = new WeakMap<LayerReverbNodes, string>();
const lastReverbIrSyncAt = new WeakMap<LayerReverbNodes, number>();
const lastReverbPreset = new WeakMap<LayerReverbNodes, ReverbPreset>();
const pendingReverbIrSync = new WeakMap<LayerReverbNodes, ReturnType<typeof setTimeout>>();

export function isDelayPathActive(effects: LayerEffects): boolean {
  return effects.delay.preset !== 'off' && effects.delay.mix > 0;
}

export function isReverbPathActive(effects: LayerEffects): boolean {
  return effects.reverb.preset !== 'off' && effects.reverb.mix > 0;
}

export function delayBusKey(effects: LayerEffects): string {
  const { preset, sync, timeMs, feedback } = effects.delay;
  return `${preset}:${sync}:${timeMs}:${feedback}`;
}

export function reverbBusKey(effects: LayerEffects): string {
  return `${effects.reverb.preset}:${effects.reverb.decay.toFixed(2)}`;
}

export function getEffectiveReverbMix(effects: LayerEffects): number {
  if (effects.reverb.preset === 'off') {
    return 0;
  }
  return Math.min(1, Math.max(0, effects.reverb.mix / 100));
}

export function getDelayTimeSec(effects: LayerEffects): number {
  return effects.delay.sync === 'off'
    ? effects.delay.timeMs / 1000
    : syncDelayTimeMs(effects.delay.sync) / 1000;
}

/** Max delay buffer size for createDelay (fixed at construction). */
export function requiredDelayMaxSec(effects: LayerEffects): number {
  return Math.min(
    DELAY_MAX_CAP_SEC,
    Math.max(DELAY_MIN_MAX_SEC, getDelayTimeSec(effects) + DELAY_HEADROOM_SEC)
  );
}

function createImpulseResponse(
  context: AudioContext,
  durationSec: number,
  decay: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const impulse = context.createBuffer(1, length, sampleRate);
  const data = impulse.getChannelData(0);

  for (let i = 0; i < length; i += 1) {
    const envelope = Math.pow(1 - i / length, Math.max(0.5, decay));
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  return impulse;
}

export function reverbIrKey(preset: ReverbPreset, decay: number): string {
  return `${preset}:${decay.toFixed(2)}`;
}

function getReverbDurationSec(preset: ReverbPreset, decay: number): number {
  if (preset === 'custom' || preset === 'off') {
    return Math.max(0.3, decay);
  }
  return REVERB_DURATION[preset] * Math.max(0.3, decay);
}

export function getOrCreateImpulseResponse(
  context: AudioContext,
  preset: Exclude<ReverbPreset, 'off'>,
  decay: number
): AudioBuffer {
  const key = reverbIrKey(preset, decay);
  const cached = reverbIrCache.get(key);
  if (cached) {
    return cached;
  }
  const impulse = createImpulseResponse(
    context,
    getReverbDurationSec(preset, decay),
    decay
  );
  reverbIrCache.set(key, impulse);
  return impulse;
}

export function buildInputEqPath(context: AudioContext): LayerEffectPathNodes {
  const gain = context.createGain();
  const eqFilters = EQ_FREQUENCIES.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1;
    return filter;
  });

  gain.connect(eqFilters[0]);
  for (let i = 0; i < eqFilters.length - 1; i += 1) {
    eqFilters[i].connect(eqFilters[i + 1]);
  }

  return { gain, eqFilters };
}

function cloneImpulseBuffer(context: AudioContext, source: AudioBuffer): AudioBuffer {
  const clone = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    clone.copyToChannel(source.getChannelData(channel), channel);
  }
  return clone;
}

function assignReverbImpulse(
  nodes: LayerReverbNodes,
  preset: Exclude<ReverbPreset, 'off'>,
  decay: number,
  context: AudioContext
): void {
  const key = reverbIrKey(preset, decay);
  const impulse = getOrCreateImpulseResponse(context, preset, decay);
  nodes.reverbConvolver.buffer = cloneImpulseBuffer(context, impulse);
  lastReverbIrKey.set(nodes, key);
  lastReverbPreset.set(nodes, preset);
  lastReverbIrSyncAt.set(nodes, Date.now());
}

export function syncReverbConvolver(
  nodes: LayerReverbNodes,
  effects: LayerEffects,
  context: AudioContext
): void {
  const { preset, decay } = effects.reverb;
  if (preset === 'off') {
    return;
  }

  const key = reverbIrKey(preset, decay);
  const previousKey = lastReverbIrKey.get(nodes);
  const previousPreset = lastReverbPreset.get(nodes);
  const presetChanged = previousPreset !== preset;

  if (previousKey === key) {
    const pending = pendingReverbIrSync.get(nodes);
    if (pending) {
      clearTimeout(pending);
      pendingReverbIrSync.delete(nodes);
    }
    return;
  }

  const nowMs = Date.now();
  const lastSyncAt = lastReverbIrSyncAt.get(nodes) ?? 0;
  if (!presetChanged && nowMs - lastSyncAt < REVERB_IR_THROTTLE_MS) {
    const existing = pendingReverbIrSync.get(nodes);
    if (existing) {
      clearTimeout(existing);
    }
    pendingReverbIrSync.set(
      nodes,
      setTimeout(() => {
        pendingReverbIrSync.delete(nodes);
        assignReverbImpulse(nodes, preset, decay, context);
      }, REVERB_IR_THROTTLE_MS - (nowMs - lastSyncAt))
    );
    return;
  }

  const pending = pendingReverbIrSync.get(nodes);
  if (pending) {
    clearTimeout(pending);
    pendingReverbIrSync.delete(nodes);
  }
  assignReverbImpulse(nodes, preset, decay, context);
}

export function applyPathInputEffects(
  path: LayerEffectPathNodes,
  effects: LayerEffects,
  context: AudioContext
): void {
  const now = context.currentTime;
  path.gain.gain.setValueAtTime(
    effects.muted ? 0 : dbToLinear(effects.volumeDb),
    now
  );
  effects.eq.bands.forEach((bandDb, index) => {
    path.eqFilters[index].gain.setValueAtTime(bandDb, now);
  });
}

export function getEffectiveLayerTimelineDuration(effects: LayerEffects): number {
  return Math.max(0, effects.trimOut - effects.trimIn);
}

export function clearReverbIrCache(): void {
  reverbIrCache.clear();
}
