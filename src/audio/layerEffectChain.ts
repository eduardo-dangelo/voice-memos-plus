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

export type LayerDelayNodes = LayerEffectPathNodes & {
  delayNode: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
};

export type LayerReverbNodes = LayerEffectPathNodes & {
  reverbConvolver: ConvolverNode;
  reverbWet: GainNode;
};

export type LayerEffectGraph = {
  dry: LayerDryNodes;
  delay?: LayerDelayNodes;
  reverb?: LayerReverbNodes;
};

const REVERB_DURATION: Record<Exclude<ReverbPreset, 'off' | 'custom'>, number> = {
  room: 0.6,
  hall: 1.8,
  plate: 1.2,
  chamber: 0.4,
  cathedral: 2.5,
  spring: 0.8,
};

const REVERB_IR_THROTTLE_MS = 80;
const MINIMAL_REVERB_IR_KEY = 'off';

const lastReverbIrKey = new WeakMap<LayerReverbNodes, string>();
const lastReverbIrSyncAt = new WeakMap<LayerReverbNodes, number>();
const lastReverbPreset = new WeakMap<LayerReverbNodes, ReverbPreset>();
const pendingReverbIrSync = new WeakMap<LayerReverbNodes, ReturnType<typeof setTimeout>>();

export function isDelayPathActive(effects: LayerEffects): boolean {
  return effects.delay.mix > 0;
}

export function isReverbPathActive(effects: LayerEffects): boolean {
  return effects.reverb.preset !== 'off' && effects.reverb.mix > 0;
}

function getEffectiveReverbMix(effects: LayerEffects): number {
  if (effects.reverb.preset === 'off') {
    return 0;
  }
  return Math.min(1, Math.max(0, effects.reverb.mix / 100));
}

function createMinimalImpulseResponse(context: AudioContext): AudioBuffer {
  const sampleRate = context.sampleRate;
  const impulse = context.createBuffer(1, 1, sampleRate);
  impulse.getChannelData(0)[0] = 1;
  return impulse;
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

function reverbIrKey(preset: ReverbPreset, decay: number): string {
  return `${preset}:${decay.toFixed(2)}`;
}

function getReverbDurationSec(preset: ReverbPreset, decay: number): number {
  if (preset === 'custom' || preset === 'off') {
    return Math.max(0.3, decay);
  }
  return REVERB_DURATION[preset] * Math.max(0.3, decay);
}

function buildInputEqPath(context: AudioContext): LayerEffectPathNodes {
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
  const path = buildInputEqPath(context);
  const dryGain = context.createGain();
  const postEq = path.eqFilters[path.eqFilters.length - 1];
  postEq.connect(dryGain);
  return { ...path, dryGain };
}

function buildDelayPath(context: AudioContext): LayerDelayNodes {
  const path = buildInputEqPath(context);
  const delayNode = context.createDelay(2);
  const delayFeedback = context.createGain();
  const delayWet = context.createGain();
  const postEq = path.eqFilters[path.eqFilters.length - 1];

  postEq.connect(delayNode);
  delayNode.connect(delayWet);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);

  return { ...path, delayNode, delayFeedback, delayWet };
}

function buildReverbPath(context: AudioContext, effects: LayerEffects): LayerReverbNodes {
  const path = buildInputEqPath(context);
  const reverbConvolver = context.createConvolver();
  const reverbWet = context.createGain();
  const postEq = path.eqFilters[path.eqFilters.length - 1];

  postEq.connect(reverbConvolver);
  reverbConvolver.connect(reverbWet);

  const nodes: LayerReverbNodes = { ...path, reverbConvolver, reverbWet };
  syncReverbConvolver(nodes, effects, context);
  return nodes;
}

function assignReverbImpulse(
  nodes: LayerReverbNodes,
  preset: Exclude<ReverbPreset, 'off'>,
  decay: number,
  context: AudioContext
): void {
  const key = reverbIrKey(preset, decay);
  const reverbDuration = getReverbDurationSec(preset, decay);
  nodes.reverbConvolver.buffer = createImpulseResponse(context, reverbDuration, decay);
  lastReverbIrKey.set(nodes, key);
  lastReverbPreset.set(nodes, preset);
  lastReverbIrSyncAt.set(nodes, Date.now());
}

function syncReverbConvolver(
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

function applyPathInputEffects(
  path: LayerEffectPathNodes,
  effects: LayerEffects,
  context: AudioContext
): void {
  const now = context.currentTime;
  path.gain.gain.setValueAtTime(dbToLinear(effects.volumeDb), now);
  effects.eq.bands.forEach((bandDb, index) => {
    path.eqFilters[index].gain.setValueAtTime(bandDb, now);
  });
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
  const delayMix = effects.delay.mix / 100;
  const reverbMix = getEffectiveReverbMix(effects);
  const now = context.currentTime;

  applyPathInputEffects(graph.dry, effects, context);
  graph.dry.dryGain.gain.setValueAtTime(Math.max(0, 1 - delayMix - reverbMix), now);

  if (graph.delay) {
    applyPathInputEffects(graph.delay, effects, context);

    const delayTimeSec =
      effects.delay.sync === 'off'
        ? effects.delay.timeMs / 1000
        : syncDelayTimeMs(effects.delay.sync) / 1000;

    graph.delay.delayNode.delayTime.setValueAtTime(Math.min(2, Math.max(0, delayTimeSec)), now);
    graph.delay.delayFeedback.gain.setValueAtTime(
      Math.min(0.85, Math.max(0, effects.delay.feedback / 100)),
      now
    );
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
