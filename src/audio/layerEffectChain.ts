import type {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioNode,
  BiquadFilterNode,
  ConvolverNode,
  DelayNode,
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

export type LayerDryNodes = LayerEffectPathNodes & {
  dryGain: GainNode;
};

export type LayerDelayNodes = {
  delayNode: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
};

export type LayerDelayPath = LayerEffectPathNodes & LayerDelayNodes;

export type LayerReverbNodes = {
  reverbConvolver: ConvolverNode;
  reverbWet: GainNode;
};

export type LayerReverbPath = LayerEffectPathNodes & LayerReverbNodes;

export type LayerEffectGraph = {
  dry: LayerDryNodes;
  delay?: LayerDelayPath;
  reverb?: LayerReverbPath;
};

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

function getEffectiveReverbMix(effects: LayerEffects): number {
  if (effects.reverb.preset === 'off') {
    return 0;
  }
  return Math.min(1, Math.max(0, effects.reverb.mix / 100));
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

function buildDryPath(context: AudioContext): LayerDryNodes {
  const input = buildInputEqPath(context);
  const dryGain = context.createGain();
  const postEq = input.eqFilters[input.eqFilters.length - 1];
  postEq.connect(dryGain);
  return { ...input, dryGain };
}

function buildDelayPath(context: AudioContext): LayerDelayPath {
  const input = buildInputEqPath(context);
  const postEq = input.eqFilters[input.eqFilters.length - 1];
  const delayNode = context.createDelay(2);
  const delayFeedback = context.createGain();
  const delayWet = context.createGain();

  postEq.connect(delayNode);
  delayNode.connect(delayWet);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);

  return { ...input, delayNode, delayFeedback, delayWet };
}

function buildReverbPath(context: AudioContext, effects: LayerEffects): LayerReverbPath {
  const input = buildInputEqPath(context);
  const postEq = input.eqFilters[input.eqFilters.length - 1];
  const reverbConvolver = context.createConvolver();
  const reverbWet = context.createGain();

  postEq.connect(reverbConvolver);
  reverbConvolver.connect(reverbWet);

  const nodes: LayerReverbPath = { ...input, reverbConvolver, reverbWet };
  syncReverbConvolver(nodes, effects, context);
  return nodes;
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

function applyDelayParams(
  delay: LayerDelayPath,
  effects: LayerEffects,
  context: AudioContext
): void {
  const now = context.currentTime;
  const delayTimeSec =
    effects.delay.sync === 'off'
      ? effects.delay.timeMs / 1000
      : syncDelayTimeMs(effects.delay.sync) / 1000;

  delay.delayNode.delayTime.setValueAtTime(Math.min(2, Math.max(0, delayTimeSec)), now);
  delay.delayFeedback.gain.setValueAtTime(
    Math.min(0.85, Math.max(0, effects.delay.feedback / 100)),
    now
  );
}

export function buildLayerEffectGraph(
  context: AudioContext,
  effects: LayerEffects
): LayerEffectGraph {
  const graph: LayerEffectGraph = {
    dry: buildDryPath(context),
  };

  if (isDelayPathActive(effects)) {
    graph.delay = buildDelayPath(context);
  }

  if (isReverbPathActive(effects)) {
    graph.reverb = buildReverbPath(context, effects);
  }

  applyLayerEffects(graph, effects, context);
  return graph;
}

export function applyLayerEffects(
  graph: LayerEffectGraph,
  effects: LayerEffects,
  context: AudioContext
): void {
  const delayMix = isDelayPathActive(effects) ? effects.delay.mix / 100 : 0;
  const reverbMix = isReverbPathActive(effects) ? getEffectiveReverbMix(effects) : 0;
  const now = context.currentTime;

  applyPathInputEffects(graph.dry, effects, context);
  // Send-style: dry stays full; wet is additive.
  graph.dry.dryGain.gain.setValueAtTime(1, now);

  if (graph.delay) {
    applyPathInputEffects(graph.delay, effects, context);
    applyDelayParams(graph.delay, effects, context);
    graph.delay.delayWet.gain.setValueAtTime(delayMix, now);
  }

  if (graph.reverb) {
    applyPathInputEffects(graph.reverb, effects, context);
    syncReverbConvolver(graph.reverb, effects, context);
    graph.reverb.reverbWet.gain.setValueAtTime(reverbMix, now);
  }
}

export function connectSourceToPath(
  source: AudioBufferSourceNode,
  path: LayerEffectPathNodes
): void {
  source.connect(path.gain);
}

export function connectDryPathToDestination(
  graph: LayerEffectGraph,
  destination: AudioNode
): void {
  graph.dry.dryGain.connect(destination);
}

export function connectDelayPathToDestination(
  graph: LayerEffectGraph,
  destination: AudioNode
): void {
  graph.delay?.delayWet.connect(destination);
}

export function connectReverbPathToDestination(
  graph: LayerEffectGraph,
  destination: AudioNode
): void {
  graph.reverb?.reverbWet.connect(destination);
}

export function getEffectiveLayerTimelineDuration(effects: LayerEffects): number {
  return Math.max(0, effects.trimOut - effects.trimIn);
}

export function clearReverbIrCache(): void {
  reverbIrCache.clear();
}
